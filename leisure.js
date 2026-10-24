/**
 * Leisure Hub Logic (leisure.js)
 * Configurable Focus Timer (Pomodoro, 52/17, 90/20, Custom) and Low-Priority Hobby Tasks.
 */

function showToast(msg) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

let timerState = {
  workMins: 25,
  breakMins: 5,
  phase: 'work',
  remainingSec: 25 * 60,
  running: false,
  intervalId: null
};

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function updateTimerUI() {
  const disp = document.getElementById('leisureTimerDisplay');
  const badge = document.getElementById('leisureTimerPhaseBadge');
  const startBtn = document.getElementById('leisureTimerStartBtn');
  if (disp) disp.textContent = formatTime(timerState.remainingSec);
  if (badge) {
    badge.textContent = timerState.phase === 'work' ? `Work (${timerState.workMins}m)` : `Break (${timerState.breakMins}m)`;
    badge.className = 'badge ' + (timerState.phase === 'work' ? 'badge-p3' : 'badge-success');
  }
  if (startBtn) startBtn.textContent = timerState.running ? 'Pause' : 'Start';
}

function recordCompletedFocusSession(minutes) {
  const entry = {
    id: `foc_${Date.now()}`,
    duration_minutes: minutes,
    session_type: 'pomodoro',
    completed: true,
    started_at: new Date().toISOString()
  };
  let sessions = [];
  try { sessions = JSON.parse(localStorage.getItem('mazenos_focus_sessions') || '[]'); } catch {}
  sessions.push(entry);
  try { localStorage.setItem('mazenos_focus_sessions', JSON.stringify(sessions)); } catch {}
  fetch('/api/focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry)
  }).catch(() => {});
  renderStatsAndHobbies();
}

function renderStatsAndHobbies() {
  let tasks = [];
  let hobbies = [];
  let sessions = [];
  try {
    tasks = JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
    hobbies = JSON.parse(localStorage.getItem('mazenos_hobbies') || '[]');
    sessions = JSON.parse(localStorage.getItem('mazenos_focus_sessions') || '[]');
  } catch {}

  const completed = tasks.filter(t => t.status === 'completed');
  const bonusDone = completed.filter(t => t.is_bonus);

  const cEl = document.getElementById('velocityCompletedCount');
  const bEl = document.getElementById('velocityBonusCount');
  const fEl = document.getElementById('velocityFocusSessions');
  if (cEl) cEl.textContent = completed.length;
  if (bEl) bEl.textContent = bonusDone.length;
  if (fEl) fEl.textContent = sessions.length;

  const listEl = document.getElementById('hobbySlotsList');
  if (!listEl) return;
  if (hobbies.length === 0) {
    listEl.innerHTML = `<p class="card-subtitle">No hobby tasks added yet.</p>`;
  } else {
    listEl.innerHTML = hobbies.map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0.85rem;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-bottom:0.45rem;">
        <span style="${h.done ? 'text-decoration:line-through;color:var(--text-secondary);' : 'font-weight:600;'}">${h.title}</span>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <span class="badge badge-p4">Low Priority</span>
          <button type="button" class="btn btn-sm btn-secondary hobby-del-btn" data-id="${h.id}">✕</button>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.hobby-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = hobbies.filter(x => x.id !== btn.dataset.id);
        try { localStorage.setItem('mazenos_hobbies', JSON.stringify(next)); } catch {}
        renderStatsAndHobbies();
      });
    });
  }
}

function __initModule() {
  renderStatsAndHobbies();
  updateTimerUI();

  const presetSel = document.getElementById('timerPresetSelect');
  const customRow = document.getElementById('customTimerInputsRow');
  const wIn = document.getElementById('customWorkMins');
  const bIn = document.getElementById('customBreakMins');

  function applyTimerSettings() {
    if (timerState.running && timerState.intervalId) {
      clearInterval(timerState.intervalId);
      timerState.running = false;
    }
    if (presetSel.value === 'custom') {
      customRow.style.display = 'grid';
      timerState.workMins = Math.max(1, Number(wIn.value) || 25);
      timerState.breakMins = Math.max(1, Number(bIn.value) || 5);
    } else {
      customRow.style.display = 'none';
      const [w, b] = presetSel.value.split(',').map(Number);
      timerState.workMins = w || 25;
      timerState.breakMins = b || 5;
    }
    timerState.phase = 'work';
    timerState.remainingSec = timerState.workMins * 60;
    updateTimerUI();
  }

  presetSel?.addEventListener('change', applyTimerSettings);
  wIn?.addEventListener('change', applyTimerSettings);
  bIn?.addEventListener('change', applyTimerSettings);

  document.getElementById('leisureTimerStartBtn')?.addEventListener('click', () => {
    if (timerState.running) {
      clearInterval(timerState.intervalId);
      timerState.running = false;
      updateTimerUI();
    } else {
      timerState.running = true;
      updateTimerUI();
      timerState.intervalId = setInterval(() => {
        timerState.remainingSec--;
        if (timerState.remainingSec <= 0) {
          if (timerState.phase === 'work') {
            recordCompletedFocusSession(timerState.workMins);
            showToast(`Work session (${timerState.workMins}m) finished! Starting ${timerState.breakMins}m break.`);
            timerState.phase = 'break';
            timerState.remainingSec = timerState.breakMins * 60;
          } else {
            showToast('Break finished! Ready for next focus session.');
            timerState.phase = 'work';
            timerState.remainingSec = timerState.workMins * 60;
            clearInterval(timerState.intervalId);
            timerState.running = false;
          }
        }
        updateTimerUI();
      }, 1000);
    }
  });

  document.getElementById('leisureTimerResetBtn')?.addEventListener('click', () => {
    if (timerState.intervalId) clearInterval(timerState.intervalId);
    timerState.running = false;
    timerState.remainingSec = (timerState.phase === 'work' ? timerState.workMins : timerState.breakMins) * 60;
    updateTimerUI();
  });

  document.getElementById('leisureTimerSkipBtn')?.addEventListener('click', () => {
    if (timerState.intervalId) clearInterval(timerState.intervalId);
    timerState.running = false;
    timerState.phase = timerState.phase === 'work' ? 'break' : 'work';
    timerState.remainingSec = (timerState.phase === 'work' ? timerState.workMins : timerState.breakMins) * 60;
    updateTimerUI();
  });

  document.getElementById('hobbySlotForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('hobbyTitleInput').value.trim();
    if (!title) return;
    const itemId = `hob_${Date.now()}`;
    let hobbies = [];
    try { hobbies = JSON.parse(localStorage.getItem('mazenos_hobbies') || '[]'); } catch {}
    hobbies.unshift({ id: itemId, title, done: false });
    try { localStorage.setItem('mazenos_hobbies', JSON.stringify(hobbies)); } catch {}

    // Also add as a low-priority task in Taskitator & MazenOS tasks without a time window
    try {
      const mTasks = JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
      mTasks.push({
        id: itemId,
        title,
        description: 'Hobby / side project (low priority)',
        priority: 3,
        is_bonus: true,
        status: 'pending'
      });
      localStorage.setItem('mazenos_tasks', JSON.stringify(mTasks));

      const tkTasks = JSON.parse(localStorage.getItem('taskitator_tasks') || '[]');
      tkTasks.push({
        id: itemId,
        parent_id: null,
        title,
        raw_title: title,
        description: 'Hobby / side project',
        tags: ['hobby'],
        priority_id: 'prio_low',
        project_id: 'inbox',
        status: 'active',
        due_date: '',
        ai_locked: false,
        is_bonus: true,
        created_at: new Date().toISOString()
      });
      localStorage.setItem('taskitator_tasks', JSON.stringify(tkTasks));
    } catch {}

    document.getElementById('hobbySlotForm').reset();
    showToast('Added as a low-priority hobby task.');
    renderStatsAndHobbies();
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
