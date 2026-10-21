/**
 * Taskitator Standalone App Logic (taskitator.js)
 * Implements Today's Focus, Eisenhower Matrix (P1-P4), Consecutive Task Cascading,
 * Bonus Task Queue Pull, and Zero-Simulation Multimodal Proof Auditing.
 */

let tasks = [];
let currentView = 'today';

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

function loadLocalTasks() {
  try {
    return JSON.parse(localStorage.getItem('mazenos_tasks') || '[]');
  } catch {
    return [];
  }
}

function saveLocalTasks(list) {
  try {
    localStorage.setItem('mazenos_tasks', JSON.stringify(list));
  } catch {}
}

async function fetchTasks() {
  try {
    const res = await fetch('/api/tasks', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    tasks = data.tasks || [];
    saveLocalTasks(tasks);
  } catch {
    tasks = loadLocalTasks();
  }
  updateNavCounts();
  renderCurrentView();
}

function updateNavCounts() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const active = tasks.filter(t => t.status !== 'completed');
  const todayTasks = active.filter(t => t.priority === 1 || t.is_bonus || !t.due_timestamp || t.due_timestamp.startsWith(todayStr));
  const upcomingTasks = active.filter(t => t.due_timestamp && t.due_timestamp.slice(0, 10) > todayStr && !t.is_bonus);
  const completedTasks = tasks.filter(t => t.status === 'completed');

  document.getElementById('navCountToday').textContent = todayTasks.length;
  document.getElementById('navCountMatrix').textContent = active.length;
  document.getElementById('navCountUpcoming').textContent = upcomingTasks.length;
  document.getElementById('navCountCompleted').textContent = completedTasks.length;
}

function cascadeLocalDependents(parentId, shiftMinutes) {
  if (!shiftMinutes) return 0;
  let count = 0;
  const queue = [parentId];
  const visited = new Set([parentId]);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const t of tasks) {
      if (t.depends_on_task_id === cur && !visited.has(t.id) && t.status !== 'completed') {
        visited.add(t.id);
        if (t.is_consecutive && t.due_timestamp) {
          const ms = Date.parse(t.due_timestamp);
          if (!Number.isNaN(ms)) {
            t.due_timestamp = new Date(ms + shiftMinutes * 60000).toISOString().slice(0, 16);
            count++;
          }
        }
        queue.push(t.id);
      }
    }
  }
  return count;
}

function createTaskCardElement(task) {
  const div = document.createElement('div');
  div.className = 'task-item';

  const parentTask = task.depends_on_task_id ? tasks.find(p => p.id === task.depends_on_task_id) : null;
  const badges = [
    `<span class="badge badge-p${task.priority}">P${task.priority}</span>`,
    task.is_consecutive ? `<span class="badge badge-p3">Consecutive${parentTask ? ` &rarr; ${parentTask.title}` : ''}</span>` : '',
    task.is_bonus ? `<span class="badge badge-success">Bonus (0 Penalty)</span>` : '',
    task.requires_video ? `<span class="badge badge-p2">NewPipe Video</span>` : '',
    task.ai_audit_criteria ? `<span class="badge badge-p1">Proof Required</span>` : ''
  ].filter(Boolean).join(' ');

  div.innerHTML = `
    <div class="task-item-top">
      <div>
        <strong style="font-size:0.96rem;">${task.title}</strong>
        ${task.description ? `<p class="card-subtitle" style="margin-top:0.2rem;">${task.description}</p>` : ''}
      </div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">${badges}</div>
    </div>
    <div style="font-size:0.8rem;color:var(--text-secondary);">
      ${task.due_timestamp ? `Due: ${task.due_timestamp.replace('T', ' ')}` : 'Flexible slot'} &bull; ${task.estimated_duration_minutes || 45} min
    </div>
    <div class="task-actions"></div>
  `;

  const actionsEl = div.querySelector('.task-actions');

  if (task.status !== 'completed') {
    if (task.ai_audit_criteria) {
      const proofBtn = document.createElement('button');
      proofBtn.type = 'button';
      proofBtn.className = 'btn btn-sm btn-primary';
      proofBtn.textContent = 'Upload Proof';
      proofBtn.addEventListener('click', () => openProofModal(task));
      actionsEl.appendChild(proofBtn);
    } else {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.className = 'btn btn-sm btn-jade';
      doneBtn.textContent = 'Mark Complete';
      doneBtn.addEventListener('click', () => markTaskComplete(task.id));
      actionsEl.appendChild(doneBtn);
    }

    if (task.is_consecutive && task.due_timestamp) {
      const slipBtn = document.createElement('button');
      slipBtn.type = 'button';
      slipBtn.className = 'btn btn-sm btn-secondary';
      slipBtn.textContent = 'Slip +30m (Cascade)';
      slipBtn.addEventListener('click', () => shiftTaskAndCascade(task, 30));
      actionsEl.appendChild(slipBtn);
    }

    if (!task.is_bonus && currentView === 'upcoming') {
      const bonusBtn = document.createElement('button');
      bonusBtn.type = 'button';
      bonusBtn.className = 'btn btn-sm btn-secondary';
      bonusBtn.textContent = 'Pull as Bonus Today';
      bonusBtn.addEventListener('click', () => pullAsBonusTask(task.id));
      actionsEl.appendChild(bonusBtn);
    }
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-sm btn-secondary';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => openTaskModal(task));
  actionsEl.appendChild(editBtn);

  return div;
}

function renderCurrentView() {
  const viewport = document.getElementById('tasksViewport');
  const titleEl = document.getElementById('currentViewTitle');
  const subEl = document.getElementById('currentViewSubtitle');
  if (!viewport) return;
  viewport.innerHTML = '';

  const todayStr = new Date().toISOString().slice(0, 10);
  const active = tasks.filter(t => t.status !== 'completed');

  if (currentView === 'matrix') {
    titleEl.textContent = 'Eisenhower Matrix (P1–P4)';
    subEl.textContent = 'Tasks grouped by urgency and importance';
    const grid = document.createElement('div');
    grid.className = 'matrix-grid';
    const labels = {
      1: 'P1 — Urgent & Important',
      2: 'P2 — Important, Not Urgent',
      3: 'P3 — Urgent, Not Important',
      4: 'P4 — Backlog'
    };
    for (let p = 1; p <= 4; p++) {
      const col = document.createElement('div');
      col.className = 'card';
      col.innerHTML = `<div class="card-header"><span class="badge badge-p${p}">${labels[p]}</span></div>`;
      const pTasks = active.filter(t => Number(t.priority) === p);
      if (pTasks.length === 0) {
        col.innerHTML += `<p class="card-subtitle">No tasks in P${p}.</p>`;
      } else {
        for (const t of pTasks) col.appendChild(createTaskCardElement(t));
      }
      grid.appendChild(col);
    }
    viewport.appendChild(grid);
    return;
  }

  let filtered = [];
  if (currentView === 'today') {
    titleEl.textContent = "Today's Focus";
    subEl.textContent = 'Priority 1 commitments, today due items, and zero-penalty bonus pulls';
    filtered = active.filter(t => t.priority === 1 || t.is_bonus || !t.due_timestamp || t.due_timestamp.startsWith(todayStr));
  } else if (currentView === 'upcoming') {
    titleEl.textContent = 'Upcoming Queue';
    subEl.textContent = 'Future tasks eligible to be pulled into today as bonus tasks';
    filtered = active.filter(t => t.due_timestamp && t.due_timestamp.slice(0, 10) > todayStr && !t.is_bonus);
  } else {
    titleEl.textContent = 'Completed Tasks';
    subEl.textContent = 'Verified and completed milestones';
    filtered = tasks.filter(t => t.status === 'completed');
  }

  if (filtered.length === 0) {
    viewport.innerHTML = `<div class="empty-state">
      <h3>No tasks in this view</h3>
      <p>Tap "+ New Task" in the top bar to add an authentic task to your queue.</p>
    </div>`;
    return;
  }

  for (const t of filtered) {
    viewport.appendChild(createTaskCardElement(t));
  }
}

function openTaskModal(task = null) {
  const modal = document.getElementById('taskModal');
  const parentSelect = document.getElementById('taskParentSelect');
  parentSelect.innerHTML = '<option value="">None</option>';
  for (const candidate of tasks) {
    if (!task || candidate.id !== task.id) {
      const opt = document.createElement('option');
      opt.value = candidate.id;
      opt.textContent = `${candidate.title} (P${candidate.priority})`;
      parentSelect.appendChild(opt);
    }
  }

  document.getElementById('taskModalTitle').textContent = task ? 'Edit Task' : 'New Task';
  document.getElementById('taskIdInput').value = task ? task.id : '';
  document.getElementById('taskTitleInput').value = task ? task.title : '';
  document.getElementById('taskDescInput').value = task ? (task.description || '') : '';
  document.getElementById('taskPrioritySelect').value = task ? String(task.priority) : '1';
  document.getElementById('taskDurationInput').value = task ? (task.estimated_duration_minutes || 45) : 45;
  document.getElementById('taskDueInput').value = task && task.due_timestamp ? task.due_timestamp.slice(0, 16) : '';
  document.getElementById('taskConsecutiveCheck').checked = Boolean(task && task.is_consecutive);
  document.getElementById('taskBonusCheck').checked = Boolean(task && task.is_bonus);
  document.getElementById('taskVideoCheck').checked = Boolean(task && task.requires_video);
  document.getElementById('taskParentSelect').value = task && task.depends_on_task_id ? task.depends_on_task_id : '';
  document.getElementById('taskAuditCriteriaInput').value = task ? (task.ai_audit_criteria || '') : '';

  const delBtn = document.getElementById('deleteTaskBtn');
  delBtn.style.display = task ? 'inline-flex' : 'none';

  modal.classList.add('open');
}

async function shiftTaskAndCascade(task, minutes) {
  const oldMs = Date.parse(task.due_timestamp);
  if (Number.isNaN(oldMs)) return;
  const newDue = new Date(oldMs + minutes * 60000).toISOString().slice(0, 16);

  try {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ due_timestamp: newDue })
    });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    showToast(`Shifted "${task.title}" +${minutes}m and cascaded ${(data.cascaded || []).length} dependent task(s).`);
  } catch {
    task.due_timestamp = newDue;
    const count = cascadeLocalDependents(task.id, minutes);
    saveLocalTasks(tasks);
    showToast(`Shifted "${task.title}" +${minutes}m and cascaded ${count} dependent task(s).`);
  }
  await fetchTasks();
}

async function pullAsBonusTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/bonus`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Local fallback');
  } catch {
    const target = tasks.find(t => t.id === taskId);
    if (target) {
      target.original_scheduled_date = target.due_timestamp ? target.due_timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
      target.is_bonus = 1;
      target.due_timestamp = `${new Date().toISOString().slice(0, 10)}T21:00`;
      saveLocalTasks(tasks);
    }
  }
  showToast('Task pulled into Today as a zero-penalty Bonus Task.');
  await fetchTasks();
}

async function markTaskComplete(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: 'completed' })
    });
    if (!res.ok) throw new Error('Local fallback');
  } catch {
    const target = tasks.find(t => t.id === taskId);
    if (target) {
      target.status = 'completed';
      target.completed_at = new Date().toISOString();
      saveLocalTasks(tasks);
    }
  }
  showToast('Task completed.');
  await fetchTasks();
}

function openProofModal(task) {
  document.getElementById('proofTaskId').value = task.id;
  document.getElementById('proofTaskTitle').textContent = `Task: ${task.title}`;
  document.getElementById('proofCriteriaDisplay').textContent = `Required Criteria: ${task.ai_audit_criteria}`;
  const resBox = document.getElementById('proofResultBox');
  resBox.style.display = 'none';
  resBox.innerHTML = '';
  document.getElementById('proofFileInput').value = '';
  document.getElementById('proofAuditModal').classList.add('open');
}

document.addEventListener('DOMContentLoaded', () => {
  fetchTasks();

  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view || 'today';
      renderCurrentView();
    });
  });

  document.getElementById('openNewTaskModalBtn')?.addEventListener('click', () => openTaskModal(null));
  document.getElementById('closeTaskModalBtn')?.addEventListener('click', () => document.getElementById('taskModal').classList.remove('open'));
  document.getElementById('cancelTaskBtn')?.addEventListener('click', () => document.getElementById('taskModal').classList.remove('open'));
  document.getElementById('closeProofModalBtn')?.addEventListener('click', () => document.getElementById('proofAuditModal').classList.remove('open'));

  document.getElementById('taskForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('taskIdInput').value;
    const payload = {
      title: document.getElementById('taskTitleInput').value.trim(),
      description: document.getElementById('taskDescInput').value.trim(),
      priority: Number(document.getElementById('taskPrioritySelect').value),
      estimated_duration_minutes: Number(document.getElementById('taskDurationInput').value) || 45,
      due_timestamp: document.getElementById('taskDueInput').value || null,
      is_consecutive: document.getElementById('taskConsecutiveCheck').checked,
      is_bonus: document.getElementById('taskBonusCheck').checked,
      requires_video: document.getElementById('taskVideoCheck').checked,
      depends_on_task_id: document.getElementById('taskParentSelect').value || null,
      ai_audit_criteria: document.getElementById('taskAuditCriteriaInput').value.trim() || null
    };

    try {
      const res = await fetch(id ? `/api/tasks/${id}` : '/api/tasks', {
        method: id ? 'PUT' : 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      if (id) {
        const idx = tasks.findIndex(t => t.id === id);
        if (idx !== -1) {
          const oldDue = tasks[idx].due_timestamp;
          tasks[idx] = { ...tasks[idx], ...payload };
          if (oldDue && payload.due_timestamp && payload.due_timestamp > oldDue) {
            const diffMins = Math.round((Date.parse(payload.due_timestamp) - Date.parse(oldDue)) / 60000);
            if (diffMins > 0) cascadeLocalDependents(id, diffMins);
          }
        }
      } else {
        tasks.push({
          id: `t_${Date.now()}`,
          status: 'pending',
          created_at: new Date().toISOString(),
          ...payload
        });
      }
      saveLocalTasks(tasks);
    }

    document.getElementById('taskModal').classList.remove('open');
    showToast(id ? 'Task updated.' : 'Task created.');
    await fetchTasks();
  });

  document.getElementById('deleteTaskBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('taskIdInput').value;
    if (!id) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      tasks = tasks.filter(t => t.id !== id);
      saveLocalTasks(tasks);
    }
    document.getElementById('taskModal').classList.remove('open');
    showToast('Task deleted.');
    await fetchTasks();
  });

  // Zero-Simulation Multimodal Proof Verification
  document.getElementById('proofAuditForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('proofTaskId').value;
    const fileInput = document.getElementById('proofFileInput');
    const file = fileInput.files?.[0];
    const resultBox = document.getElementById('proofResultBox');
    if (!file) return;

    resultBox.style.display = 'block';
    resultBox.innerHTML = '<span>Uploading and verifying proof with Ari vision auditor...</span>';

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = String(reader.result).split(',')[1] || '';
      try {
        const res = await fetch(`/api/tasks/${taskId}/audit`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            mime_type: file.type || 'image/png',
            base64_data: base64Data
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Vision service unavailable — Zero-Simulation Policy failed closed.');
        }
        resultBox.innerHTML = `
          <div><strong>Verdict:</strong> ${data.verdict.toUpperCase()} (Score: ${data.score}/10)</div>
          <div style="margin-top:0.35rem;">${data.critique}</div>
        `;
        if (data.verdict === 'passed') {
          showToast('Proof passed audit! Task marked complete.');
          await fetchTasks();
        }
      } catch (err) {
        // Zero-Simulation Policy: fail closed with error, never auto-approve
        resultBox.innerHTML = `
          <div style="color:var(--danger);"><strong>Audit Failed Closed (Zero-Simulation Policy):</strong></div>
          <div class="card-subtitle" style="margin-top:0.25rem;">${err.message}. Configure a valid Gemini or Claude API key in Settings to run live multimodal proof verification.</div>
        `;
      }
    };
    reader.readAsDataURL(file);
  });
});
