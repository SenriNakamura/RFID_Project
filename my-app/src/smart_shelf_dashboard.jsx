import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Mail, Bell, Activity, Package, AlertTriangle, Send, Settings, Radio, TrendingDown, Plus, Minus, Clock, UserPlus, Trash2, Eye, FileText, RotateCcw, WifiOff } from 'lucide-react';
import { api } from './api';

// ============================================================
// Smart Shelf Inventory Monitoring System — UI (backend-wired)
// EE-144 Group Project
//
// All state is loaded from and written to the Flask backend at
// http://localhost:5000/api. The UI polls every 3 seconds for
// live updates from the C# RFID reader.
// ============================================================

const ROLE_DEFS = {
  manager:    { label: 'Store Manager',  color: 'indigo',  description: 'High-level summary with business impact' },
  stockroom:  { label: 'Stockroom Clerk', color: 'emerald', description: 'Action-oriented restocking instructions' },
  supplier:   { label: 'Supplier',        color: 'amber',   description: 'Procurement-focused reorder notice' },
  technician: { label: 'IT / Technician', color: 'slate',   description: 'Diagnostic info — sent only on system errors' },
};

const PLACEHOLDERS = [
  { token: '{item}',       desc: 'Product name (e.g. Cheese)' },
  { token: '{count}',      desc: 'Current quantity on shelf' },
  { token: '{threshold}',  desc: 'Minimum threshold value' },
  { token: '{reorderQty}', desc: 'Suggested reorder quantity (2× threshold)' },
  { token: '{timestamp}',  desc: 'Current ISO timestamp' },
  { token: '{recipient}',  desc: 'Recipient name' },
  { token: '{role}',       desc: 'Recipient role label' },
];

const ITEM_ICONS = {
  Milk: '🥛', Juice: '🧃', Eggs: '🥚', Apple: '🍎',
  Yogurt: '🥣', Cheese: '🧀', Grapes: '🍇', Tea: '🍵',
};

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : `{${key}}`);
}

export default function SmartShelfDashboard() {
  const [inventory, setInventory] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [templates, setTemplates] = useState({});
  const [emailConfig, setEmailConfig] = useState({
    sender: '', smtp_server: '', smtp_port: 587, enabled: true, cooldown_minutes: 15,
  });
  const [emailLog, setEmailLog] = useState([]);
  const [scanLog, setScanLog] = useState([]);

  const [tab, setTab] = useState('dashboard');
  const [scanning, setScanning] = useState(false);
  const [previewEmail, setPreviewEmail] = useState(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [inv, recs, tpls, cfg, emails, scans] = await Promise.all([
        api.getInventory(), api.getRecipients(), api.getTemplates(),
        api.getConfig(), api.getEmails(), api.getScans(),
      ]);
      setInventory(inv.map(i => ({ ...i, icon: ITEM_ICONS[i.item] || '📦' })));
      setRecipients(recs);
      setTemplates(tpls);
      setEmailConfig(cfg);
      setEmailLog(emails);
      setScanLog(scans);
      setBackendOnline(true);
    } catch (err) {
      console.error('Backend unreachable:', err);
      setBackendOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll inventory + outbox every 3s so the UI reflects what the C# reader is doing
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [inv, emails, scans] = await Promise.all([
          api.getInventory(), api.getEmails(), api.getScans(),
        ]);
        setInventory(inv.map(i => ({ ...i, icon: ITEM_ICONS[i.item] || '📦' })));
        setEmailLog(emails);
        setScanLog(scans);
        setBackendOnline(true);
      } catch (err) {
        setBackendOnline(false);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const lowStockItems = useMemo(() => inventory.filter(i => i.count < i.threshold), [inventory]);
  const totalItems = inventory.reduce((s, i) => s + i.count, 0);
  const totalCapacity = inventory.reduce((s, i) => s + (i.capacity || 1), 0);

  async function adjustCount(itemName, delta) {
    const item = inventory.find(i => i.item === itemName);
    if (!item) return;
    const newCount = Math.max(0, Math.min(item.capacity, item.count + delta));
    setInventory(prev => prev.map(i => i.item === itemName ? { ...i, count: newCount } : i));
    try {
      await api.updateInventory(itemName, { count: newCount });
      const emails = await api.getEmails();
      setEmailLog(emails);
    } catch (err) { console.error(err); loadAll(); }
  }

  async function setThreshold(itemName, newThreshold) {
    setInventory(prev => prev.map(i =>
      i.item === itemName ? { ...i, threshold: Math.max(0, Math.min(i.capacity, newThreshold)) } : i
    ));
    try { await api.updateInventory(itemName, { threshold: newThreshold }); }
    catch (err) { console.error(err); loadAll(); }
  }

  async function sendTestEmails() {
    try {
      await api.sendTestEmail();
      setEmailLog(await api.getEmails());
    } catch (err) { console.error(err); }
  }

  async function addRecipient() {
    try {
      await api.addRecipient({ name: 'New Recipient', email: '', role: 'manager', enabled: true });
      setRecipients(await api.getRecipients());
    } catch (err) { console.error(err); }
  }

  async function updateRecipient(id, patch) {
    setRecipients(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    try { await api.updateRecipient(id, patch); }
    catch (err) { console.error(err); loadAll(); }
  }

  async function removeRecipient(id) {
    setRecipients(prev => prev.filter(r => r.id !== id));
    try { await api.deleteRecipient(id); }
    catch (err) { console.error(err); loadAll(); }
  }

  async function updateTemplate(role, patch) {
    setTemplates(prev => ({ ...prev, [role]: { ...prev[role], ...patch } }));
    try { await api.updateTemplate(role, patch); }
    catch (err) { console.error(err); loadAll(); }
  }

  async function resetAllTemplates() {
    try {
      await api.resetTemplates();
      setTemplates(await api.getTemplates());
    } catch (err) { console.error(err); }
  }

  async function updateConfig(patch) {
    setEmailConfig(prev => ({ ...prev, ...patch }));
    try { await api.updateConfig(patch); }
    catch (err) { console.error(err); loadAll(); }
  }

  function simulateReaderScan() {
    setScanning(true);
    setTimeout(() => setScanning(false), 1400);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-stone-500" style={{ background: '#fafaf7' }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full" style={{
      background: '#fafaf7',
      fontFamily: '"Söhne", "Helvetica Neue", Helvetica, Arial, sans-serif',
      color: '#1a1a1a',
    }}>
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: '#0f172a' }}>
              <Radio className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] text-stone-500 uppercase font-medium">EE-144 / Group Project</div>
              <h1 className="text-lg font-semibold tracking-tight text-stone-900">
                Smart Shelf <span className="text-stone-400 font-normal">/</span> Inventory Monitor
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <div className="flex items-center gap-2">
              {backendOnline ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  </span>
                  <span className="text-emerald-700 font-medium">BACKEND ONLINE</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-red-600" />
                  <span className="text-red-700 font-medium">BACKEND OFFLINE</span>
                </>
              )}
            </div>
            <div className="text-stone-500">COM4 · GEN2 · NA</div>
            <div className="text-stone-500">PWR 2000</div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {[
            { id: 'dashboard',  label: 'Dashboard',   icon: Activity },
            { id: 'email',      label: 'Email Alerts', icon: Mail },
            { id: 'recipients', label: 'Recipients',  icon: UserPlus },
            { id: 'templates',  label: 'Templates',   icon: FileText },
            { id: 'scan log',   label: 'Scan Log',    icon: Radio },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-xs uppercase tracking-widest font-medium transition-all border-b-2 whitespace-nowrap ${
                  tab === t.id ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'
                }`}>
                <Icon className="w-3 h-3 inline mr-1.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'dashboard' && (
          <DashboardView
            inventory={inventory} lowStockItems={lowStockItems}
            totalItems={totalItems} totalCapacity={totalCapacity}
            adjustCount={adjustCount} setThreshold={setThreshold}
            scanning={scanning} simulateReaderScan={simulateReaderScan}
            recipientCount={recipients.filter(r => r.enabled).length}
          />
        )}
        {tab === 'email' && (
          <EmailView
            emailConfig={emailConfig} updateConfig={updateConfig}
            emailLog={emailLog} sendTestEmails={sendTestEmails}
            lowStockItems={lowStockItems} recipients={recipients}
            onPreview={setPreviewEmail}
          />
        )}
        {tab === 'recipients' && (
          <RecipientsView
            recipients={recipients} addRecipient={addRecipient}
            updateRecipient={updateRecipient} removeRecipient={removeRecipient}
            templates={templates}
            onPreview={(role) => {
              const tpl = templates[role];
              if (!tpl) return;
              const vars = { item: 'Cheese', count: 1, threshold: 3, reorderQty: 6, timestamp: new Date().toISOString(), recipient: 'Sample Recipient', role: ROLE_DEFS[role].label };
              setPreviewEmail({
                role, recipientName: 'Sample Recipient',
                subject: fillTemplate(tpl.subject, vars),
                body: fillTemplate(tpl.body, vars),
              });
            }}
            onJumpToTemplate={() => setTab('templates')}
          />
        )}
        {tab === 'templates' && (
          <TemplatesView
            templates={templates}
            updateTemplate={updateTemplate}
            resetAllTemplates={resetAllTemplates}
          />
        )}
        {tab === 'scan log' && <ScanLogView scanLog={scanLog} />}
      </main>

      {previewEmail && <EmailPreviewModal email={previewEmail} onClose={() => setPreviewEmail(null)} />}
    </div>
  );
}

function DashboardView({ inventory, lowStockItems, totalItems, totalCapacity, adjustCount, setThreshold, scanning, simulateReaderScan, recipientCount }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Items on Shelf" value={totalItems} suffix={`/ ${totalCapacity}`} icon={<Package />} accent="slate" />
        <StatCard label="Product Categories" value={inventory.length} icon={<Activity />} accent="indigo" />
        <StatCard label="Low Stock Alerts" value={lowStockItems.length} icon={<AlertTriangle />} accent={lowStockItems.length > 0 ? 'amber' : 'emerald'} />
        <StatCard label="Active Recipients" value={recipientCount} icon={<Mail />} accent="emerald" />
      </div>

      {lowStockItems.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-amber-200 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {lowStockItems.length} item{lowStockItems.length > 1 ? 's' : ''} below threshold
              </div>
              <div className="text-xs text-amber-700">
                {lowStockItems.map(i => i.item).join(' · ')} — restock recommended
              </div>
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-amber-700 font-semibold">Auto-email armed</div>
        </div>
      )}

      <div className="rounded-lg border border-stone-200 bg-white p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-md flex items-center justify-center transition-all ${scanning ? 'bg-stone-900' : 'bg-stone-100'}`}>
            <Radio className={`w-5 h-5 ${scanning ? 'text-white animate-pulse' : 'text-stone-600'}`} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500 font-medium">Mercury API Reader</div>
            <div className="text-sm text-stone-800">tmr:///com4 — antenna 1 — protocol GEN2</div>
          </div>
        </div>
        <button onClick={simulateReaderScan} disabled={scanning}
          className="px-5 py-2.5 rounded-md text-xs uppercase tracking-widest font-semibold transition-all disabled:opacity-50 bg-stone-900 text-white hover:bg-stone-700">
          {scanning ? 'Scanning…' : 'Trigger Scan'}
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-widest text-stone-500 font-semibold">Shelf Inventory</h2>
          <div className="text-xs text-stone-400">tap +/− to simulate item add/remove (writes to backend)</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {inventory.map(item => (
            <InventoryCard key={item.item} item={item}
              onAdd={() => adjustCount(item.item, +1)}
              onRemove={() => adjustCount(item.item, -1)}
              onThresholdChange={(v) => setThreshold(item.item, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, suffix, icon, accent }) {
  const accentMap = {
    slate:   { text: '#0f172a', border: '#e7e5e4' },
    indigo:  { text: '#3730a3', border: '#c7d2fe' },
    amber:   { text: '#92400e', border: '#fcd34d' },
    emerald: { text: '#065f46', border: '#a7f3d0' },
  };
  const c = accentMap[accent];
  return (
    <div className="relative rounded-lg border p-5 overflow-hidden bg-white" style={{ borderColor: c.border }}>
      <div className="absolute top-3 right-3 opacity-30" style={{ color: c.text }}>
        {React.cloneElement(icon, { className: 'w-5 h-5' })}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2 font-medium">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold" style={{ color: c.text }}>{value}</div>
        {suffix && <div className="text-xs text-stone-400">{suffix}</div>}
      </div>
    </div>
  );
}

function InventoryCard({ item, onAdd, onRemove, onThresholdChange }) {
  const isLow = item.count < item.threshold;
  const fillPct = (item.count / (item.capacity || 1)) * 100;
  return (
    <div className={`relative rounded-lg border p-4 transition-all ${isLow ? 'border-amber-400' : 'border-stone-200'}`}
      style={{ background: isLow ? '#fffbeb' : '#ffffff' }}>
      {isLow ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[9px] uppercase tracking-widest font-bold">
          <TrendingDown className="w-2.5 h-2.5" />Low
        </div>
      ) : (
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] uppercase tracking-widest font-bold">OK</div>
      )}
      <div className="flex items-start gap-3 mb-3">
        <div className="text-3xl">{item.icon}</div>
        <div>
          <div className="text-base font-semibold text-stone-900">{item.item}</div>
          <div className="text-[10px] text-stone-400 uppercase tracking-widest">EPC mapped</div>
        </div>
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className={`text-3xl font-bold ${isLow ? 'text-amber-700' : 'text-stone-900'}`}>{item.count}</span>
        <span className="text-xs text-stone-400">/ {item.capacity}</span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden mb-3">
        <div className="h-full transition-all duration-500"
          style={{ width: `${fillPct}%`, background: isLow ? '#f59e0b' : '#0f172a' }} />
      </div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onRemove} disabled={item.count === 0}
          className="flex-1 h-8 rounded-md bg-stone-100 hover:bg-stone-200 disabled:opacity-30 transition flex items-center justify-center text-stone-700">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button onClick={onAdd} disabled={item.count === item.capacity}
          className="flex-1 h-8 rounded-md bg-stone-900 hover:bg-stone-700 disabled:opacity-30 transition flex items-center justify-center text-white">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-stone-500 font-medium">
        <span>Threshold</span>
        <div className="flex items-center gap-1">
          <button onClick={() => onThresholdChange(item.threshold - 1)} className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center">
            <Minus className="w-2.5 h-2.5" />
          </button>
          <span className="text-stone-900 w-6 text-center font-bold">{item.threshold}</span>
          <button onClick={() => onThresholdChange(item.threshold + 1)} className="w-5 h-5 rounded bg-stone-100 hover:bg-stone-200 flex items-center justify-center">
            <Plus className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmailView({ emailConfig, updateConfig, emailLog, sendTestEmails, lowStockItems, recipients, onPreview }) {
  const enabledCount = recipients.filter(r => r.enabled).length;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-stone-700" />
            <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">SMTP Configuration</h2>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-[10px] uppercase tracking-widest text-stone-500 font-medium">
              {emailConfig.enabled ? 'Active' : 'Disabled'}
            </span>
            <button onClick={() => updateConfig({ enabled: !emailConfig.enabled })}
              className={`relative w-9 h-5 rounded-full transition-all ${emailConfig.enabled ? 'bg-emerald-500' : 'bg-stone-300'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${emailConfig.enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </label>
        </div>

        <div className="space-y-4">
          <Field label="Sender (From)" icon={<Send className="w-3.5 h-3.5" />}
            value={emailConfig.sender} onChange={v => updateConfig({ sender: v })} />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="SMTP Server" value={emailConfig.smtp_server}
                onChange={v => updateConfig({ smtp_server: v })} />
            </div>
            <Field label="Port" value={emailConfig.smtp_port}
              onChange={v => updateConfig({ smtp_port: parseInt(v) || 587 })} />
          </div>
          <Field label="Cooldown (minutes)" value={emailConfig.cooldown_minutes}
            onChange={v => updateConfig({ cooldown_minutes: parseInt(v) || 0 })}
            help="Prevents repeated alerts for the same item within this window" />
        </div>

        <div className="mt-5 p-4 rounded-md bg-stone-50 border border-stone-200">
          <div className="text-[10px] uppercase tracking-widest text-stone-500 font-medium mb-1">Currently sending to</div>
          <div className="text-sm text-stone-900 font-semibold">{enabledCount} recipient{enabledCount !== 1 ? 's' : ''}</div>
          <div className="text-xs text-stone-500 mt-1">
            Each recipient gets a message tailored to their role. Edit messages on the Templates tab.
          </div>
        </div>

        <button onClick={sendTestEmails}
          className="mt-5 w-full py-3 rounded-md text-xs uppercase tracking-widest font-semibold flex items-center justify-center gap-2 transition bg-stone-900 text-white hover:bg-stone-700">
          <Send className="w-3.5 h-3.5" />Send Test Email to All Recipients
        </button>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-stone-700" />
            <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">Outbox</h2>
          </div>
          <span className="text-[10px] uppercase tracking-widest text-stone-500 font-medium">
            {emailLog.length} sent · {lowStockItems.length} pending
          </span>
        </div>

        {emailLog.length === 0 ? (
          <div className="text-center py-12 text-stone-400 text-sm">
            <Mail className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <div className="text-stone-500">No emails sent yet</div>
            <div className="text-xs mt-1 text-stone-400">Trigger a scan or remove items below threshold</div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {emailLog.map(e => (
              <button key={e.id} onClick={() => onPreview({
                ...e,
                to: e.to_addr,
                recipientName: e.recipient_name,
                time: new Date(e.sent_at).toLocaleTimeString('en-US', { hour12: false }),
              })}
                className="w-full text-left rounded-md border border-stone-200 bg-stone-50 hover:bg-stone-100 hover:border-stone-300 p-3 transition">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {e.email_type === 'alert' ? (
                      <span className="px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-amber-200 text-amber-900">Alert</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-indigo-200 text-indigo-900">Test</span>
                    )}
                    {e.role && <RoleBadge role={e.role} />}
                    {e.status && e.status.startsWith('FAILED') && (
                      <span className="px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold bg-red-200 text-red-900">Failed</span>
                    )}
                  </div>
                  <span className="text-[10px] text-stone-400">
                    {new Date(e.sent_at).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                </div>
                <div className="text-xs text-stone-500 mb-1">
                  To: <span className="text-stone-800 font-medium">{e.recipient_name}</span> &lt;{e.to_addr}&gt;
                </div>
                <div className="text-sm font-semibold text-stone-900 truncate">{e.subject}</div>
              </button>
            ))}
          </div>
        )}
        {emailLog.length > 0 && (
          <div className="mt-3 text-xs text-stone-400 text-center">Click any email to preview the full message</div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, icon, help }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5 flex items-center gap-1.5 font-medium">
        {icon}{label}
      </div>
      <input value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md bg-white border border-stone-300 focus:border-stone-900 focus:outline-none text-sm text-stone-900 transition" />
      {help && <div className="text-[10px] text-stone-400 mt-1">{help}</div>}
    </div>
  );
}

function RoleBadge({ role }) {
  const colors = {
    indigo:  'bg-indigo-100 text-indigo-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber:   'bg-amber-100 text-amber-800',
    slate:   'bg-stone-200 text-stone-800',
  };
  const def = ROLE_DEFS[role];
  if (!def) return null;
  return (
    <span className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold ${colors[def.color]}`}>
      {def.label}
    </span>
  );
}

function RecipientsView({ recipients, addRecipient, updateRecipient, removeRecipient, onPreview, onJumpToTemplate }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">Email Recipients</h2>
            <div className="text-xs text-stone-500 mt-1">Each recipient receives a message tailored to their role</div>
          </div>
          <button onClick={addRecipient}
            className="px-4 py-2 rounded-md text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition bg-stone-900 text-white hover:bg-stone-700">
            <UserPlus className="w-3.5 h-3.5" />Add Recipient
          </button>
        </div>

        <div className="space-y-3">
          {recipients.map(r => (
            <div key={r.id} className="grid grid-cols-12 gap-3 items-center p-3 rounded-md border border-stone-200 hover:border-stone-300 transition">
              <input value={r.name} onChange={e => updateRecipient(r.id, { name: e.target.value })} placeholder="Name"
                className="col-span-3 px-3 py-2 rounded-md bg-stone-50 border border-stone-200 focus:border-stone-900 focus:bg-white focus:outline-none text-sm transition" />
              <input value={r.email} onChange={e => updateRecipient(r.id, { email: e.target.value })} placeholder="email@example.com"
                className="col-span-4 px-3 py-2 rounded-md bg-stone-50 border border-stone-200 focus:border-stone-900 focus:bg-white focus:outline-none text-sm transition" />
              <select value={r.role} onChange={e => updateRecipient(r.id, { role: e.target.value })}
                className="col-span-3 px-3 py-2 rounded-md bg-stone-50 border border-stone-200 focus:border-stone-900 focus:bg-white focus:outline-none text-sm transition">
                {Object.entries(ROLE_DEFS).map(([key, def]) => (
                  <option key={key} value={key}>{def.label}</option>
                ))}
              </select>
              <div className="col-span-2 flex items-center justify-end gap-2">
                <button onClick={() => updateRecipient(r.id, { enabled: !r.enabled })}
                  className={`relative w-9 h-5 rounded-full transition-all ${r.enabled ? 'bg-emerald-500' : 'bg-stone-300'}`}
                  title={r.enabled ? 'Enabled' : 'Disabled'}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${r.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <button onClick={() => removeRecipient(r.id)}
                  className="w-8 h-8 rounded-md hover:bg-red-50 text-stone-400 hover:text-red-600 flex items-center justify-center transition" title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">Role-Based Messages</h2>
          <button onClick={onJumpToTemplate}
            className="text-xs uppercase tracking-widest font-semibold text-stone-700 hover:text-stone-900 flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Edit Templates
          </button>
        </div>
        <p className="text-xs text-stone-500 mb-5">When inventory drops below threshold, each role receives a different email written for them. Click "Preview" to see a sample.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(ROLE_DEFS).map(([key, def]) => (
            <div key={key} className="rounded-md border border-stone-200 p-4 hover:border-stone-300 transition">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1"><RoleBadge role={key} /></div>
                  <div className="text-sm text-stone-700 mt-2">{def.description}</div>
                </div>
                <button onClick={() => onPreview(key)}
                  className="px-3 py-1.5 rounded text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1 bg-stone-100 hover:bg-stone-200 text-stone-700 transition">
                  <Eye className="w-3 h-3" />Preview
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplatesView({ templates, updateTemplate, resetAllTemplates }) {
  const [activeRole, setActiveRole] = useState('manager');
  const tpl = templates[activeRole];

  if (!tpl) return <div className="text-stone-500">Loading templates…</div>;

  const sampleVars = {
    item: 'Cheese', count: 1, threshold: 3, reorderQty: 6,
    timestamp: new Date().toISOString(),
    recipient: 'Sara Chen',
    role: ROLE_DEFS[activeRole].label,
  };
  const previewSubject = fillTemplate(tpl.subject, sampleVars);
  const previewBody = fillTemplate(tpl.body, sampleVars);

  function insertPlaceholder(token) {
    updateTemplate(activeRole, { body: (tpl.body || '') + token });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-stone-700" />
              <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">Email Templates</h2>
            </div>
            <p className="text-xs text-stone-500 max-w-2xl">
              Customize the subject and body of each role's email. Use placeholder tokens like <code className="px-1 py-0.5 bg-stone-100 rounded text-stone-800 font-mono">{'{item}'}</code> — they'll be filled in automatically when an alert fires. Changes are saved to the backend on every keystroke.
            </p>
          </div>
          <button onClick={resetAllTemplates}
            className="px-3 py-2 rounded-md text-[10px] uppercase tracking-widest font-semibold flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 transition whitespace-nowrap">
            <RotateCcw className="w-3 h-3" />Reset All
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {Object.entries(ROLE_DEFS).map(([key, def]) => (
            <button key={key} onClick={() => setActiveRole(key)}
              className={`px-3 py-2 rounded-md text-xs font-semibold transition border ${
                activeRole === key
                  ? 'bg-stone-900 text-white border-stone-900'
                  : 'bg-white text-stone-700 border-stone-300 hover:border-stone-400'
              }`}>
              {def.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs uppercase tracking-widest font-semibold text-stone-700">Editing:</span>
            <RoleBadge role={activeRole} />
          </div>

          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5 font-medium">Subject</div>
            <input value={tpl.subject}
              onChange={e => updateTemplate(activeRole, { subject: e.target.value })}
              className="w-full px-3 py-2 rounded-md bg-white border border-stone-300 focus:border-stone-900 focus:outline-none text-sm text-stone-900 transition" />
          </div>

          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-1.5 font-medium">Body</div>
            <textarea value={tpl.body}
              onChange={e => updateTemplate(activeRole, { body: e.target.value })}
              rows={14}
              className="w-full px-3 py-2 rounded-md bg-white border border-stone-300 focus:border-stone-900 focus:outline-none text-sm text-stone-900 transition font-mono leading-relaxed resize-none" />
          </div>

          <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
            <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2 font-medium">
              Click a placeholder to add it to the body
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map(p => (
                <button key={p.token} onClick={() => insertPlaceholder(p.token)}
                  title={p.desc}
                  className="px-2 py-1 rounded bg-white border border-stone-300 hover:border-stone-900 hover:bg-stone-900 hover:text-white text-xs font-mono transition">
                  {p.token}
                </button>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-stone-200 space-y-1">
              {PLACEHOLDERS.map(p => (
                <div key={p.token} className="flex items-start gap-2 text-[11px]">
                  <code className="font-mono text-stone-800 w-24 flex-shrink-0">{p.token}</code>
                  <span className="text-stone-500">{p.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-stone-700" />
              <span className="text-xs uppercase tracking-widest font-semibold text-stone-700">Live Preview</span>
            </div>
            <span className="text-[10px] text-stone-400">with sample data</span>
          </div>

          <div className="rounded-md border border-stone-200 bg-stone-50 overflow-hidden">
            <div className="px-4 py-3 bg-white border-b border-stone-200 text-xs space-y-1">
              <div className="flex">
                <span className="w-14 text-stone-500 text-[10px] uppercase tracking-widest font-medium pt-0.5">Subject</span>
                <span className="text-stone-900 font-semibold">{previewSubject}</span>
              </div>
            </div>
            <div className="px-4 py-4 max-h-[420px] overflow-y-auto">
              <pre className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: '"Söhne", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                {previewBody}
              </pre>
            </div>
          </div>

          <div className="mt-3 px-3 py-2 rounded bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-800">
            <strong>Sample values used:</strong> item = "Cheese", count = 1, threshold = 3.
            Real alerts substitute the actual product name and counts.
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailPreviewModal({ email, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.5)' }} onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-stone-700" />
            <span className="text-xs uppercase tracking-widest font-semibold text-stone-700">Email Preview</span>
            {email.role && <RoleBadge role={email.role} />}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded hover:bg-stone-200 flex items-center justify-center text-stone-500 hover:text-stone-900 transition">✕</button>
        </div>

        <div className="px-6 py-4 border-b border-stone-200 space-y-1.5 text-sm">
          {email.recipientName && (
            <div className="flex">
              <span className="w-16 text-stone-500 text-xs uppercase tracking-widest font-medium pt-0.5">To</span>
              <span className="flex-1 text-stone-900">{email.recipientName}{email.to && <span className="text-stone-500"> &lt;{email.to}&gt;</span>}</span>
            </div>
          )}
          <div className="flex">
            <span className="w-16 text-stone-500 text-xs uppercase tracking-widest font-medium pt-0.5">Subject</span>
            <span className="flex-1 text-stone-900 font-semibold">{email.subject}</span>
          </div>
          {email.time && (
            <div className="flex">
              <span className="w-16 text-stone-500 text-xs uppercase tracking-widest font-medium pt-0.5">Sent</span>
              <span className="flex-1 text-stone-700">{email.time}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-5 max-h-[400px] overflow-y-auto">
          <pre className="text-sm text-stone-800 whitespace-pre-wrap leading-relaxed" style={{ fontFamily: '"Söhne", "Helvetica Neue", Helvetica, Arial, sans-serif' }}>
            {email.body}
          </pre>
        </div>

        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-md text-xs uppercase tracking-widest font-semibold bg-stone-900 text-white hover:bg-stone-700 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ScanLogView({ scanLog }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-stone-700" />
          <h2 className="text-sm uppercase tracking-widest font-semibold text-stone-900">Live Scan Log</h2>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-stone-500 font-medium">
          Tail · last {scanLog.length} events
        </span>
      </div>

      <div className="font-mono text-xs">
        <div className="grid grid-cols-12 gap-3 px-3 py-2 text-[10px] uppercase tracking-widest text-stone-500 font-semibold border-b border-stone-200">
          <div className="col-span-2">Time</div>
          <div className="col-span-6">EPC</div>
          <div className="col-span-2">Item</div>
          <div className="col-span-2">Action</div>
        </div>
        {scanLog.map((e, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-3 px-3 py-2 hover:bg-stone-50 rounded transition">
            <div className="col-span-2 text-stone-500">
              {new Date(e.scan_at).toLocaleTimeString('en-US', { hour12: false })}
            </div>
            <div className="col-span-6 text-stone-700 break-all">{e.epc}</div>
            <div className="col-span-2 text-stone-900 font-semibold">{e.item}</div>
            <div className="col-span-2">
              <span className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-bold ${
                e.action === 'detected' ? 'bg-emerald-100 text-emerald-800' :
                e.action === 'unknown' ? 'bg-red-100 text-red-800' :
                'bg-stone-200 text-stone-800'
              }`}>{e.action}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
