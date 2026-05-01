"""
SQLite persistence layer for the Smart Shelf backend.
All tables are created on first run via init_db().
"""

import sqlite3
import json
import os
from datetime import datetime, timezone
from contextlib import contextmanager

DB_PATH = os.environ.get("SHELF_DB_PATH", "smart_shelf.db")


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ----------------------------------------------------------------------
# Schema
# ----------------------------------------------------------------------
def init_db():
    """Create tables and seed defaults if the DB is empty."""
    from templates_default import (
        DEFAULT_TEMPLATES, INITIAL_INVENTORY, INITIAL_RECIPIENTS, DEFAULT_CONFIG,
    )

    with get_conn() as conn:
        c = conn.cursor()
        c.executescript("""
            CREATE TABLE IF NOT EXISTS inventory (
                item        TEXT PRIMARY KEY,
                icon        TEXT,
                count       INTEGER NOT NULL DEFAULT 0,
                threshold   INTEGER NOT NULL DEFAULT 1,
                capacity    INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS recipients (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                name    TEXT NOT NULL,
                email   TEXT NOT NULL,
                role    TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS templates (
                role    TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                body    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS email_log (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                sent_at        TEXT NOT NULL,
                recipient_id   INTEGER,
                recipient_name TEXT,
                to_addr        TEXT,
                role           TEXT,
                subject        TEXT,
                body           TEXT,
                email_type     TEXT,
                status         TEXT
            );

            CREATE TABLE IF NOT EXISTS scan_log (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_at TEXT NOT NULL,
                epc     TEXT,
                item    TEXT,
                action  TEXT
            );
        """)

        # Seed inventory if empty
        c.execute("SELECT COUNT(*) FROM inventory")
        if c.fetchone()[0] == 0:
            for row in INITIAL_INVENTORY:
                c.execute(
                    "INSERT INTO inventory(item, icon, count, threshold, capacity) VALUES (?,?,?,?,?)",
                    (row["item"], row["icon"], row["count"], row["threshold"], row["capacity"]),
                )

        # Seed recipients if empty
        c.execute("SELECT COUNT(*) FROM recipients")
        if c.fetchone()[0] == 0:
            for r in INITIAL_RECIPIENTS:
                c.execute(
                    "INSERT INTO recipients(name, email, role, enabled) VALUES (?,?,?,?)",
                    (r["name"], r["email"], r["role"], 1 if r["enabled"] else 0),
                )

        # Seed templates if empty
        c.execute("SELECT COUNT(*) FROM templates")
        if c.fetchone()[0] == 0:
            for role, tpl in DEFAULT_TEMPLATES.items():
                c.execute(
                    "INSERT INTO templates(role, subject, body) VALUES (?,?,?)",
                    (role, tpl["subject"], tpl["body"]),
                )

        # Seed config if empty
        c.execute("SELECT COUNT(*) FROM config")
        if c.fetchone()[0] == 0:
            for k, v in DEFAULT_CONFIG.items():
                c.execute("INSERT INTO config(key, value) VALUES (?,?)", (k, json.dumps(v)))


# ----------------------------------------------------------------------
# Inventory
# ----------------------------------------------------------------------
def get_inventory():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM inventory ORDER BY item").fetchall()
        return [dict(r) for r in rows]


def set_inventory_count(item: str, count: int):
    with get_conn() as conn:
        conn.execute("UPDATE inventory SET count=? WHERE item=?", (count, item))


def set_inventory_threshold(item: str, threshold: int):
    with get_conn() as conn:
        conn.execute("UPDATE inventory SET threshold=? WHERE item=?", (threshold, item))


def get_thresholds():
    return {row["item"]: row["threshold"] for row in get_inventory()}


# ----------------------------------------------------------------------
# Recipients
# ----------------------------------------------------------------------
def get_recipients():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM recipients ORDER BY id").fetchall()
        return [{**dict(r), "enabled": bool(r["enabled"])} for r in rows]


def add_recipient_db(name: str, email: str, role: str, enabled: bool) -> int:
    with get_conn() as conn:
        c = conn.execute(
            "INSERT INTO recipients(name, email, role, enabled) VALUES (?,?,?,?)",
            (name, email, role, 1 if enabled else 0),
        )
        return c.lastrowid


def update_recipient_db(rid: int, patch: dict):
    allowed = {"name", "email", "role", "enabled"}
    fields = {k: v for k, v in patch.items() if k in allowed}
    if not fields:
        return
    if "enabled" in fields:
        fields["enabled"] = 1 if fields["enabled"] else 0
    sets = ", ".join(f"{k}=?" for k in fields)
    values = list(fields.values()) + [rid]
    with get_conn() as conn:
        conn.execute(f"UPDATE recipients SET {sets} WHERE id=?", values)


def delete_recipient_db(rid: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM recipients WHERE id=?", (rid,))


# ----------------------------------------------------------------------
# Templates
# ----------------------------------------------------------------------
def get_templates() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM templates").fetchall()
        return {r["role"]: {"subject": r["subject"], "body": r["body"]} for r in rows}


def set_template(role: str, subject: str | None = None, body: str | None = None):
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM templates WHERE role=?", (role,)).fetchone()
        if not existing:
            return
        new_subject = subject if subject is not None else existing["subject"]
        new_body = body if body is not None else existing["body"]
        conn.execute(
            "UPDATE templates SET subject=?, body=? WHERE role=?",
            (new_subject, new_body, role),
        )


def reset_templates_db():
    from templates_default import DEFAULT_TEMPLATES
    with get_conn() as conn:
        conn.execute("DELETE FROM templates")
        for role, tpl in DEFAULT_TEMPLATES.items():
            conn.execute(
                "INSERT INTO templates(role, subject, body) VALUES (?,?,?)",
                (role, tpl["subject"], tpl["body"]),
            )


# ----------------------------------------------------------------------
# Config (key/value store)
# ----------------------------------------------------------------------
def get_config() -> dict:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM config").fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}


def set_config(updates: dict):
    with get_conn() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT INTO config(key, value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )


# ----------------------------------------------------------------------
# Email log
# ----------------------------------------------------------------------
def log_email(recipient_id, recipient_name, to_addr, role, subject, body, email_type, status):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO email_log(sent_at, recipient_id, recipient_name, to_addr, role, subject, body, email_type, status) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                datetime.now(timezone.utc).isoformat(),
                recipient_id, recipient_name, to_addr, role, subject, body, email_type, status,
            ),
        )


def get_emails(limit: int = 30):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM email_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ----------------------------------------------------------------------
# Scan log
# ----------------------------------------------------------------------
def log_scan(epc: str, item: str, action: str):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO scan_log(scan_at, epc, item, action) VALUES (?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), epc, item, action),
        )


def get_scans(limit: int = 20):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM scan_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]
