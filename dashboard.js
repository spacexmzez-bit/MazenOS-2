import { mountSharedBreakModal } from './breaks-shared.js';
/**
 * MazenOS Dashboard Logic (dashboard.js)
 * Connects Ari & Jade Chat, History Drawer, Ari Expense Logging, and Break Reminders.
 */

const state = {
  activeAgent: 'ari',
  sessionId: 'session_main',
  pendingRetryMessage: null,
  suggestedProvider: null
};

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

function setAgent(agent) {
  state.activeAgent = agent === 'jade' ? 'jade' : 'ari';
  const ariBtn = document.getElementById('switchAriBtn');
  const jadeBtn = document.getElementById('switchJadeBtn');
  const titleEl = document.getElementById('activeAgentTitle');
  const subEl = document.getElementById('activeAgentSubtitle');
  const sendBtn = document.getElementById('sendChatBtn');
  const inputEl = document.getElementById('chatInput');

  if (state.activeAgent === 'ari') {
    ariBtn.className = 'agent-btn active-ari';
    jadeBtn.className = 'agent-btn';
    titleEl.textContent = 'Ari';
    subEl.textContent = 'Tasks, schedule & budget';
    sendBtn.className = 'btn btn-primary';
    if (inputEl) inputEl.placeholder = 'Message Ari...';
  } else {
    ariBtn.className = 'agent-btn';
    jadeBtn.className = 'agent-btn active-jade';
    titleEl.textContent = 'Jade';
    subEl.textContent = 'Chat & journal';
    sendBtn.className = 'btn btn-jade';
    if (inputEl) inputEl.placeholder = 'Message Jade...';
  }
  loadChatHistory();
}

async function loadChatHistory() {
  let messages = [];
  try {
    const res = await fetch(`/api/chat/history?session_id=${encodeURIComponent(state.sessionId)}&agent=${state.activeAgent}`);
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
    empty.innerHTML = `<h3>Chat with ${state.activeAgent === 'ari' ? 'Ari' : 'Jade'}</h3>
      <p>${state.activeAgent === 'ari'
        ? 'Ask Ari to plan your tasks, log an expense, or check your schedule.'
        : 'Talk through your day with Jade or reflect on your journal.'}</p>`;
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
    btn.textContent = sId === 'session_main' ? 'Main Chat' : sId;
    btn.addEventListener('click', () => {
      state.sessionId = sId;
      loadChatHistory();
    });
    listEl.appendChild(btn);
  }
}

function tryParseExpenseFromChat(text) {
  if (state.activeAgent !== 'ari') return null;
  const lower = text.toLowerCase();
  const hasSpendVerb = /\b(spent|paid|bought|expense|log|cost|purchase)\b/i.test(lower);
  const amtMatch = text.match(/(?:SAR|SR|ريال)\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
                   text.match(/([0-9]+(?:\.[0-9]{1,2})?)\s*(?:SAR|SR|ريال)/i);
  if (!hasSpendVerb || !amtMatch) return null;
  const amount = parseFloat(amtMatch[1]);
  if (!amount || amount <= 0) return null;
  const merchMatch = text.match(/(?:at|for|from|on)\s+([A-Za-z0-9\s&'-]{2,35})/i);
  const merchant = merchMatch ? merchMatch[1].trim() : 'Expense via Ari';
  const settings = getLocalStore('mazenos_settings', {});
  const entry = {
    id: `tx_${Date.now()}`,
    wallet_source: settings.default_wallet_name || 'Card *4821',
    merchant,
    amount_sar: amount,
    balance_after_sar: null,
    transaction_timestamp: new Date().toISOString().slice(0, 16).replace('T', ' ')
  };
  const budget = getLocalStore('mazenos_budget', []);
  budget.unshift(entry);
  setLocalStore('mazenos_budget', budget);
  fetch('/api/budget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }).catch(() => {});
  return entry;
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

  const loggedExpense = tryParseExpenseFromChat(messageText);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
          `${errData.exhausted_provider} is rate-limited right now. Switch to ${state.suggestedProvider}?`;
        document.getElementById('rateLimitModal').classList.add('open');
        return;
      }
    }

    if (!res.ok) throw new Error('Worker offline');
    const data = await res.json();
    const replyText = loggedExpense
      ? `${data.reply}\n\n(Logged ${loggedExpense.amount_sar.toFixed(2)} SAR at ${loggedExpense.merchant} to Budget.)`
      : data.reply;

    allLocal.push({
      id: `msg_${Date.now() + 1}`,
      session_id: state.sessionId,
      agent: state.activeAgent,
      sender: 'assistant',
      message_text: replyText,
      created_at: new Date().toISOString()
    });
    setLocalStore('mazenos_chat_messages', allLocal);
    await loadChatHistory();
  } catch {
    let reply = '';
    if (loggedExpense) {
      reply = `Ari: Logged ${loggedExpense.amount_sar.toFixed(2)} SAR (${loggedExpense.merchant}) to your Budget.`;
    } else if (state.activeAgent === 'ari') {
      const tasks = getLocalStore('mazenos_tasks', []);
      const p1 = tasks.find(t => Number(t.priority) === 1 && t.status !== 'completed');
      reply = p1
        ? `Ari: Your top priority task is "${p1.title}". Finish that first before moving to other items.`
        : `Ari: You have no urgent tasks right now. Open Taskitator to plan your next study block.`;
    } else {
      reply = `Jade: Take a breath. How is your day going so far?`;
    }

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

function __initModule() {
  updateDateHeader();
  mountSharedBreakModal('osHeaderBreakPill');
  checkContinuousWorkAlert();
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
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
