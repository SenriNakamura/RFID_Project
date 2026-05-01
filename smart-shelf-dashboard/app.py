"""
Smart Shelf Inventory Monitoring System — Flask Backend
EE-144 Group Project

Architecture:
  C# RFID Reader (Mercury API)  ─── HTTP POST ──▶  Flask API  ─── SMTP ──▶  Recipients
                                                       │
                                                       └── HTTP/REST ──▶  React UI

Endpoints:
  POST /api/scan              — receives EPC reads from the C# reader
  GET  /api/inventory         — current inventory state (for the UI)
  GET  /api/recipients        — list email recipients
  POST /api/recipients        — add a recipient
  PUT  /api/recipients/<id>   — update a recipient
  DELETE /api/recipients/<id> — remove a recipient
  GET  /api/templates         — list all email templates
  PUT  /api/templates/<role>  — update a role's template
  POST /api/templates/reset   — reset all templates to defaults
  GET  /api/config            — get SMTP config
  PUT  /api/config            — update SMTP config
  GET  /api/emails            — outbox (recently sent emails)
  POST /api/test-email        — send a test email to all enabled recipients
"""

import os
import json
import smtplib
import ssl
import threading
import time
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from email.utils import formataddr

from flask import Flask, request, jsonify
from flask_cors import CORS

from db import (
    init_db, get_inventory, set_inventory_count, get_thresholds,
    get_recipients, add_recipient_db, update_recipient_db, delete_recipient_db,
    get_templates, set_template, reset_templates_db,
    get_config, set_config,
    log_email, get_emails, log_scan, get_scans,
)
from templates_default import DEFAULT_TEMPLATES, TAG_DATABASE, INITIAL_INVENTORY

# ----------------------------------------------------------------------
# Flask app setup
# ----------------------------------------------------------------------
app = Flask(__name__)
CORS(app)  # Allow React dev server (Vite at :5173) to call us

# Initialize SQLite database on startup
init_db()

# In-memory cooldown tracker: { item_name: datetime_of_last_alert }
_alert_cooldowns = {}
_cooldown_lock = threading.Lock()


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def fill_template(template_str: str, variables: dict) -> str:
    """Replace {token} placeholders in a template string."""
    out = template_str
    for key, value in variables.items():
        out = out.replace("{" + key + "}", str(value))
    return out


def build_email_for_recipient(recipient: dict, item: str, count: int, threshold: int) -> dict:
    """Build a {subject, body} dict by filling the recipient's role template."""
    templates = get_templates()
    role = recipient["role"]
    tpl = templates.get(role, DEFAULT_TEMPLATES["manager"])

    variables = {
        "item": item,
        "count": count,
        "threshold": threshold,
        "reorderQty": threshold * 2,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "recipient": recipient["name"],
        "role": role.title(),
    }
    return {
        "subject": fill_template(tpl["subject"], variables),
        "body": fill_template(tpl["body"], variables),
    }


def send_smtp_email(to_addr: str, subject: str, body: str) -> tuple[bool, str]:
    """
    Actually send an email via SMTP.
    Returns (success, message). On dev machines without real SMTP creds set,
    DRY_RUN mode just logs to console — see SMTP_DRY_RUN below.
    """
    config = get_config()
    sender = config["sender"]
    server = config["smtp_server"]
    port = int(config["smtp_port"])
    username = os.environ.get("SMTP_USERNAME", config.get("smtp_username", ""))
    password = os.environ.get("SMTP_PASSWORD", "")
    dry_run = os.environ.get("SMTP_DRY_RUN", "0") == "1"

    msg = EmailMessage()
    msg["From"] = formataddr(("Smart Shelf System", sender))
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)

    if dry_run:
        print(f"\n[DRY_RUN] Would send email:")
        print(f"  To:      {to_addr}")
        print(f"  Subject: {subject}")
        print(f"  Body:\n{body}\n")
        return True, "dry-run"

    try:
        context = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(server, port, context=context, timeout=10) as s:
                if username and password:
                    s.login(username, password)
                s.send_message(msg)
        else:
            # 587 = STARTTLS, 25 = plain
            with smtplib.SMTP(server, port, timeout=10) as s:
                s.ehlo()
                if port == 587:
                    s.starttls(context=context)
                    s.ehlo()
                if username and password:
                    s.login(username, password)
                s.send_message(msg)
        return True, "sent"
    except Exception as exc:
        return False, str(exc)


def trigger_low_stock_alert(item: str, count: int, threshold: int) -> int:
    """
    Send role-tailored emails to all enabled non-technician recipients.
    Honors the cooldown window. Returns the number of emails sent.
    """
    config = get_config()
    if not config.get("enabled", True):
        return 0

    # Cooldown check
    cooldown_min = int(config.get("cooldown_minutes", 15))
    with _cooldown_lock:
        last_sent = _alert_cooldowns.get(item)
        if last_sent and datetime.now() - last_sent < timedelta(minutes=cooldown_min):
            return 0
        _alert_cooldowns[item] = datetime.now()

    recipients = get_recipients()
    targets = [r for r in recipients if r["enabled"] and r["role"] != "technician"]

    sent_count = 0
    for r in targets:
        email = build_email_for_recipient(r, item, count, threshold)
        ok, status = send_smtp_email(r["email"], email["subject"], email["body"])
        log_email(
            recipient_id=r["id"],
            recipient_name=r["name"],
            to_addr=r["email"],
            role=r["role"],
            subject=email["subject"],
            body=email["body"],
            email_type="alert",
            status=status if ok else f"FAILED: {status}",
        )
        if ok:
            sent_count += 1
    return sent_count


# ----------------------------------------------------------------------
# Inventory + scan endpoints
# ----------------------------------------------------------------------
@app.route("/api/scan", methods=["POST"])
def receive_scan():
    """
    Called by the C# RFID reader after each Read() cycle.
    Expected payload:
      { "epcs": ["E2801190A5...", "E2801190A5...", ...] }

    The C# code passes the raw list of EPCs detected in this scan window.
    We map each EPC to an item, count occurrences, update inventory, and
    fire alerts for any item that newly drops below threshold.
    """
    payload = request.get_json(silent=True) or {}
    epcs = payload.get("epcs", [])
    if not isinstance(epcs, list):
        return jsonify({"error": "epcs must be a list"}), 400

    # Count detected items by mapping EPC → item
    epc_to_item = {tag["epc"]: tag["item"] for tag in TAG_DATABASE}
    detected_counts = {}
    unknown_epcs = []
    for epc in epcs:
        item = epc_to_item.get(epc)
        if item:
            detected_counts[item] = detected_counts.get(item, 0) + 1
            log_scan(epc=epc, item=item, action="detected")
        else:
            unknown_epcs.append(epc)
            log_scan(epc=epc, item="UNKNOWN", action="unknown")

    # Compare against previous inventory and fire alerts on threshold crossings
    prev_inventory = get_inventory()
    prev_counts = {row["item"]: row["count"] for row in prev_inventory}
    thresholds = {row["item"]: row["threshold"] for row in prev_inventory}

    alerts_fired = []
    for row in prev_inventory:
        item = row["item"]
        new_count = detected_counts.get(item, 0)
        old_count = prev_counts[item]
        threshold = thresholds[item]

        # Update inventory regardless
        set_inventory_count(item, new_count)

        # Fire alert if we just crossed below threshold
        if new_count < threshold and old_count >= threshold:
            sent = trigger_low_stock_alert(item, new_count, threshold)
            alerts_fired.append({"item": item, "count": new_count, "emails_sent": sent})

    return jsonify({
        "received_epcs": len(epcs),
        "detected": detected_counts,
        "unknown_epcs": unknown_epcs,
        "alerts_fired": alerts_fired,
    })


@app.route("/api/inventory", methods=["GET"])
def list_inventory():
    return jsonify(get_inventory())


@app.route("/api/inventory/<item>", methods=["PUT"])
def update_inventory(item):
    """Manually adjust inventory (for the UI's +/- buttons during demo)."""
    data = request.get_json(silent=True) or {}
    if "count" in data:
        prev = next((row for row in get_inventory() if row["item"] == item), None)
        if not prev:
            return jsonify({"error": "item not found"}), 404
        new_count = int(data["count"])
        set_inventory_count(item, new_count)
        # Fire alert if threshold crossed
        if new_count < prev["threshold"] and prev["count"] >= prev["threshold"]:
            trigger_low_stock_alert(item, new_count, prev["threshold"])
    if "threshold" in data:
        from db import set_inventory_threshold
        set_inventory_threshold(item, int(data["threshold"]))
    return jsonify({"ok": True, "item": item})


@app.route("/api/scans", methods=["GET"])
def list_scans():
    limit = int(request.args.get("limit", 20))
    return jsonify(get_scans(limit=limit))


# ----------------------------------------------------------------------
# Recipients
# ----------------------------------------------------------------------
@app.route("/api/recipients", methods=["GET"])
def list_recipients():
    return jsonify(get_recipients())


@app.route("/api/recipients", methods=["POST"])
def add_recipient():
    data = request.get_json(silent=True) or {}
    new_id = add_recipient_db(
        name=data.get("name", "New Recipient"),
        email=data.get("email", ""),
        role=data.get("role", "manager"),
        enabled=bool(data.get("enabled", True)),
    )
    return jsonify({"id": new_id}), 201


@app.route("/api/recipients/<int:rid>", methods=["PUT"])
def edit_recipient(rid):
    data = request.get_json(silent=True) or {}
    update_recipient_db(rid, data)
    return jsonify({"ok": True})


@app.route("/api/recipients/<int:rid>", methods=["DELETE"])
def remove_recipient(rid):
    delete_recipient_db(rid)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Templates
# ----------------------------------------------------------------------
@app.route("/api/templates", methods=["GET"])
def list_templates():
    return jsonify(get_templates())


@app.route("/api/templates/<role>", methods=["PUT"])
def edit_template(role):
    data = request.get_json(silent=True) or {}
    set_template(role, subject=data.get("subject"), body=data.get("body"))
    return jsonify({"ok": True})


@app.route("/api/templates/reset", methods=["POST"])
def reset_templates():
    reset_templates_db()
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# SMTP config
# ----------------------------------------------------------------------
@app.route("/api/config", methods=["GET"])
def get_config_endpoint():
    cfg = get_config()
    # Never leak credentials over the API
    cfg.pop("smtp_username", None)
    return jsonify(cfg)


@app.route("/api/config", methods=["PUT"])
def update_config_endpoint():
    data = request.get_json(silent=True) or {}
    set_config(data)
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Outbox + test
# ----------------------------------------------------------------------
@app.route("/api/emails", methods=["GET"])
def list_emails():
    limit = int(request.args.get("limit", 30))
    return jsonify(get_emails(limit=limit))


@app.route("/api/test-email", methods=["POST"])
def send_test():
    """Send a labeled TEST email to every enabled recipient."""
    recipients = [r for r in get_recipients() if r["enabled"]]
    sent = 0
    for r in recipients:
        email = build_email_for_recipient(r, item="Cheese", count=1, threshold=3)
        subject = "[TEST] " + email["subject"]
        body = "— TEST EMAIL — sample data shown below —\n\n" + email["body"]
        ok, status = send_smtp_email(r["email"], subject, body)
        log_email(
            recipient_id=r["id"], recipient_name=r["name"],
            to_addr=r["email"], role=r["role"],
            subject=subject, body=body,
            email_type="test",
            status=status if ok else f"FAILED: {status}",
        )
        if ok:
            sent += 1
    return jsonify({"sent": sent, "total": len(recipients)})


# ----------------------------------------------------------------------
# Health check
# ----------------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "time": datetime.now(timezone.utc).isoformat()})


if __name__ == "__main__":
    print("Smart Shelf backend starting on http://0.0.0.0:5000")
    print(f"  SMTP_DRY_RUN = {os.environ.get('SMTP_DRY_RUN', '0')}")
    app.run(host="0.0.0.0", port=5000, debug=False)
