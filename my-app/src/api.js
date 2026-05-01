// src/api.js
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getInventory:    ()              => request('/inventory'),
  updateInventory: (item, patch)   => request(`/inventory/${item}`, { method: 'PUT', body: JSON.stringify(patch) }),

  getRecipients:   ()              => request('/recipients'),
  addRecipient:    (data)          => request('/recipients', { method: 'POST', body: JSON.stringify(data) }),
  updateRecipient: (id, patch)     => request(`/recipients/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteRecipient: (id)            => request(`/recipients/${id}`, { method: 'DELETE' }),

  getTemplates:    ()              => request('/templates'),
  updateTemplate:  (role, patch)   => request(`/templates/${role}`, { method: 'PUT', body: JSON.stringify(patch) }),
  resetTemplates:  ()              => request('/templates/reset', { method: 'POST' }),

  getConfig:       ()              => request('/config'),
  updateConfig:    (patch)         => request('/config', { method: 'PUT', body: JSON.stringify(patch) }),

  getEmails:       ()              => request('/emails'),
  sendTestEmail:   ()              => request('/test-email', { method: 'POST' }),

  getScans:        ()              => request('/scans'),
  health:          ()              => request('/health'),
};