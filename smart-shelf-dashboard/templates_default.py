"""
Default seed data — used both at first-run DB initialization
and as the source of truth when "Reset templates" is hit from the UI.
"""

# ----------------------------------------------------------------------
# Tag database — identical to your inventory_identification.c
# ----------------------------------------------------------------------
TAG_DATABASE = [
    {"epc": "300833B2DDD9014000000000", "item": "Milk"},
    {"epc": "E20000001A16014602107AFD", "item": "Milk"},
    {"epc": "E20000001A1601450210727C", "item": "Milk"},
    {"epc": "E20000001A16014402107240", "item": "Juice"},
    {"epc": "E20000001A1601430210727B", "item": "Juice"},
    {"epc": "E20000001A1601420210723F", "item": "Juice"},
    {"epc": "E20000001A1601410210727A", "item": "Eggs"},
    {"epc": "E20000001A16013902107279", "item": "Eggs"},
    {"epc": "E20000001A1601400210723E", "item": "Eggs"},
    {"epc": "E2801191A504006486E28537", "item": "Apple"},
    {"epc": "E280689400005023D0017108", "item": "Apple"},
    {"epc": "E280689400005023D0016908", "item": "Yogurt"},
    {"epc": "E2801190A5030063658A8697", "item": "Yogurt"},
    {"epc": "E2801190A5030063658A8687", "item": "Yogurt"},
    {"epc": "E2801190A503006550B392CE", "item": "Cheese"},
    {"epc": "E2801190A503006550B392BE", "item": "Cheese"},
    {"epc": "000000000000000000000975", "item": "Grapes"},
    {"epc": "000000000000000000000976", "item": "Grapes"},
    {"epc": "E2801190A50300655039EE23", "item": "Tea"},
    {"epc": "E2801190A50300655039EE33", "item": "Tea"},
    {"epc": "E2801190A5030065BAF758EE", "item": "Tea"},
    {"epc": "E2801190A5030065BAF7C9CE", "item": "Tea"},
]


INITIAL_INVENTORY = [
    {"item": "Milk",   "icon": "🥛", "count": 3, "threshold": 3, "capacity": 3},
    {"item": "Juice",  "icon": "🧃", "count": 3, "threshold": 3, "capacity": 3},
    {"item": "Eggs",   "icon": "🥚", "count": 3, "threshold": 3, "capacity": 3},
    {"item": "Apple",  "icon": "🍎", "count": 3, "threshold": 3, "capacity": 3},
    {"item": "Yogurt", "icon": "🥣", "count": 3, "threshold": 3, "capacity": 3},
    {"item": "Cheese", "icon": "🧀", "count": 2, "threshold": 3, "capacity": 3},
    {"item": "Grapes", "icon": "🍇", "count": 2, "threshold": 3, "capacity": 3},
    {"item": "Tea",    "icon": "🍵", "count": 4, "threshold": 4, "capacity": 4},
]


INITIAL_RECIPIENTS = [
    {"name": "Sara Chen",      "email": "sara.chen@retail.com",      "role": "manager",    "enabled": True},
    {"name": "Mike Rodriguez", "email": "mike.r@retail.com",          "role": "stockroom",  "enabled": True},
    {"name": "FreshCo Supply", "email": "orders@freshco-supply.com",  "role": "supplier",   "enabled": False},
    {"name": "IT Support",     "email": "it-helpdesk@retail.com",     "role": "technician", "enabled": True},
]


DEFAULT_CONFIG = {
    "sender": "smartshelf@ee144.edu",
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_username": "",
    "enabled": True,
    "cooldown_minutes": 15,
}


# ----------------------------------------------------------------------
# Email templates
# ----------------------------------------------------------------------
DEFAULT_TEMPLATES = {
    "manager": {
        "subject": "[Smart Shelf] Low stock — {item}",
        "body": (
            "Hello,\n\n"
            "A product on Aisle 3 has fallen below its reorder threshold "
            "and may impact sales if not addressed today.\n\n"
            "  • Product:   {item}\n"
            "  • On hand:   {count} unit(s)\n"
            "  • Threshold: {threshold} unit(s)\n"
            "  • Status:    Restock required\n\n"
            "The stockroom team has been notified in parallel. "
            "Replenishment is typically completed within 30 minutes.\n\n"
            "— Smart Shelf Monitoring System"
        ),
    },
    "stockroom": {
        "subject": "🔔 Restock needed: {item}",
        "body": (
            "Hi team,\n\n"
            "Please pull stock and replenish the shelf:\n\n"
            "  ITEM:        {item}\n"
            "  CURRENT:     {count}\n"
            "  TARGET:      {threshold} (minimum)\n"
            "  AISLE:       3 — Smart Shelf #1\n\n"
            "When you're done, the RFID reader will automatically clear this alert. "
            "No need to reply.\n\n"
            "Thanks,\n"
            "Smart Shelf System"
        ),
    },
    "supplier": {
        "subject": "Reorder request — {item} (Acct #RT-4471)",
        "body": (
            "Dear FreshCo Supply Team,\n\n"
            "This is an automated reorder request triggered by our shelf-monitoring system.\n\n"
            "  Account:        RT-4471\n"
            "  Product:        {item}\n"
            "  Suggested qty:  {reorderQty} units\n"
            "  Delivery:       Standard (next-day)\n"
            "  PO reference:   Auto-generated upon confirmation\n\n"
            "Please confirm receipt of this order. "
            "Billing will proceed against the existing supply contract.\n\n"
            "Best regards,\n"
            "Procurement Automation"
        ),
    },
    "technician": {
        "subject": "[INFO] Threshold event logged — {item}",
        "body": (
            "Diagnostic notice (informational, no action required):\n\n"
            "  EVENT:       INVENTORY_BELOW_THRESHOLD\n"
            "  ITEM:        {item}\n"
            "  COUNT:       {count}\n"
            "  THRESHOLD:   {threshold}\n"
            "  READER:      tmr:///com4 (online, GEN2, NA, pwr=2000)\n"
            "  TIMESTAMP:   {timestamp}\n\n"
            "Logged for SLA tracking. No reader fault detected.\n\n"
            "— Smart Shelf Telemetry"
        ),
    },
}
