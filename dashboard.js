/**
 * MazenOS Central Dashboard Logic (dashboard.js)
 * Connects Ari/Jade Chat, History Rollback Drawer, Rate-Limit Provider Interceptor,
 * AI Mom Continuous Work Alert, and Live Status Strip.
 */

const state = {
  activeAgent: 'ari',
  sessionId: 'session_main',
  pendingRetryMessage: null,
  suggestedProvider: null
};

function getAuthHeaders() {
  let token = '';
  try {
    token = localStorage.getItem('mazenos_auth_token') || '';
  } catch {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function getLocalStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setLocalStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function updateDateHeader() {
  const el = document.getElementById('currentDateDisplay');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function checkContinuousWorkAlert() {
  const sessions = getLocalStore('mazenos_focus_sessions', []);
  const totalMinutes = sessions.reduce((acc, s) => acc + (Number(s.duration_minutes) || 0), 0);
  const banner = document.getElementById('hydrationBanner');
  if (banner && totalMinutes >= 150) {
    banner.classList.add('active');
  }
}

async function refreshStatusStrip() {
  try {
    const res = await fetch('/api/state', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Offline mode');
    const data = await res.json();
    renderStatusStrip(data);
  } catch {
    const tasks = getLocalStore('mazenos_tasks', []);
    const activeP1 = tasks.find(t => t.priority === 1 && t.status !== 'completed');
    const healthLogs = getLocalStore('mazenos_health_logs', {});
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayHealth = healthLogs[todayKey] || null;
    const budget = getLocalStore('mazenos_budget', []);
    const latestBal = budget.length > 0 && budget[0].balance_after_sar != null ? budget[0].balance_after_sar : 0;

    renderStatusStrip({
      locked: false,
      active_p1: activeP1 ? { title: activeP1.title } : null,
      health: todayHealth ? {
        sleep_hours: todayHealth.sleep_hours,
        meds: `${todayHealth.medicine_taken_count || 0}/${todayHealth.medicine_target_count || 0}`,
        is_sick: todayHealth.is_sick
      } : null,
      budget_balance_sar: latestBal
    });

    const activeCount = tasks.filter(t => t.status !== 'completed').length;
    const cardTaskCount = document.getElementById('cardTaskCount');
    if (cardTaskCount) cardTaskCount.textContent = `${activeCount} Active`;

    const units = getLocalStore('mazenos_curriculum', []);
    const cardCurryCount = document.getElementById('cardCurryCount');
    if (cardCurryCount) cardCurryCount.textContent = `${units.length} Units`;
  }
}

function renderStatusStrip(data) {
  const lockPill = document.getElementById('statusLockPill');
  const p1Pill = document.getElementById('statusP1Pill');
  const healthPill = document.getElementById('statusHealthPill');
  const budgetPill = document.getElementById('statusBudgetPill');

  if (lockPill) {
    lockPill.textContent = data.locked ? 'Phone Status: Locked (Overdue P1)' : 'Phone Status: Unlocked';
  }
  if (p1Pill) {
    p1Pill.textContent = data.active_p1 ? `Active Priority 1: ${data.active_p1.title}` : 'Active Priority 1: None';
  }
  if (healthPill) {
    if (data.health && data.health.sleep_hours != null) {
      healthPill.textContent = `Sleep: ${data.health.sleep_hours}h | Meds: ${data.health.meds}${data.health.is_sick ? ' (Sick Mode)' : ''}`;
    } else {
      healthPill.textContent = 'Sleep & Meds: Not logged today';
    }
  }
  if (budgetPill) {
    budgetPill.textContent = `Balance: ${Number(data.budget_balance_sar || 0).toFixed(2)} SAR`;
  }
}

function setAgent(agent) {
  state.activeAgent = agent === 'jade' ? 'jade' : 'ari';
  const ariBtn = document.getElementById('switchAriBtn');
  const jadeBtn = document.getElementById('switchJadeBtn');
  const titleEl = document.getElementById('activeAgentTitle');
  const subEl = document.getElementById('activeAgentSubtitle');
  const sendBtn = document.getElementById('sendChatBtn');

  if (state.activeAgent === 'ari') {
    ariBtn.className = 'agent-btn active-ari';
    jadeBtn.className = 'agent-btn';
    titleEl.textContent = 'Ari — Execution & Scheduling';
    subEl.textContent = 'Direct, disciplined task scheduling and proof verification';
    sendBtn.className = 'btn btn-primary';
  } else {
    ariBtn.className = 'agent-btn';
    jadeBtn.className = 'agent-btn active-jade';
    titleEl.textContent = 'Jade — Perspective & Debrief';
    subEl.textContent = 'Grounded support, emotional regulation, and diary reflection';
    sendBtn.className = 'btn btn-jade';
  }
  loadChatHistory();
}

async function loadChatHistory() {
  const stream = document.getElementById('chatStream');
  let messages = [];
  try {
    const res = await fetch(`/api/chat/history?session_id=${encodeURIComponent(state.sessionId)}&agent=${state.activeAgent}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    messages = data.messages || [];
  } catch {
    const all = getLocalStore('mazenos_chat_messages', []);
    messages = all.filter(m => m.session_id === state.sessionId && m.agent === state.activeAgent);
  }

  renderMessages(messages);
  renderHistorySessions();
}

function renderMessages(messages) {
  const stream = document.getElementById('chatStream');
  if (!stream) return;
  stream.innerHTML = '';

  if (!messages || messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<h3>Start a conversation with ${state.activeAgent === 'ari' ? 'Ari' : 'Jade'}</h3>
      <p>${state.activeAgent === 'ari'
        ? 'Ari schedules tasks, checks commute friction, and audits completion proofs.'
        : 'Jade helps you reflect on your week, regulate stress, and debrief diary entries.'}</p>`;
    stream.appendChild(empty);
    return;
  }

  for (const m of messages) {
    const div = document.createElement('div');
    div.className = `msg-bubble ${m.sender === 'user' ? 'msg-user' : (state.activeAgent === 'jade' ? 'msg-jade' : 'msg-ari')}`;
    div.textContent = m.message_text;
    stream.appendChild(div);
  }
  stream.scrollTop = stream.scrollHeight;
}

function renderHistorySessions() {
  const listEl = document.getElementById('historySessionList');
  if (!listEl) return;
  const all = getLocalStore('mazenos_chat_messages', []);
  const sessions = Array.from(new Set(['session_main', ...all.map(m => m.session_id)]));
  listEl.innerHTML = '';

  for (const sId of sessions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-secondary';
    btn.style.justifyContent = 'flex-start';
    btn.textContent = sId === 'session_main' ? 'Default Conversation' : sId;
    btn.addEventListener('click', () => {
      state.sessionId = sId;
      loadChatHistory();
    });
    listEl.appendChild(btn);
  }
}

async function sendChatMessage(messageText, overrideProvider = null) {
  const allLocal = getLocalStore('mazenos_chat_messages', []);
  allLocal.push({
    id: `msg_${Date.now()}`,
    session_id: state.sessionId,
    agent: state.activeAgent,
    sender: 'user',
    message_text: messageText,
    created_at: new Date().toISOString()
  });
  setLocalStore('mazenos_chat_messages', allLocal);
  await loadChatHistory();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        session_id: state.sessionId,
        agent: state.activeAgent,
        message_text: messageText,
        override_provider: overrideProvider
      })
    });

    if (res.status === 429) {
      const errData = await res.json();
      if (errData.intercept_code === 'PROVIDER_POOL_EXHAUSTED') {
        state.pendingRetryMessage = messageText;
        state.suggestedProvider = errData.suggested_provider || 'claude';
        document.getElementById('rateLimitMessage').textContent =
          `Your ${errData.exhausted_provider} pool hit an HTTP 429 limit. Switch to ${state.suggestedProvider} with one tap?`;
        document.getElementById('rateLimitModal').classList.add('open');
        return;
      }
    }

    if (!res.ok) throw new Error('Worker offline');
    const data = await res.json();
    allLocal.push({
      id: `msg_${Date.now() + 1}`,
      session_id: state.sessionId,
      agent: state.activeAgent,
      sender: 'assistant',
      message_text: data.reply,
      created_at: new Date().toISOString()
    });
    setLocalStore('mazenos_chat_messages', allLocal);
    await loadChatHistory();
  } catch {
    const tasks = getLocalStore('mazenos_tasks', []);
    const p1 = tasks.find(t => t.priority === 1 && t.status !== 'completed');
    const reply = state.activeAgent === 'ari'
      ? (p1
          ? `Ari: Your active Priority 1 task is "${p1.title}". Focus on finishing it before taking on secondary items.`
          : `Ari: Queue is clear of Priority 1 blockers. Log your next target in Tasks or review your syllabus units in Curry.`)
      : `Jade: Take a steady breath. You are keeping your system organized—let's focus on one calm, meaningful step at a time.`;

    allLocal.push({
      id: `msg_${Date.now() + 1}`,
      session_id: state.sessionId,
      agent: state.activeAgent,
      sender: 'assistant',
      message_text: reply,
      created_at: new Date().toISOString()
    });
    setLocalStore('mazenos_chat_messages', allLocal);
    await loadChatHistory();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateDateHeader();
  checkContinuousWorkAlert();
  refreshStatusStrip();
  loadChatHistory();

  document.getElementById('switchAriBtn')?.addEventListener('click', () => setAgent('ari'));
  document.getElementById('switchJadeBtn')?.addEventListener('click', () => setAgent('jade'));

  document.getElementById('toggleHistoryBtn')?.addEventListener('click', () => {
    document.getElementById('historyDrawer')?.classList.toggle('open');
  });

  document.getElementById('newChatSessionBtn')?.addEventListener('click', () => {
    state.sessionId = `session_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
    loadChatHistory();
  });

  document.getElementById('dismissHydrationBtn')?.addEventListener('click', () => {
    document.getElementById('hydrationBanner')?.classList.remove('active');
  });

  document.getElementById('chatForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await sendChatMessage(text);
  });

  document.getElementById('cancelSwitchProviderBtn')?.addEventListener('click', () => {
    document.getElementById('rateLimitModal')?.classList.remove('open');
  });

  document.getElementById('confirmSwitchProviderBtn')?.addEventListener('click', async () => {
    document.getElementById('rateLimitModal')?.classList.remove('open');
    if (state.pendingRetryMessage && state.suggestedProvider) {
      await sendChatMessage(state.pendingRetryMessage, state.suggestedProvider);
      state.pendingRetryMessage = null;
    }
  });
});
