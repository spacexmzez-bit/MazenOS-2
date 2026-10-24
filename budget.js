/**
 * Budget & Zero-Cost Bank SMS Regex Ledger Logic (budget.js)
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

function loadLocalBudget() {
  try { return JSON.parse(localStorage.getItem('mazenos_budget') || '[]'); } catch { return []; }
}

function saveLocalBudget(list) {
  try { localStorage.setItem('mazenos_budget', JSON.stringify(list)); } catch {}
}

function parseSmsClientFallback(rawSms) {
  const text = String(rawSms || '').trim();
  const amountMatch =
    text.match(/(?:SAR|SR|ريال)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i) ||
    text.match(/([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:SAR|SR|ريال)/i);
  const amount_sar = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

  const cardMatch =
    text.match(/(?:Card|بطاقة|mada|مدى|Visa|MasterCard)[^0-9*]*\*?(\d{4})/i) ||
    text.match(/\*(\d{4})/);
  const wallet_source = cardMatch ? `Card *${cardMatch[1]}` : 'Bank SMS';

  const merchantMatch = text.match(/(?:at|Merchant|لدى|لـ)\s*[:\-]?\s*([^\n\r.;|]+)/i);
  const merchant = merchantMatch ? merchantMatch[1].trim().slice(0, 60) : 'POS Purchase';

  const balanceMatch = text.match(/(?:Balance|Bal|Avail|الرصيد)[^0-9]*(?:SAR|SR)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i);
  const balance_after_sar = balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null;

  return {
    id: `sms_${Date.now()}`,
    wallet_source,
    merchant,
    amount_sar,
    balance_after_sar,
    transaction_timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };
}

async function fetchBudget() {
  try {
    const res = await fetch('/api/budget', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Local fallback');
    const data = await res.json();
    entries = data.entries || [];
    saveLocalBudget(entries);
  } catch {
    entries = loadLocalBudget();
  }
  renderBudget();
}

function renderBudget() {
  const balEl = document.getElementById('budgetCurrentBalance');
  const spendEl = document.getElementById('budgetTotalSpend');
  const listEl = document.getElementById('budgetLedgerList');
  if (!listEl) return;

  const totalSpend = entries.reduce((sum, e) => sum + (Number(e.amount_sar) || 0), 0);
  const latestWithBal = entries.find(e => e.balance_after_sar != null && e.balance_after_sar !== '');

  if (balEl) balEl.textContent = `${Number(latestWithBal ? latestWithBal.balance_after_sar : 0).toFixed(2)} SAR`;
  if (spendEl) spendEl.textContent = `${totalSpend.toFixed(2)} SAR`;

  if (entries.length === 0) {
    listEl.innerHTML = `<div class="empty-state">
      <h3>No transactions logged yet</h3>
      <p>Log an expense manually or test the automated Bank SMS regex parser above.</p>
    </div>`;
    return;
  }

  listEl.innerHTML = entries.map(e => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.85rem;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin-bottom:0.55rem;">
      <div>
        <strong>${e.merchant || 'Expense'}</strong>
        <div style="font-size:0.8rem;color:var(--text-secondary);">
          ${e.wallet_source} &bull; ${(e.transaction_timestamp || e.created_at || '').replace('T', ' ').slice(0, 16)}
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:700;color:#fca5a5;">-${Number(e.amount_sar || 0).toFixed(2)} SAR</div>
        ${e.balance_after_sar != null ? `<div style="font-size:0.78rem;color:var(--text-secondary);">Bal: ${Number(e.balance_after_sar).toFixed(2)} SAR</div>` : ''}
      </div>
    </div>
  `).join('');
}

function __initModule() {
  fetchBudget();

  document.getElementById('manualExpenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const balRaw = document.getElementById('expBalanceInput').value;
    const payload = {
      id: `tx_${Date.now()}`,
      wallet_source: document.getElementById('expWalletInput').value.trim(),
      merchant: document.getElementById('expMerchantInput').value.trim(),
      amount_sar: Number(document.getElementById('expAmountInput').value) || 0,
      balance_after_sar: balRaw !== '' ? Number(balRaw) : null,
      transaction_timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };

    try {
      const res = await fetch('/api/budget', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      entries.unshift(payload);
      saveLocalBudget(entries);
    }

    document.getElementById('manualExpenseForm').reset();
    try {
      const s = JSON.parse(localStorage.getItem('mazenos_settings') || '{}');
      const wEl = document.getElementById('expWalletInput');
      if (wEl) wEl.value = s.default_wallet_name || 'Card *4821';
    } catch {}
    showToast('Expense logged.');
    await fetchBudget();
  });

  document.getElementById('smsParseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const smsText = document.getElementById('rawSmsTextarea').value.trim();
    if (!smsText) return;

    try {
      const res = await fetch('/api/budget/sms', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sms_text: smsText })
      });
      if (!res.ok) throw new Error('Local fallback');
    } catch {
      const parsed = parseSmsClientFallback(smsText);
      entries.unshift(parsed);
      saveLocalBudget(entries);
    }

    document.getElementById('rawSmsTextarea').value = '';
    showToast('Bank SMS parsed at zero token cost and added to ledger.');
    await fetchBudget();
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __initModule); } else { __initModule(); }
