/**
 * Sleep & Health Suite Logic (health.js)
 * Shared across health.html, health-medicine.html, and health-sick.html.
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

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getLocalTodayHealth() {
  try {
    const map = JSON.parse(localStorage.getItem('mazenos_health_logs') || '{}');
    return map[getTodayKey()] || {
      sleep_hours: null,
      energy_score: null,
      is_sick: false,
      sickness_notes: '',
      medicine_target_count: 2,
      medicine_taken_count: 0,
      workout_completed: false,
      workout_type: ''
    };
  } catch {
    return { medicine_target_count: 2, medicine_taken_count: 0, is_sick: false };
  }
}

function saveLocalTodayHealth(entry) {
  try {
    const map = JSON.parse(localStorage.getItem('mazenos_health_logs') || '{}');
    map[getTodayKey()] = entry;
    localStorage.setItem('mazenos_health_logs', JSON.stringify(map));
  } catch {}
}

async function loadHealthState() {
  let today = getLocalTodayHealth();
  try {
    const res = await fetch('/api/health', { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      if (data.today) {
        today = { ...today, ...data.today };
        saveLocalTodayHealth(today);
      }
    }
  } catch {}

  // Populate health.html if present
  const sleepInput = document.getElementById('sleepHoursInput');
  if (sleepInput) {
    if (today.sleep_hours != null) sleepInput.value = today.sleep_hours;
    if (today.energy_score != null) document.getElementById('energyScoreInput').value = today.energy_score;
    document.getElementById('workoutTypeInput').value = today.workout_type || '';
    document.getElementById('workoutCompletedCheck').checked = Boolean(today.workout_completed);

    const burnoutBanner = document.getElementById('burnoutAlertBanner');
    if (burnoutBanner) {
      burnoutBanner.style.display = (today.sleep_hours != null && Number(today.sleep_hours) < 4.0) ? 'block' : 'none';
    }
    const medBadge = document.getElementById('medSummaryBadge');
    if (medBadge) medBadge.textContent = `${today.medicine_taken_count || 0} / ${today.medicine_target_count || 0} Doses`;
    const sickBadge = document.getElementById('sickSummaryBadge');
    if (sickBadge) {
      sickBadge.textContent = today.is_sick ? 'Sick Mode Active' : 'Normal Mode';
      sickBadge.className = `badge ${today.is_sick ? 'badge-p1' : 'badge-success'}`;
    }
  }

  // Populate health-medicine.html if present
  const medCounterDisplay = document.getElementById('medCounterDisplay');
  if (medCounterDisplay) {
    const taken = Number(today.medicine_taken_count) || 0;
    const target = Number(today.medicine_target_count) || 0;
    medCounterDisplay.textContent = `${taken} of ${target} doses taken`;
    const targetInput = document.getElementById('medTargetInput');
    if (targetInput) targetInput.value = target;
  }

  // Populate health-sick.html if present
  const sickToggle = document.getElementById('isSickToggle');
  if (sickToggle) {
    sickToggle.checked = Boolean(today.is_sick);
    document.getElementById('sicknessNotesInput').value = today.sickness_notes || '';
    const statusBadge = document.getElementById('sickStatusBadge');
    if (statusBadge) {
      statusBadge.textContent = today.is_sick ? 'Sickness Protocol Active (Phone Unlocked)' : 'Inactive';
      statusBadge.className = `badge ${today.is_sick ? 'badge-p1' : 'badge-success'}`;
    }
  }
}

async function persistHealthUpdate(partial) {
  const current = { ...getLocalTodayHealth(), ...partial };
  saveLocalTodayHealth(current);
  try {
    await fetch('/api/health', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(current)
    });
  } catch {}
  await loadHealthState();
}

document.addEventListener('DOMContentLoaded', () => {
  loadHealthState();

  document.getElementById('healthMainForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sleepVal = Number(document.getElementById('sleepHoursInput').value);
    const energyRaw = document.getElementById('energyScoreInput').value;
    await persistHealthUpdate({
      sleep_hours: sleepVal,
      energy_score: energyRaw !== '' ? Number(energyRaw) : null,
      workout_type: document.getElementById('workoutTypeInput').value.trim(),
      workout_completed: document.getElementById('workoutCompletedCheck').checked
    });
    showToast(sleepVal < 4 ? 'Saved. Acute exhaustion alert triggered (<4h sleep).' : 'Health log saved.');
  });

  document.getElementById('takeDoseBtn')?.addEventListener('click', async () => {
    const cur = getLocalTodayHealth();
    const nextTaken = (Number(cur.medicine_taken_count) || 0) + 1;
    await persistHealthUpdate({ medicine_taken_count: nextTaken });
    showToast('Dose recorded.');
  });

  document.getElementById('resetDoseBtn')?.addEventListener('click', async () => {
    await persistHealthUpdate({ medicine_taken_count: 0 });
    showToast('Daily taken counter reset.');
  });

  document.getElementById('medTargetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = Number(document.getElementById('medTargetInput').value) || 0;
    await persistHealthUpdate({ medicine_target_count: target });
    showToast('Daily medicine target updated.');
  });

  document.getElementById('sicknessForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isSick = document.getElementById('isSickToggle').checked;
    const notes = document.getElementById('sicknessNotesInput').value.trim();
    await persistHealthUpdate({ is_sick: isSick, sickness_notes: notes });

    if (isSick) {
      // Freeze local P1 tasks to backlog
      try {
        const tasks = JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
        for (const t of tasks) {
          if (t.status !== 'completed' && Number(t.priority) === 1) {
            t.priority = 4;
          }
        }
        localStorage.setItem('mazenos_tasks', JSON.stringify(tasks));
      } catch {}
      showToast('Sickness Mode Activated: P1 chains moved to backlog & MacroDroid unlocked.');
    } else {
      showToast('Sickness Mode deactivated. Normal execution resumed.');
    }
  });
});
