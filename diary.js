/**
 * Minimalist Diary Logic (diary.js)
 * Provides a focused writing canvas, formatting toolbar (Alignment, Bold, Italic, Font Size),
 * Mood Tagging, and longitudinal persistence for Jade's debriefs.
 */

let entries = [];

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

function loadLocalEntries() {
  try { return JSON.parse(localStorage.getItem('mazenos_diary') || '[]'); } catch { return []; }
}

function saveLocalEntries(list) {
  try { localStorage.setItem('mazenos_diary', JSON.stringify(list)); } catch {}
}

async function fetchDiary() {
  try {
    const res = await fetch('/api/diary', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    entries = data.entries || [];
    saveLocalEntries(entries);
  } catch {
    entries = loadLocalEntries();
  }
  renderDiaryList();
}

function renderDiaryList() {
  const listEl = document.getElementById('diaryEntriesList');
  if (!listEl) return;

  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <h3>Your journal is empty</h3>
      <p>Tap "Write Today's Diary" in the top bar to open your writing canvas.</p>
    </div>`;
    return;
  }

  listEl.innerHTML = entries.map(e => `
    <div class="card" style="background:var(--bg-elevated);margin-bottom:0.75rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:0.45rem;">
        <span class="badge badge-success">${e.mood_tag || 'Grounded'}</span>
        <span style="font-size:0.8rem;color:var(--text-secondary);">${e.created_at || ''}</span>
      </div>
      <div style="line-height:1.6;">${e.entry_text}</div>
    </div>
  `).join('');
}

function __initModule() {
  fetchDiary();
  try {
    const s = JSON.parse(localStorage.getItem('mazenos_settings') || '{}');
    const moodSel = document.getElementById('diaryMoodSelect');
    if (s.default_mood_tag && moodSel) moodSel.value = s.default_mood_tag;
  } catch {}

  const writerCard = document.getElementById('diaryWriterCard');
  const canvas = document.getElementById('diaryEditorCanvas');

  document.getElementById('openDiaryCanvasBtn')?.addEventListener('click', () => {
    writerCard.style.display = 'block';
    canvas.focus();
  });

  document.getElementById('closeDiaryCanvasBtn')?.addEventListener('click', () => {
    writerCard.style.display = 'none';
  });

  document.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      canvas.focus();
    });
  });

  document.querySelectorAll('[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      canvas.style.textAlign = btn.dataset.align;
      canvas.focus();
    });
  });

  document.getElementById('diaryFontSizeSelect')?.addEventListener('change', (e) => {
    canvas.style.fontSize = e.target.value;
    canvas.focus();
  });

  document.getElementById('saveDiaryEntryBtn')?.addEventListener('click', async () => {
    const text = canvas.innerHTML.trim();
    if (!text) {
      showToast('Write a reflection before saving.');
      return;
    }
    const mood = document.getElementById('diaryMoodSelect').value;
    const payload = {
      id: `diary_${Date.now()}`,
      entry_text: text,
      mood_tag: mood,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };

    try {
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      entries.unshift(payload);
      saveLocalEntries(entries);
    }

    canvas.innerHTML = '';
    writerCard.style.display = 'none';
    showToast('Diary entry saved.');
    await fetchDiary();
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
