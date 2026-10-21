/**
 * Curry Curriculum Hub Logic (curry.js)
 * Handles Zero-Cost LLM Syllabus Import, Main/Sub Objective Balancing,
 * Automatic Succession Triggers, and Consensual Spaced Retrieval Drills.
 */

let units = [];
let proposedDrillUnit = null;

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

function loadLocalUnits() {
  try { return JSON.parse(localStorage.getItem('mazenos_curriculum') || '[]'); } catch { return []; }
}

function saveLocalUnits(list) {
  try { localStorage.setItem('mazenos_curriculum', JSON.stringify(list)); } catch {}
}

async function fetchUnits() {
  try {
    const res = await fetch('/api/curriculum', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Offline');
    const data = await res.json();
    units = data.units || [];
    saveLocalUnits(units);
  } catch {
    units = loadLocalUnits();
  }
  applyExamProximityPromotions();
  renderUnits();
}

/**
 * Succession Trigger: Nearing an exam date (within 5 days) promotes that subject to Main Objective
 */
function applyExamProximityPromotions() {
  const nowMs = Date.now();
  for (const u of units) {
    if (u.status !== 'completed' && !u.is_main_objective && u.target_completion_date) {
      const targetMs = Date.parse(u.target_completion_date);
      if (!Number.isNaN(targetMs) && (targetMs - nowMs) <= 5 * 86400000 && (targetMs - nowMs) >= -86400000) {
        u.is_main_objective = 1;
      }
    }
  }
}

function renderUnits() {
  const mainEl = document.getElementById('mainObjectivesList');
  const subEl = document.getElementById('subObjectivesList');
  if (!mainEl || !subEl) return;
  mainEl.innerHTML = '';
  subEl.innerHTML = '';

  const mainUnits = units.filter(u => Boolean(u.is_main_objective));
  const subUnits = units.filter(u => !u.is_main_objective);

  if (mainUnits.length === 0) {
    mainEl.innerHTML = `<div class="empty-state"><h3>No Main Objectives</h3><p>Add a syllabus unit or promote a sub-objective.</p></div>`;
  } else {
    for (const u of mainUnits) mainEl.appendChild(buildUnitNode(u));
  }

  if (subUnits.length === 0) {
    subEl.innerHTML = `<div class="empty-state"><h3>No Sub Objectives</h3><p>Secondary study units appear here and auto-promote when Main Objectives finish.</p></div>`;
  } else {
    for (const u of subUnits) subEl.appendChild(buildUnitNode(u));
  }
}

function buildUnitNode(u) {
  const row = document.createElement('div');
  row.className = 'unit-row';
  const done = u.status === 'completed';
  row.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;gap:0.45rem;">
        <span class="badge ${u.is_main_objective ? 'badge-p1' : 'badge-p3'}">${u.exam_name} #${u.unit_number}</span>
        <strong>${u.topic_title}</strong>
      </div>
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.25rem;">
        Difficulty: ${u.difficulty_level}/5 &bull; Est: ${u.estimated_hours}h
        ${u.target_completion_date ? ` &bull; Target: ${u.target_completion_date}` : ''}
      </div>
    </div>
    <div style="display:flex;gap:0.4rem;">
      ${!done ? `<button type="button" class="btn btn-sm btn-jade complete-unit-btn">Complete</button>` : `<span class="badge badge-success">Completed</span>`}
      ${!u.is_main_objective && !done ? `<button type="button" class="btn btn-sm btn-secondary promote-unit-btn">Promote</button>` : ''}
    </div>
  `;

  row.querySelector('.complete-unit-btn')?.addEventListener('click', () => completeUnit(u));
  row.querySelector('.promote-unit-btn')?.addEventListener('click', () => promoteUnit(u));
  return row;
}

async function completeUnit(unit) {
  try {
    const res = await fetch(`/api/curriculum/${unit.id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: 'completed' })
    });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    if (data.promoted_unit) {
      showToast(`Completed! Succession Trigger promoted "${data.promoted_unit.topic_title}" to Main Objective.`);
    } else {
      showToast('Unit marked completed.');
    }
  } catch {
    unit.status = 'completed';
    if (unit.is_main_objective) {
      const nextSub = units.find(x => !x.is_main_objective && x.status !== 'completed');
      if (nextSub) {
        nextSub.is_main_objective = 1;
        showToast(`Succession Trigger promoted "${nextSub.topic_title}" to Main Objective!`);
      }
    }
    saveLocalUnits(units);
  }
  await fetchUnits();
}

async function promoteUnit(unit) {
  try {
    const res = await fetch(`/api/curriculum/${unit.id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ is_main_objective: true })
    });
    if (!res.ok) throw new Error('Local fallback');
  } catch {
    unit.is_main_objective = 1;
    saveLocalUnits(units);
  }
  showToast(`Promoted "${unit.topic_title}" to Main Objective.`);
  await fetchUnits();
}

document.addEventListener('DOMContentLoaded', () => {
  fetchUnits();

  document.getElementById('openAddUnitBtn')?.addEventListener('click', () => {
    document.getElementById('addUnitModal').classList.add('open');
  });
  document.getElementById('closeUnitModalBtn')?.addEventListener('click', () => {
    document.getElementById('addUnitModal').classList.remove('open');
  });
  document.getElementById('openBulkImportBtn')?.addEventListener('click', () => {
    document.getElementById('bulkImportModal').classList.add('open');
  });
  document.getElementById('closeImportModalBtn')?.addEventListener('click', () => {
    document.getElementById('bulkImportModal').classList.remove('open');
  });

  document.getElementById('addUnitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      exam_name: document.getElementById('unitExamInput').value.trim(),
      unit_number: Number(document.getElementById('unitNumInput').value) || 1,
      topic_title: document.getElementById('unitTopicInput').value.trim(),
      difficulty_level: Number(document.getElementById('unitDiffInput').value) || 3,
      estimated_hours: Number(document.getElementById('unitHoursInput').value) || 2.0,
      target_completion_date: document.getElementById('unitTargetDate').value || null,
      is_main_objective: document.getElementById('unitMainCheck').checked
    };

    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      units.push({ id: `cur_${Date.now()}`, status: 'not_started', ...payload });
      saveLocalUnits(units);
    }
    document.getElementById('addUnitModal').classList.remove('open');
    document.getElementById('addUnitForm').reset();
    showToast('Curriculum unit added.');
    await fetchUnits();
  });

  document.getElementById('bulkImportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = document.getElementById('bulkJsonTextarea').value.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [parsed];
    } catch {
      showToast('Invalid JSON format. Please paste a valid JSON array.');
      return;
    }

    try {
      const res = await fetch('/api/curriculum', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ units: parsed })
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      for (const item of parsed) {
        units.push({
          id: `cur_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          status: 'not_started',
          ...item
        });
      }
      saveLocalUnits(units);
    }
    document.getElementById('bulkImportModal').classList.remove('open');
    showToast(`Imported ${parsed.length} curriculum unit(s).`);
    await fetchUnits();
  });

  // Consensual Testing: Propose spaced retrieval drill
  document.getElementById('proposeDrillBtn')?.addEventListener('click', () => {
    const candidate = units.find(u => u.status === 'completed') || units[0];
    if (!candidate) {
      showToast('Add at least one curriculum unit first to generate a retrieval drill.');
      return;
    }
    proposedDrillUnit = candidate;
    document.getElementById('drillProposalText').textContent =
      `Ari proposes a 25-minute active recall drill on "${candidate.exam_name}: ${candidate.topic_title}" (Difficulty ${candidate.difficulty_level}/5). Slot this into Today's Tasks?`;
    document.getElementById('drillProposalCard').style.display = 'block';
  });

  document.getElementById('declineDrillBtn')?.addEventListener('click', () => {
    document.getElementById('drillProposalCard').style.display = 'none';
    proposedDrillUnit = null;
  });

  document.getElementById('acceptDrillBtn')?.addEventListener('click', async () => {
    if (!proposedDrillUnit) return;
    const drillTask = {
      title: `Retrieval Drill: ${proposedDrillUnit.exam_name} — ${proposedDrillUnit.topic_title}`,
      description: 'Consensual spaced retrieval quiz proposed by Curry engine.',
      priority: proposedDrillUnit.is_main_objective ? 1 : 2,
      estimated_duration_minutes: 25,
      due_timestamp: `${new Date().toISOString().slice(0, 10)}T19:00`
    };
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(drillTask)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      const tasks = JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
      tasks.push({ id: `t_drill_${Date.now()}`, status: 'pending', ...drillTask });
      localStorage.setItem('mazenos_tasks', JSON.stringify(tasks));
    }
    document.getElementById('drillProposalCard').style.display = 'none';
    showToast('Spaced retrieval drill added to Today's Tasks.');
  });
});
