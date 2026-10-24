/**
 * Distraction Confinement & Idea Vault Logic (ideas.js)
 * Enforces Write-Only Vault Mode during deep work, a 3-Minute Quick Capture countdown timer,
 * and Friday Markdown synthesis export.
 */

let ideas = [];
let deepWorkLocked = true;
let countdownInterval = null;
let remainingSeconds = 180;
  try {
    const s = JSON.parse(localStorage.getItem('mazenos_settings') || '{}');
    if (s.idea_capture_seconds) remainingSeconds = Number(s.idea_capture_seconds) || 180;
  } catch {}

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

function loadLocalIdeas() {
  try { return JSON.parse(localStorage.getItem('mazenos_ideas') || '[]'); } catch { return []; }
}

function saveLocalIdeas(list) {
  try { localStorage.setItem('mazenos_ideas', JSON.stringify(list)); } catch {}
}

async function fetchIdeas() {
  try {
    const res = await fetch(`/api/ideas?unlock=${!deepWorkLocked}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    if (!data.vault_locked) {
      ideas = data.ideas || [];
      saveLocalIdeas(ideas);
    }
  } catch {
    ideas = loadLocalIdeas();
  }
  renderVault();
}

function renderVault() {
  const area = document.getElementById('vaultDisplayArea');
  if (!area) return;

  if (deepWorkLocked) {
    area.innerHTML = `<div class="empty-state">
      <h3>Vault Sealed (Write-Only Mode Active)</h3>
      <p>Viewing, browsing, or editing past ideas is locked during active focus blocks so you don't go down rabbit holes. Tap "+ Add Idea (3:00 Timer)" to capture a thought, or unlock for Friday review.</p>
    </div>`;
    return;
  }

  if (ideas.length === 0) {
    area.innerHTML = `<div class="empty-state">
      <h3>No ideas in vault yet</h3>
      <p>Tap "+ Add Idea (3:00 Timer)" whenever a random thought pops up during study.</p>
    </div>`;
    return;
  }

  area.innerHTML = ideas.map(item => `
    <div class="card" style="background:var(--bg-elevated);margin-bottom:0.65rem;">
      <div style="display:flex;justify-content:space-between;margin-bottom:0.35rem;">
        <span class="badge badge-p3">${item.domain_tag || 'general'}</span>
        <span style="font-size:0.78rem;color:var(--text-secondary);">${item.created_at || ''}</span>
      </div>
      <p>${item.content}</p>
    </div>
  `).join('');
}

function startCaptureTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  remainingSeconds = 180;
  const card = document.getElementById('quickCaptureCard');
  const display = document.getElementById('captureCountdownDisplay');
  card.style.display = 'block';
  document.getElementById('ideaContentInput').focus();

  const updateClock = () => {
    const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const secs = String(remainingSeconds % 60).padStart(2, '0');
    display.textContent = `${mins}:${secs}`;
  };
  updateClock();

  countdownInterval = setInterval(() => {
    remainingSeconds--;
    updateClock();
    if (remainingSeconds <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      sealCaptureCard(true);
    }
  }, 1000);
}

async function sealCaptureCard(autoExpired = false) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const input = document.getElementById('ideaContentInput');
  const content = input.value.trim();
  const domain = document.getElementById('ideaDomainSelect').value;

  if (content) {
    const entry = {
      id: `idea_${Date.now()}`,
      content,
      domain_tag: domain,
      is_locked: 1,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(entry)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      const all = loadLocalIdeas();
      all.unshift(entry);
      saveLocalIdeas(all);
    }
    showToast(autoExpired ? 'Timer expired — idea automatically sealed in Vault.' : 'Idea sealed in Vault. Back to focus!');
  } else if (autoExpired) {
    showToast('3-minute capture window expired. Vault sealed.');
  }

  input.value = '';
  document.getElementById('quickCaptureCard').style.display = 'none';
  deepWorkLocked = true;
  await fetchIdeas();
}

function __initModule() {
  fetchIdeas();

  document.getElementById('startQuickCaptureBtn')?.addEventListener('click', () => {
    startCaptureTimer();
  });

  document.getElementById('ideaCaptureForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await sealCaptureCard(false);
  });

  document.getElementById('toggleVaultLockBtn')?.addEventListener('click', async () => {
    deepWorkLocked = !deepWorkLocked;
    await fetchIdeas();
  });

  document.getElementById('synthesizeFridayBtn')?.addEventListener('click', async () => {
    deepWorkLocked = false;
    const all = loadLocalIdeas();
    let md = `# MazenOS Friday Idea Vault Synthesis\n\n`;
    try {
      const res = await fetch('/api/ideas/synthesize', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        md = data.markdown || md;
      } else {
        throw new Error('Local fallback');
      }
    } catch {
      if (all.length === 0) {
        showToast('No captured ideas to synthesize yet.');
        return;
      }
      const grouped = {};
      for (const item of all) {
        const tag = item.domain_tag || 'general';
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push(item);
      }
      for (const [tag, list] of Object.entries(grouped)) {
        md += `## ${tag.toUpperCase()}\n`;
        for (const i of list) md += `- ${i.content} (${i.created_at})\n`;
        md += `\n`;
      }
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `idea-vault-synthesis-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Friday Idea Synthesis downloaded as Markdown.');
    await fetchIdeas();
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
