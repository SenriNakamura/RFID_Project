# Smart Shelf — Flask Backend

Backend for the EE-144 Smart Shelf Inventory Monitoring System.
Connects the C# RFID reader to the React UI and handles real email alerts.

## Architecture

```
  ┌──────────────────────┐                ┌─────────────────┐
  │   C# RFID Reader     │  POST /scan    │                 │
  │   (Mercury API)      │ ─────────────▶ │   Flask API     │
  │   Program.cs         │                │   app.py        │
  └──────────────────────┘                │                 │
                                          │   SQLite DB     │
  ┌──────────────────────┐  GET / PUT     │   smart_shelf.db│
  │   React UI           │ ◀────────────▶ │                 │
  │   (Vite, port 5173)  │                └────────┬────────┘
  └──────────────────────┘                         │
                                                   │ SMTP
                                                   ▼
                                          ┌─────────────────┐
                                          │  Gmail / SES /  │
                                          │  any SMTP host  │
                                          └─────────────────┘
```

The C# reader runs in a tight scan loop. Every cycle it sends the list of
detected EPCs to `POST /api/scan`. The Flask backend:

1. Maps EPCs to product names via the tag database.
2. Updates the inventory count for each product.
3. Compares against thresholds and fires email alerts on downward crossings.
4. Sends one role-tailored email per enabled recipient via SMTP.
5. Logs everything to SQLite for the UI to display.

## File layout

```
smart_shelf_backend/
├── app.py                   # Flask routes
├── db.py                    # SQLite persistence layer
├── templates_default.py     # Default templates, tag DB, seed data
├── Program.cs               # C# reader client (replaces sample Program.cs)
├── requirements.txt
├── .env.example
└── README.md
```

## Setup — Python backend

```bash
cd smart_shelf_backend
python -m venv venv
source venv/bin/activate           # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Option A: dev mode without real SMTP — emails print to console
export SMTP_DRY_RUN=1
python app.py

# Option B: real Gmail SMTP
export SMTP_USERNAME=smartshelf@ee144.edu
export SMTP_PASSWORD=<gmail-app-password>
python app.py
```

The first run creates `smart_shelf.db` and seeds it with the 22 tag
mappings, 8 products, 4 default recipients, and 4 email templates.

Server starts on `http://0.0.0.0:5000`. Test with:

```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/inventory
```

## Setup — C# reader client

1. Open the existing EE-144 C# project in Visual Studio.
2. Replace `Program.cs` with the file in this folder.
3. Make sure these references are added:
   - `MercuryAPI.dll` (already there from the sample)
   - `System.Net.Http`
   - `System.Web.Extensions`
4. Adjust the `ReaderUri` constant (default `tmr:///com4`) to match your COM port.
5. Adjust `BackendUrl` if Flask runs on a different machine — e.g.
   `http://192.168.1.100:5000/api/scan`.
6. Build and run. You should see scan cycles logged to the console and
   the Flask server's terminal showing incoming POSTs.

## Setup — React UI

The React component already lives in your Vite project. To wire it up to
this backend, replace the `INITIAL_*` constants and local handlers with
fetch calls. A minimal patch:

```jsx
// near the top of SmartShelfDashboard.jsx
const API = 'http://localhost:5000/api';

useEffect(() => {
  fetch(`${API}/inventory`).then(r => r.json()).then(setInventory);
  fetch(`${API}/recipients`).then(r => r.json()).then(setRecipients);
  fetch(`${API}/templates`).then(r => r.json()).then(setTemplates);
  fetch(`${API}/emails`).then(r => r.json()).then(setEmailLog);
}, []);

// ...inside adjustCount():
fetch(`${API}/inventory/${itemName}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ count: newCount }),
});

// ...inside sendTestEmails():
fetch(`${API}/test-email`, { method: 'POST' })
  .then(() => fetch(`${API}/emails`).then(r => r.json()).then(setEmailLog));
```

CORS is already enabled on the Flask side via `flask-cors`, so the Vite
dev server at `localhost:5173` can hit `localhost:5000` directly.

## API reference

| Method | Path                           | Purpose                                |
|--------|--------------------------------|----------------------------------------|
| GET    | `/api/health`                  | Heartbeat check                        |
| POST   | `/api/scan`                    | C# reader posts EPCs here              |
| GET    | `/api/inventory`               | Current shelf state                    |
| PUT    | `/api/inventory/<item>`        | Manual count or threshold update       |
| GET    | `/api/recipients`              | List recipients                        |
| POST   | `/api/recipients`              | Add recipient                          |
| PUT    | `/api/recipients/<id>`         | Update recipient                       |
| DELETE | `/api/recipients/<id>`         | Remove recipient                       |
| GET    | `/api/templates`               | All role templates                     |
| PUT    | `/api/templates/<role>`        | Update one template's subject/body     |
| POST   | `/api/templates/reset`         | Reset all templates to defaults        |
| GET    | `/api/config`                  | SMTP config (credentials redacted)     |
| PUT    | `/api/config`                  | Update SMTP config                     |
| GET    | `/api/emails`                  | Recent outbox entries                  |
| POST   | `/api/test-email`              | Send TEST email to all enabled         |
| GET    | `/api/scans`                   | Recent EPC scan log                    |

## Gmail SMTP notes

If using Gmail as your SMTP provider:

1. Enable 2FA on the sending Google account.
2. Generate an App Password at https://myaccount.google.com/apppasswords.
3. Use that 16-character password as `SMTP_PASSWORD`. Regular passwords
   will be rejected.
4. SMTP host is `smtp.gmail.com`, port `587` (STARTTLS) or `465` (SSL).

For a school project demo, `SMTP_DRY_RUN=1` works fine — emails are
logged to the Flask console and stored in the DB outbox so the UI still
shows them, just without actually delivering.

## Cooldown logic

To avoid email storms when an item flickers around the threshold (e.g.
the reader sometimes misses a tag), the backend tracks the last alert
timestamp per item in memory. New alerts for the same item are suppressed
until `cooldown_minutes` has elapsed (default 15, configurable via
`PUT /api/config`).
