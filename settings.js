import { SharedBreakEngine, mountSharedBreakModal } from './breaks-shared.js';
/**
 * MazenOS Settings Logic (settings.js)
 * Plain-English Tool Settings, Daily Break Planning Window link, AI Keys, and Auto-Generated MacroDroid Token.
 */

const CONTEXT_CONFIGS = {
  dashboard: {
    title: 'Dashboard & Daily Breaks',
    fields: [
      { key: 'day_start_hour', label: 'Day Start Time (Daily Rollover Hour, 0 = Midnight, 3 = 03:00 AM)', type: 'number', placeholder: '3', defaultVal: '3' }
    ],
    showBreakPlannerLink: true
  },
  taskitator: {
    title: 'Taskitator Settings',
    fields: [
      { key: 'default_task_minutes', label: 'Default Task Length (Minutes)', type: 'number', placeholder: '45', defaultVal: '45' }
    ],
    showBreakPlannerLink: true
  },
  budget: {
    title: 'Budget Settings',
    fields: [
      { key: 'default_wallet_name', label: 'Default Card / Wallet Name', type: 'text', placeholder: 'Card *4821', defaultVal: 'Card *4821' }
    ]
  },
  blocker: {
    title: 'Blocker & Confinement Settings',
    fields: [
      { key: 'max_commute_ratio_percent', label: 'Max Round-Trip Commute (% of Study Session)', type: 'number', placeholder: '35', defaultVal: '35' },
      { key: 'idea_capture_seconds', label: 'Vibe Coding Idea Timer (Seconds)', type: 'number', placeholder: '180', defaultVal: '180' }
    ]
  },
  curry: {
    title: 'Study Assistant Settings',
    fields: [
      { key: 'main_objective_ratio', label: 'Main Study Topic Share (%)', type: 'number', placeholder: '70', defaultVal: '70' }
    ]
  },
  health: {
    title: 'Sleep & Health Settings',
    fields: [
      { key: 'burnout_sleep_threshold', label: 'Low Sleep Warning Threshold (Hours)', type: 'number', placeholder: '4', defaultVal: '4' }
    ]
  },
  diary: {
    title: 'Diary Settings',
    fields: [
      { key: 'default_mood_tag', label: 'Default Mood', type: 'text', placeholder: 'Grounded', defaultVal: 'Grounded' }
    ]
  },
  leisure: {
    title: 'Leisure Hub Settings',
    fields: [
      { key: 'protected_hobby_day', label: 'Weekly Day Off', type: 'text', placeholder: 'Friday', defaultVal: 'Friday' }
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

function generateRandomToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = 'mzn_';
  for (let i = 0; i < 24; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      storedSettings = { ...storedSettings, ...(data.settings || {}) };
      saveLocalSettings(storedSettings);
    }
  } catch {}

  if (!storedSettings.macrodroid_token) {
    storedSettings.macrodroid_token = generateRandomToken();
    saveLocalSettings(storedSettings);
    persistSettings({ macrodroid_token: storedSettings.macrodroid_token });
  }

  document.getElementById('aiProviderSelect').value = storedSettings.ai_provider || 'gemini';
  document.getElementById('modelTierSelect').value = storedSettings.model_tier || 'light';
  document.getElementById('geminiKeyInput').value = storedSettings.gemini_api_key || '';
  document.getElementById('claudeKeyInput').value = storedSettings.claude_api_key || '';
  document.getElementById('macrodroidTokenInput').value = storedSettings.macrodroid_token;

  const params = new URLSearchParams(window.location.search);
  const rawFrom = params.get('from') || 'dashboard';
  const from = (rawFrom === 'locations' || rawFrom === 'ideas') ? 'blocker' : rawFrom;
  const pageMap = {
    dashboard: 'index.html',
    taskitator: 'taskitator.html#today',
    curry: 'curry.html',
    health: 'health.html',
    blocker: 'blocker.html',
    diary: 'diary.html',
    budget: 'budget.html',
    leisure: 'leisure.html'
  };
  const backLink = document.getElementById('settingsBackLink');
  if (backLink && pageMap[from]) {
    backLink.href = pageMap[from];
  }
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
  const curDayStart = SharedBreakEngine.getDayStartHour();
  storedSettings.day_start_hour = String(curDayStart);

  let html = cfg.fields.map(f => {
    if (f.key === 'day_start_hour') {
      return `
        <div class="form-group">
          <label for="ctx_day_start_hour">Day Start Time (Daily Rollover — Shared with Taskitator)</label>
          <select id="ctx_day_start_hour" data-setting-key="day_start_hour">
            <option value="0" ${curDayStart === 0 ? 'selected' : ''}>00:00 (Standard Midnight)</option>
            <option value="1" ${curDayStart === 1 ? 'selected' : ''}>01:00 AM</option>
            <option value="2" ${curDayStart === 2 ? 'selected' : ''}>02:00 AM</option>
            <option value="3" ${curDayStart === 3 ? 'selected' : ''}>03:00 AM (Recommended for Night Owls)</option>
            <option value="4" ${curDayStart === 4 ? 'selected' : ''}>04:00 AM</option>
          </select>
        </div>
      `;
    }
    return `
      <div class="form-group">
        <label for="ctx_${f.key}">${f.label}</label>
        <input type="${f.type}" id="ctx_${f.key}" data-setting-key="${f.key}" value="${storedSettings[f.key] ?? f.defaultVal}" placeholder="${f.placeholder}">
      </div>
    `;
  }).join('');

  if (cfg.showBreakPlannerLink) {
    const st = SharedBreakEngine.getPlanningStatus();
    const brks = SharedBreakEngine.getTodayBreaks();
    const fmtH = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const cycleTxt = `Current Cycle: <strong>${fmtH(st.bounds.start)}</strong> today &rarr; <strong>${fmtH(st.bounds.end)}</strong> tomorrow (Lockout buffer starts at ${fmtH(st.bounds.cutoff6h)}).`;
    const brkSummary = brks.length > 0 ? `Scheduled today: <strong>${brks.map(b => `${b.start}–${b.end}`).join(', ')}</strong>` : 'No breaks scheduled yet for this cycle.';
    html += `
      <div class="card" style="background:var(--bg-elevated);margin-bottom:1rem;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:0.75rem;">
          <div>
            <strong>Daily Breaks (Shared 10-Minute Planning Window)</strong>
            <p class="card-subtitle" style="margin-top:0.2rem;">Changes here or in Taskitator sync automatically across the system.</p>
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.45rem;">${cycleTxt}</div>
            <div style="font-size:0.84rem;color:var(--text-primary);margin-top:0.25rem;">${brkSummary}</div>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="openBreakPlannerFromSettingsBtn">⏸️ Plan / Edit Daily Breaks</button>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
  container.querySelector('#ctx_day_start_hour')?.addEventListener('change', (e) => {
    const h = SharedBreakEngine.setDayStartHour(e.target.value);
    persistSettings({ day_start_hour: String(h) });
    renderContextualFields(moduleKey);
  });
  container.querySelector('#openBreakPlannerFromSettingsBtn')?.addEventListener('click', () => {
    window.SharedBreakUI?.openModal();
  });
}

async function persistSettings(updates) {
  storedSettings = { ...storedSettings, ...updates };
  saveLocalSettings(storedSettings);
  if (updates.day_start_hour !== undefined) {
    try {
      const tkSet = JSON.parse(localStorage.getItem('taskitator_settings') || '{}');
      tkSet.day_start_hour = Math.min(4, Math.max(0, parseInt(updates.day_start_hour, 10) || 0));
      localStorage.setItem('taskitator_settings', JSON.stringify(tkSet));
    } catch {}
  }
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: updates })
    });
  } catch {}
}

function __initModule() {
  mountSharedBreakModal();
  fetchSettings();
  window.addEventListener('mazenos-breaks-synced', () => {
    const sel = document.getElementById('contextModuleSelector');
    renderContextualFields(sel ? sel.value : 'dashboard');
  });

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
    showToast('Tool settings saved.');
  });

  document.getElementById('copyMacrodroidTokenBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('macrodroidTokenInput');
    if (!inp) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inp.value).then(() => showToast('Token copied! Paste it into MacroDroid.'));
    } else {
      inp.select();
      document.execCommand('copy');
      showToast('Token copied! Paste it into MacroDroid.');
    }
  });

  document.getElementById('regenMacrodroidTokenBtn')?.addEventListener('click', async () => {
    const newToken = generateRandomToken();
    const inp = document.getElementById('macrodroidTokenInput');
    if (inp) inp.value = newToken;
    await persistSettings({ macrodroid_token: newToken });
    showToast('New MacroDroid token generated and saved.');
  });

  document.getElementById('universalSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      ai_provider: document.getElementById('aiProviderSelect').value,
      model_tier: document.getElementById('modelTierSelect').value,
      gemini_api_key: document.getElementById('geminiKeyInput').value.trim(),
      claude_api_key: document.getElementById('claudeKeyInput').value.trim(),
      macrodroid_token: document.getElementById('macrodroidTokenInput').value.trim()
    };
    await persistSettings(updates);
    showToast('Settings saved.');
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
