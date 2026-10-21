/**
 * Study Locations Directory Logic (locations.js)
 * Implements Flexible Pricing (Average Cost OR Itemized SAR Prices),
 * Add Item Popup Modal, and Ari's Commute Friction Gate.
 */

let locations = [];
let locationItems = [];

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

function loadLocalData() {
  try {
    locations = JSON.parse(localStorage.getItem('mazenos_locations') || '[]');
    locationItems = JSON.parse(localStorage.getItem('mazenos_location_items') || '[]');
  } catch {
    locations = [];
    locationItems = [];
  }
}

function saveLocalData() {
  try {
    localStorage.setItem('mazenos_locations', JSON.stringify(locations));
    localStorage.setItem('mazenos_location_items', JSON.stringify(locationItems));
  } catch {}
}

async function fetchLocations() {
  try {
    const res = await fetch('/api/locations', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    locations = data.locations || [];
    locationItems = data.items || [];
    saveLocalData();
  } catch {
    loadLocalData();
  }
  renderLocations();
}

function renderLocations() {
  const grid = document.getElementById('locationsGrid');
  const select = document.getElementById('gateLocationSelect');
  if (!grid || !select) return;

  grid.innerHTML = '';
  select.innerHTML = '<option value="">Choose saved workspace...</option>';

  if (locations.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <h3>No study locations saved</h3>
      <p>Tap "+ Add Location" to store commute times, quietness ratings, and item prices.</p>
    </div>`;
    return;
  }

  for (const loc of locations) {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = `${loc.name} (${loc.commute_minutes_one_way}m one-way)`;
    select.appendChild(opt);

    const items = locationItems.filter(i => i.location_id === loc.id);
    const card = document.createElement('div');
    card.className = 'card';

    let pricingHtml = '';
    if (items.length > 0) {
      pricingHtml += `<div style="margin-top:0.65rem;font-size:0.84rem;">
        <strong>Menu Items:</strong>
        <ul style="list-style:none;margin-top:0.3rem;display:flex;flex-direction:column;gap:0.2rem;">
          ${items.map(i => `<li style="display:flex;justify-content:space-between;"><span>${i.item_name}</span><span>${Number(i.price_sar).toFixed(2)} SAR</span></li>`).join('')}
        </ul>
      </div>`;
    }
    if (loc.average_cost_sar != null && loc.average_cost_sar !== '') {
      pricingHtml += `<div style="margin-top:0.45rem;font-size:0.84rem;color:var(--text-secondary);">
        Average Cost: <strong>${Number(loc.average_cost_sar).toFixed(2)} SAR</strong>
      </div>`;
    }
    if (!pricingHtml) {
      pricingHtml = `<div style="margin-top:0.45rem;font-size:0.82rem;color:var(--text-muted);">No pricing logged yet</div>`;
    }

    card.innerHTML = `
      <div class="card-header">
        <div>
          <h3 class="card-title">${loc.name}</h3>
          <span class="card-subtitle">${loc.service_type || 'Workspace'} &bull; ${loc.commute_minutes_one_way}m commute</span>
        </div>
        <span class="badge badge-p3">Quiet ${loc.quietness_rating}/5</span>
      </div>
      ${loc.notes ? `<p class="card-subtitle">${loc.notes}</p>` : ''}
      ${pricingHtml}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border-subtle);">
        <button type="button" class="btn btn-sm btn-secondary add-item-btn">Add Item</button>
        ${loc.google_maps_url ? `<a href="${loc.google_maps_url}" target="_blank" rel="noopener" class="btn btn-sm btn-primary">Maps &rarr;</a>` : ''}
      </div>
    `;

    card.querySelector('.add-item-btn')?.addEventListener('click', () => {
      document.getElementById('addItemLocationId').value = loc.id;
      document.getElementById('addItemLocationLabel').textContent = `Logging item price for ${loc.name}`;
      document.getElementById('addItemModal').classList.add('open');
    });

    grid.appendChild(card);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  fetchLocations();

  document.getElementById('openNewLocModalBtn')?.addEventListener('click', () => {
    document.getElementById('locationModal').classList.add('open');
  });
  document.getElementById('closeLocationModalBtn')?.addEventListener('click', () => {
    document.getElementById('locationModal').classList.remove('open');
  });
  document.getElementById('closeAddItemModalBtn')?.addEventListener('click', () => {
    document.getElementById('addItemModal').classList.remove('open');
  });

  document.getElementById('locationForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const avgRaw = document.getElementById('locAvgCostInput').value;
    const payload = {
      name: document.getElementById('locNameInput').value.trim(),
      service_type: document.getElementById('locTypeInput').value.trim(),
      quietness_rating: Number(document.getElementById('locQuietInput').value) || 4,
      commute_minutes_one_way: Number(document.getElementById('locCommuteInput').value) || 15,
      average_cost_sar: avgRaw !== '' ? Number(avgRaw) : null,
      google_maps_url: document.getElementById('locMapUrlInput').value.trim(),
      notes: document.getElementById('locNotesInput').value.trim()
    };

    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      locations.push({ id: `loc_${Date.now()}`, ...payload });
      saveLocalData();
    }

    document.getElementById('locationModal').classList.remove('open');
    document.getElementById('locationForm').reset();
    showToast('Study location saved.');
    await fetchLocations();
  });

  document.getElementById('addItemForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const locId = document.getElementById('addItemLocationId').value;
    const payload = {
      item_name: document.getElementById('itemNameInput').value.trim(),
      price_sar: Number(document.getElementById('itemPriceInput').value) || 0
    };

    try {
      const res = await fetch(`/api/locations/${locId}/items`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      locationItems.push({ id: `item_${Date.now()}`, location_id: locId, ...payload });
      saveLocalData();
    }

    document.getElementById('addItemModal').classList.remove('open');
    document.getElementById('addItemForm').reset();
    showToast('Item price added.');
    await fetchLocations();
  });

  document.getElementById('commuteGateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const locId = document.getElementById('gateLocationSelect').value;
    const loc = locations.find(l => l.id === locId);
    const box = document.getElementById('commuteVerdictBox');
    if (!loc) {
      showToast('Select a saved workspace first.');
      return;
    }
    const studyMins = Number(document.getElementById('gateFocusMinsInput').value) || 120;
    const roundTrip = (Number(loc.commute_minutes_one_way) || 15) * 2;
    const share = Math.round((roundTrip / Math.max(1, studyMins)) * 100);
    const approved = share <= 35;

    box.style.display = 'block';
    box.style.borderColor = approved ? 'var(--accent-jade)' : 'var(--danger)';
    box.innerHTML = approved
      ? `<strong style="color:var(--accent-jade);">Approved (${share}% Transit Ratio):</strong> ${roundTrip}m round-trip to ${loc.name} leaves ${studyMins - roundTrip}m of net deep work.`
      : `<strong style="color:#fca5a5;">Blocked by Ari (${share}% Transit Ratio):</strong> ${roundTrip}m round-trip to ${loc.name} wastes too much of your ${studyMins}m block. Work from home.`;
  });
});
