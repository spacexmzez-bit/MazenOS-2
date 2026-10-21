/**
 * Universal & Contextual Settings Logic (settings.js)
 * Top section adapts dynamically to ?from=<tool>; Bottom section controls global AI pools,
 * API keys, MacroDroid Bearer Token, and Master Authentication Password.
 */

const CONTEXT_CONFIGS = {
  dashboard: {
    title: 'Dashboard & Rest Window Settings',
    fields: [
      { key: 'rest_window', label: 'Daily Riyadh Rest Window (Phone Unlocked)', type: 'text', placeholder: '12:30 - 13:15', defaultVal: '12:30 - 13:15' }
    ]
  },
  taskitator: {
    title: 'Tasks & Consecutive Cascade Settings',
    fields: [
      { key: 'default_task_minutes', label: 'Default Task Duration (Minutes)', type: 'number', placeholder: '45', defaultVal: '45' }
    ]
  },
  curry: {
    title: 'Syllabus & Curry Pacing Settings',
    fields: [
      { key: 'main_objective_ratio', label: 'Main Objective Focus Share (%)', type: 'number', placeholder: '70', defaultVal: '70' }
    ]
  },
  health: {
    title: 'Health & Medicine Defaults',
    fields: [
      { key: 'burnout_sleep_threshold', label: 'Acute Exhaustion Sleep Threshold (Hours)', type: 'number', placeholder: '4', defaultVal: '4' }
    ]
  },
  locations: {
    title: 'Study Locations & Commute Gate Settings',
    fields: [
      { key: 'max_commute_ratio_percent', label: 'Maximum Allowed Round-Trip Commute Share (%)', type: 'number', placeholder: '35', defaultVal: '35' }
    ]
  },
  ideas: {
    title: 'Idea Vault Confinement Settings',
    fields: [
      { key: 'idea_capture_seconds', label: 'Quick Capture Countdown Timer (Seconds)', type: 'number', placeholder: '180', defaultVal: '180' }
    ]
  },
  diary: {
    title: 'Diary & Reflection Settings',
    fields: [
      { key: 'default_mood_tag', label: 'Default Mood Tag', type: 'text', placeholder: 'Grounded', defaultVal: 'Grounded' }
    ]
  },
  budget: {
    title: 'Budget & SMS Parser Settings',
    fields: [
      { key: 'default_wallet_name', label: 'Default Card / Wallet Label', type: 'text', placeholder: 'Card *4821', defaultVal: 'Card *4821' }
    ]
  },
  leisure: {
    title: 'Leisure & Friday Protection Settings',
    fields: [
      { key: 'protected_hobby_day', label: 'Protected Builder Day', type: 'text', placeholder: 'Friday', defaultVal: 'Friday' }
    ]
  }
};

let storedSettings = {};

function showToast(msg) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function getAuthHeaders() {
  let token = '';
  try { token = localStorage.getItem('mazenos_auth_token') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function loadLocalSettings() {
  try { return JSON.parse(localStorage.getItem('mazenos_settings') || '{}'); } catch { return {}; }
}

function saveLocalSettings(obj) {
  try { localStorage.setItem('mazenos_settings', JSON.stringify(obj)); } catch {}
}

async function fetchSettings() {
  storedSettings = loadLocalSettings();
  try {
    const res = await fetch('/api/settings', { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      storedSettings = { ...storedSettings, ...(data.settings || {}) };
      saveLocalSettings(storedSettings);
    }
  } catch {}

  document.getElementById('aiProviderSelect').value = storedSettings.ai_provider || 'gemini';
  document.getElementById('modelTierSelect').value = storedSettings.model_tier || 'light';
  document.getElementById('geminiKeyInput').value = storedSettings.gemini_api_key || '';
  document.getElementById('claudeKeyInput').value = storedSettings.claude_api_key || '';
  document.getElementById('macrodroidTokenInput').value = storedSettings.macrodroid_token || '';
  document.getElementById('masterPasswordInput').value = storedSettings.master_password || '';

  const params = new URLSearchParams(window.location.search);
  const from = params.get('from') || 'dashboard';
  const selector = document.getElementById('contextModuleSelector');
  if (selector && CONTEXT_CONFIGS[from]) {
    selector.value = from;
  }
  renderContextualFields(selector ? selector.value : 'dashboard');
}

function renderContextualFields(moduleKey) {
  const cfg = CONTEXT_CONFIGS[moduleKey] || CONTEXT_CONFIGS.dashboard;
  document.getElementById('contextSectionTitle').textContent = cfg.title;
  const container = document.getElementById('contextualFieldsContainer');
  container.innerHTML = cfg.fields.map(f => `
    <div class="form-group">
      <label for="ctx_${f.key}">${f.label}</label>
      <input type="${f.type}" id="ctx_${f.key}" data-setting-key="${f.key}" value="${storedSettings[f.key] ?? f.defaultVal}" placeholder="${f.placeholder}">
    </div>
  `).join('');
}

async function persistSettings(updates) {
  storedSettings = { ...storedSettings, ...updates };
  saveLocalSettings(storedSettings);
  if (updates.master_password !== undefined && updates.master_password !== '') {
    try { localStorage.setItem('mazenos_auth_token', updates.master_password); } catch {}
  }
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ settings: updates })
    });
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  fetchSettings();

  document.getElementById('contextModuleSelector')?.addEventListener('change', (e) => {
    renderContextualFields(e.target.value);
  });

  document.getElementById('contextualSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {};
    document.querySelectorAll('#contextualFieldsContainer [data-setting-key]').forEach(inp => {
      updates[inp.dataset.settingKey] = inp.value.trim();
    });
    await persistSettings(updates);
    showToast('Contextual settings saved.');
  });

  document.getElementById('universalSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      ai_provider: document.getElementById('aiProviderSelect').value,
      model_tier: document.getElementById('modelTierSelect').value,
      gemini_api_key: document.getElementById('geminiKeyInput').value.trim(),
      claude_api_key: document.getElementById('claudeKeyInput').value.trim(),
      macrodroid_token: document.getElementById('macrodroidTokenInput').value.trim(),
      master_password: document.getElementById('masterPasswordInput').value.trim()
    };
    await persistSettings(updates);
    showToast('Universal system settings saved.');
  });
});
