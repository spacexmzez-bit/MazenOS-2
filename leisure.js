/**
 * Leisure & Builder Hub Logic (leisure.js)
 * Calculates guilt-free entertainment allocation from weekly task velocity
 * and protects Friday Builder hobby windows.
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

function getAuthHeaders() {
  let token = '';
  try { token = localStorage.getItem('mazenos_auth_token') || ''; } catch {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function renderVelocityAndHobbies() {
  let tasks = [];
  let hobbies = [];
  try {
    tasks = JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
    hobbies = JSON.parse(localStorage.getItem('mazenos_hobbies') || '[]');
  } catch {}

  const completed = tasks.filter(t => t.status === 'completed');
  const bonusDone = completed.filter(t => t.is_bonus);
  const leisureHours = (2.0 + completed.length * 0.5 + bonusDone.length * 0.75).toFixed(1);

  document.getElementById('velocityCompletedCount').textContent = completed.length;
  document.getElementById('velocityBonusCount').textContent = bonusDone.length;
  document.getElementById('velocityLeisureHours').textContent = `${leisureHours} hrs`;

  const listEl = document.getElementById('hobbySlotsList');
  if (!listEl) return;
  if (hobbies.length === 0) {
    listEl.innerHTML = `<p class="card-subtitle">No hobby slots scheduled yet.</p>`;
  } else {
    listEl.innerHTML = hobbies.map(h => `
      <div style="display:flex;justify-content:space-between;padding:0.6rem 0.8rem;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-bottom:0.4rem;">
        <strong>${h.title}</strong>
        <span class="badge badge-success">${h.slot}</span>
      </div>
    `).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderVelocityAndHobbies();

  document.getElementById('focusSessionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const duration = Number(document.getElementById('focusDurationInput').value) || 45;
    const sessionType = document.getElementById('focusTypeSelect').value;
    const entry = {
      id: `foc_${Date.now()}`,
      duration_minutes: duration,
      session_type: sessionType,
      completed: true,
      started_at: new Date().toISOString()
    };

    try {
      await fetch('/api/focus', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(entry)
      });
    } catch {}

    let sessions = [];
    try { sessions = JSON.parse(localStorage.getItem('mazenos_focus_sessions') || '[]'); } catch {}
    sessions.push(entry);
    try { localStorage.setItem('mazenos_focus_sessions', JSON.stringify(sessions)); } catch {}

    const totalMins = sessions.reduce((s, x) => s + (Number(x.duration_minutes) || 0), 0);
    if (totalMins >= 150) {
      showToast(`Logged ${duration}m. Continuous work reached ${totalMins}m — Hydration & meal banner activated on Dashboard!`);
    } else {
      showToast(`Focus session (${duration}m) recorded.`);
    }
  });

  document.getElementById('hobbySlotForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('hobbyTitleInput').value.trim();
    const slot = document.getElementById('hobbySlotInput').value.trim();
    if (!title) return;
    let hobbies = [];
    try { hobbies = JSON.parse(localStorage.getItem('mazenos_hobbies') || '[]'); } catch {}
    hobbies.unshift({ id: `hob_${Date.now()}`, title, slot });
    try { localStorage.setItem('mazenos_hobbies', JSON.stringify(hobbies)); } catch {}
    document.getElementById('hobbySlotForm').reset();
    showToast('Hobby window saved.');
    renderVelocityAndHobbies();
  });
});
