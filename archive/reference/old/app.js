function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const activeNav =
    (typeof event !== 'undefined' && event.currentTarget ? event.currentTarget : null) ||
    [...document.querySelectorAll('.nav-item')].find(n =>
      String(n.getAttribute('onclick') || '').includes(`'${name}'`)
    );
  if (activeNav) activeNav.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'newBill') initNewBill();
  if (name === 'newPayment') initNewPayment();
  if (name === 'printBill') initPrintBill();
  if (name === 'ledger') initLedger();
  if (name === 'transactions') initTransactions();
  if (name === 'monthlyReport') initMonthlyReport();
  if (name === 'backup') initBackupPage();
  if (name === 'customers') loadCustomersPage();
  if (name === 'items') loadItemsPage();
}

function getActivePageName() {
  const active = document.querySelector('.page.active');
  if (!active) return 'dashboard';
  return active.id.replace('page-', '');
}

function renderCurrentPage() {
  const page = getActivePageName();
  if (page === 'dashboard') loadDashboard();
  if (page === 'newBill') initNewBill();
  if (page === 'newPayment') initNewPayment();
  if (page === 'printBill') initPrintBill();
  if (page === 'ledger') initLedger();
  if (page === 'transactions') initTransactions();
  if (page === 'monthlyReport') initMonthlyReport();
  if (page === 'backup') initBackupPage();
  if (page === 'customers') loadCustomersPage();
  if (page === 'items') loadItemsPage();
}

const RECENT_BILLS_PAGE_SIZE = 10;
let recentBillsVisibleCount = RECENT_BILLS_PAGE_SIZE;
let lastBackgroundRefreshAt = 0;
let appModalResolver = null;
const MARKET_RATE_CACHE_KEY = 'billbook_market_rate_cache_v1';
const MARKET_RATE_AUTO_DAY_KEY = 'billbook_market_rate_auto_day_v1';
const BACKUP_SCHEMA_VERSION = 1;
let dashboardSearchDebounceTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(value, maxLen = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function normalizeDateInput(value) {
  const d = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function normalizePaymentNoteForDuplicate(raw) {
  const parsed = parsePaymentNote(raw);
  const mode = (parsed.mode || 'OTHER').toUpperCase();
  const note = sanitizeText(parsed.note || raw || '', 200).toLowerCase();
  return `[MODE:${mode}] ${note}`;
}

function setAppLoading(loading) {
  const overlay = document.getElementById('app-loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !loading);
}

function updateRefreshIndicator(stateText) {
  const stateEl = document.getElementById('dashboard-refresh-state');
  const timeEl = document.getElementById('dashboard-last-refreshed');
  if (stateEl) stateEl.textContent = stateText || 'Idle';
  if (timeEl) {
    timeEl.textContent = lastBackgroundRefreshAt
      ? `Last refreshed ${new Date(lastBackgroundRefreshAt).toLocaleTimeString()}`
      : 'Not refreshed yet';
  }
}

function closeAppModal(result) {
  const backdrop = document.getElementById('app-modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  if (appModalResolver) {
    const resolver = appModalResolver;
    appModalResolver = null;
    resolver(result);
  }
}

function closeAppModalFromBackdrop(event) {
  if (event.target?.id === 'app-modal-backdrop') closeAppModal(false);
}

function openConfirmModal({
  title = 'Confirm Action',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false
}) {
  return new Promise(resolve => {
    const backdrop = document.getElementById('app-modal-backdrop');
    const titleEl = document.getElementById('app-modal-title');
    const bodyEl = document.getElementById('app-modal-body');
    const actionsEl = document.getElementById('app-modal-actions');
    if (!backdrop || !titleEl || !bodyEl || !actionsEl) {
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    appModalResolver = resolve;
    titleEl.textContent = title;
    bodyEl.innerHTML = `<div>${escapeHtml(message).replace(/\n/g, '<br>')}</div>`;
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-secondary">${cancelText}</button>
      <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${confirmText}</button>
    `;
    const [cancelBtn, confirmBtn] = actionsEl.querySelectorAll('button');
    cancelBtn?.addEventListener('click', () => closeAppModal(false), { once: true });
    confirmBtn?.addEventListener('click', () => closeAppModal(true), { once: true });
    backdrop.classList.add('open');
  });
}

function openFormModal({
  title = 'Edit Details',
  description = '',
  confirmText = 'Save',
  cancelText = 'Cancel',
  fields = []
}) {
  return new Promise(resolve => {
    const backdrop = document.getElementById('app-modal-backdrop');
    const titleEl = document.getElementById('app-modal-title');
    const bodyEl = document.getElementById('app-modal-body');
    const actionsEl = document.getElementById('app-modal-actions');
    if (!backdrop || !titleEl || !bodyEl || !actionsEl) {
      const values = {};
      for (const f of fields) {
        const answer = window.prompt(
          `${title}\n${description ? `${description}\n` : ''}${f.label || f.name}`,
          String(f.value ?? '')
        );
        if (answer == null) {
          resolve(null);
          return;
        }
        const trimmed = String(answer).trim();
        if (f.required && !trimmed) {
          toast(`${f.label || f.name} is required`, 'error');
          resolve(null);
          return;
        }
        values[f.name] = trimmed;
      }
      resolve(values);
      return;
    }
    appModalResolver = resolve;
    titleEl.textContent = title;
    const fieldHtml = fields.map(f => {
      if (f.type === 'select') {
        const options = (f.options || []).map(opt => {
          const selected = String(opt.value) === String(f.value ?? '') ? ' selected' : '';
          return `<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(opt.label)}</option>`;
        }).join('');
        return `<div class="form-group">
          <label>${escapeHtml(f.label || f.name)}</label>
          <select id="modal-field-${escapeHtml(f.name)}">${options}</select>
        </div>`;
      }
      return `<div class="form-group">
        <label>${escapeHtml(f.label || f.name)}</label>
        <input id="modal-field-${escapeHtml(f.name)}" type="${escapeHtml(f.type || 'text')}" value="${escapeHtml(f.value ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}">
      </div>`;
    }).join('');
    bodyEl.innerHTML = `${description ? `<p style="margin-bottom:12px">${escapeHtml(description)}</p>` : ''}${fieldHtml}`;
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-secondary">${cancelText}</button>
      <button type="button" class="btn btn-primary">${confirmText}</button>
    `;
    const [cancelBtn, confirmBtn] = actionsEl.querySelectorAll('button');
    cancelBtn?.addEventListener('click', () => closeAppModal(null), { once: true });
    confirmBtn?.addEventListener('click', () => {
      const values = {};
      for (const f of fields) {
        const input = document.getElementById(`modal-field-${f.name}`);
        const value = String(input?.value ?? '').trim();
        if (f.required && !value) {
          toast(`${f.label || f.name} is required`, 'error');
          return;
        }
        values[f.name] = value;
      }
      closeAppModal(values);
    }, { once: true });
    backdrop.classList.add('open');
    const firstInput = bodyEl.querySelector('input,select,textarea');
    if (firstInput) firstInput.focus();
  });
}

function isAnyFormDirty() {
  const activeElement = document.activeElement;
  if (activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName)) {
    return true;
  }
  const hasTypedBillForm = ['bill-mkt', 'bill-lr-input', 'pay-note', 'cust-name', 'item-name']
    .some(id => {
      const el = document.getElementById(id);
      return el && String(el.value || '').trim() !== '';
    });
  return hasTypedBillForm;
}

function getCustomerBillsSorted(customer) {
  const billNos = [...(billsByCustomer.get(customer) || new Set())];
  return billNos
    .map(billNo => {
      const rows = billRowsByNo.get(String(billNo)) || [];
      return { billNo: String(billNo), billDate: rows[0]?.[1] || '' };
    })
    .sort((a, b) => {
      const da = new Date(a.billDate);
    const db = new Date(b.billDate);
    if (da - db !== 0) return da - db;
    return String(a.billNo).localeCompare(String(b.billNo), undefined, { numeric: true });
    });
}

function parseStoredBillNo(raw) {
  const value = String(raw || '').trim();
  const m = value.match(/^(\d+)-(\d+)$/);
  if (m) return { bookNo: Number(m[1]), billNo: Number(m[2]), normalized: `${m[1]}-${m[2]}` };
  const justNum = value.match(/^\d+$/);
  if (justNum) return { bookNo: null, billNo: Number(value), normalized: value };
  return { bookNo: null, billNo: null, normalized: value };
}

function makeStoredBillNo(bookNo, billNo) {
  const b = String(Number(bookNo));
  const n = String(Number(billNo)).padStart(3, '0');
  return `${b}-${n}`;
}

function getLatestBillMeta() {
  const byBill = new Map();
  cachedBillItems.forEach(r => {
    const bill = String(r[0]);
    const date = r[1];
    if (!byBill.has(bill)) byBill.set(bill, { bill, date });
  });
  const rows = [...byBill.values()];
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const da = new Date(a.date);
    const db = new Date(b.date);
    if (da - db !== 0) return da - db;
    const pa = parseStoredBillNo(a.bill);
    const pb = parseStoredBillNo(b.bill);
    const ba = pa.bookNo ?? -1;
    const bb = pb.bookNo ?? -1;
    if (ba !== bb) return ba - bb;
    const na = pa.billNo ?? -1;
    const nb = pb.billNo ?? -1;
    if (na !== nb) return na - nb;
    return a.bill.localeCompare(b.bill, undefined, { numeric: true });
  });
  const last = rows[rows.length - 1];
  return { ...last, parsed: parseStoredBillNo(last.bill) };
}

async function applySuggestedBillNumbers() {
  const bookInput = document.getElementById('book-no');
  const billInput = document.getElementById('bill-no');
  if (!bookInput || !billInput) return;
  const latest = getLatestBillMeta();
  if (!latest || !latest.parsed || latest.parsed.bookNo == null || latest.parsed.billNo == null) {
    if (!bookInput.value) bookInput.value = '1';
    if (!billInput.value) billInput.value = '1';
    return;
  }
  if (!bookInput.value) bookInput.value = String(latest.parsed.bookNo);
  if (!billInput.value) {
    const next = latest.parsed.billNo + 1;
    if (next > 100) {
      const useNextBook = await openConfirmModal({
        title: 'Move To Next Book?',
        message: `Last bill in Book ${latest.parsed.bookNo} is 100.\nUse Book ${latest.parsed.bookNo + 1} and Bill 1?`,
        confirmText: 'Use Next Book',
        cancelText: 'Stay On Book'
      });
      if (useNextBook) {
        bookInput.value = String(latest.parsed.bookNo + 1);
        billInput.value = '1';
      } else {
        billInput.value = '100';
      }
    } else {
      billInput.value = String(next);
    }
  }
}

function formatRateDate(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('.');
  if (parts.length === 3) return `${parts[0]}-${parts[1]}-${parts[2]}`;
  return dateStr;
}

function getTodayLocalIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isAfterElevenAM() {
  return new Date().getHours() >= 11;
}

function loadCachedMarketRate() {
  try {
    const raw = localStorage.getItem(MARKET_RATE_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(Number(parsed.localRate))) return;
    marketLocalRate = Number(parsed.localRate);
    marketRateDate = String(parsed.rateDate || '');
    marketRateStatus = String(parsed.status || 'Using cached market rate');
  } catch {
    // ignore cache parse errors
  }
}

function saveCachedMarketRate() {
  try {
    localStorage.setItem(MARKET_RATE_CACHE_KEY, JSON.stringify({
      localRate: marketLocalRate,
      rateDate: marketRateDate,
      status: marketRateStatus,
      savedAt: new Date().toISOString()
    }));
  } catch {
    // ignore storage write errors
  }
}

function shouldAutoRefreshMarketRate() {
  if (!isAfterElevenAM()) return false;
  try {
    const lastAutoDay = String(localStorage.getItem(MARKET_RATE_AUTO_DAY_KEY) || '');
    return lastAutoDay !== getTodayLocalIso();
  } catch {
    return true;
  }
}

function markAutoMarketRateDoneToday() {
  try {
    localStorage.setItem(MARKET_RATE_AUTO_DAY_KEY, getTodayLocalIso());
  } catch {
    // ignore storage write errors
  }
}

function parseBrassB2BRate(xmlText) {
  const latestItem = (xmlText.match(/<item>[\s\S]*?<\/item>/i) || [xmlText])[0];
  const jamnagarBlock = (latestItem.match(/Jamnagar[\s\S]*?(?:Delhi|Copper|MCX|Disclaimer)/i) || [latestItem])[0];
  const localPatterns = [
    /Brass\s+Vilaity[\s\S]{0,80}?:\s*[^0-9]*(\d{3,4})/i,
    /Brass\s+Vilality[\s\S]{0,80}?:\s*[^0-9]*(\d{3,4})/i,
    /Local[\s\S]{0,40}?:\s*[^0-9]*(\d{3,4})/i
  ];
  let localRate = null;
  for (const pattern of localPatterns) {
    const m = jamnagarBlock.match(pattern);
    if (m) {
      localRate = Number(m[1]);
      break;
    }
  }
  const dateMatch = latestItem.match(/Date\s*:\s*(\d{2}\.\d{2}\.\d{4})/i);
  return {
    localRate,
    date: dateMatch ? dateMatch[1] : ''
  };
}

function updateMarketRateUI() {
  const targets = [
    {
      rate: document.getElementById('market-local-rate'),
      date: document.getElementById('market-rate-date'),
      status: document.getElementById('market-rate-status')
    },
    {
      rate: document.getElementById('dashboard-market-local-rate'),
      date: document.getElementById('dashboard-market-rate-date'),
      status: document.getElementById('dashboard-market-rate-status')
    }
  ];
  targets.forEach(t => {
    if (!t.rate || !t.date) return;
    t.rate.textContent = marketLocalRate ? `₹${fmtNum(marketLocalRate)}` : '—';
    t.date.textContent = formatRateDate(marketRateDate);
    if (t.status) {
      t.status.textContent = marketRateStatus || 'Market rate not fetched yet.';
      t.status.className = 'status-note';
      if (String(marketRateStatus).toLowerCase().includes('failed')) {
        t.status.classList.add('error');
      } else if (String(marketRateStatus).toLowerCase().includes('updated')) {
        t.status.classList.add('success');
      }
    }
  });
}

async function fetchTextFromSources() {
  const urls = [
    'https://rss.cosearch.me/telegram/channel/brassb2b',
    'https://r.jina.ai/http://rss.cosearch.me/telegram/channel/brassb2b',
    'https://r.jina.ai/http://rsshub.app/telegram/channel/brassb2b',
    './docs/brassb2b.txt'
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const txt = await res.text();
      if (txt && txt.length > 50) return { text: txt, source: url, errors };
      errors.push(`${url} -> Empty response`);
    } catch (err) {
      errors.push(`${url} -> ${err?.message || 'Fetch error'}`);
    }
  }
  return { text: '', source: '', errors };
}

async function refreshMarketRate(options = {}) {
  const isAuto = Boolean(options.isAuto);
  marketRateStatus = isAuto ? 'Auto refresh after 11 AM...' : 'Fetching latest market rate...';
  updateMarketRateUI();
  const fetched = await fetchTextFromSources();
  const xmlText = fetched.text;
  if (!xmlText) {
    marketRateStatus = fetched.errors.length
      ? 'Fetch failed. Please check your internet and retry.'
      : 'Fetch failed. Please retry in a moment.';
    updateMarketRateUI();
    toast('Market rate is unavailable right now. Please retry.', 'error');
    return;
  }
  const parsed = parseBrassB2BRate(xmlText);
  if (!parsed.localRate) {
    marketRateStatus = 'Fetch succeeded but rate could not be read. Please retry.';
    updateMarketRateUI();
    toast('Could not read market rate from source. Please retry.', 'error');
    return;
  }
  marketLocalRate = parsed.localRate;
  marketRateDate = parsed.date;
  marketRateStatus = `Updated from source at ${new Date().toLocaleTimeString()}`;
  saveCachedMarketRate();
  if (isAuto) markAutoMarketRateDoneToday();
  updateMarketRateUI();
  const mktInput = document.getElementById('bill-mkt');
  if (mktInput && !String(mktInput.value || '').trim()) {
    mktInput.value = String(parsed.localRate);
  }
  toast('Market rate updated', 'success');
}

function maybeAutoRefreshMarketRate() {
  if (shouldAutoRefreshMarketRate()) {
    void refreshMarketRate({ isAuto: true });
    return;
  }
  if (!isAfterElevenAM() && !marketLocalRate) {
    marketRateStatus = 'Auto market update starts after 11:00 AM';
    updateMarketRateUI();
  }
}

function isGstLine(itemName) {
  return /^GST\s+\d+%$/i.test(String(itemName || '').trim());
}

function parsePaymentNote(rawNote) {
  const note = String(rawNote || '');
  const m = note.match(/^\[MODE:(CASH|BANK)\]\s*/i);
  if (!m) return { mode: '', note };
  return {
    mode: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(),
    note: note.replace(/^\[MODE:(CASH|BANK)\]\s*/i, '')
  };
}

function normalizeLrList(rawLr) {
  return String(rawLr || '')
    .split(/[\n,]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

function syncLrHiddenInput() {
  const hidden = document.getElementById('bill-lr');
  if (!hidden) return;
  hidden.value = lrChips.join(', ');
}

function renderLrChips() {
  const box = document.getElementById('bill-lr-chips');
  if (!box) return;
  box.innerHTML = lrChips.map((lr, idx) =>
    `<span class="chip">${escapeHtml(lr)}<button type="button" aria-label="Remove LR ${escapeHtml(lr)}" onclick="removeLrChip(${idx})">&times;</button></span>`
  ).join('');
  syncLrHiddenInput();
}

function addLrChip() {
  const input = document.getElementById('bill-lr-input');
  if (!input) return;
  const value = String(input.value || '').trim();
  if (!value) return;
  if (lrChips.some(x => x.toLowerCase() === value.toLowerCase())) {
    toast('LR already added', 'error');
    return;
  }
  lrChips.push(value);
  input.value = '';
  renderLrChips();
}

function removeLrChip(idx) {
  lrChips.splice(idx, 1);
  renderLrChips();
}

function getBillSummaries() {
  return billSummaries;
}

function getRangeDates(range) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = d => d.toISOString().split('T')[0];
  if (range === 'today') {
    const t = today();
    return { from: t, to: t };
  }
  if (range === 'last30') {
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return { from: iso(from), to: iso(now) };
  }
  if (range === 'thisMonth') {
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    return { from: iso(from), to: iso(to) };
  }
  return { from: '', to: '' };
}

function isDateWithin(dateStr, from, to) {
  const d = String(dateStr || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function buildBillStatusMap() {
  const statusMap = new Map();
  const overdueDays = 7;
  cachedCustomers.forEach(c => {
    const customer = c[0];
    const opening = Number(c[1] || 0);
    const bills = getCustomerBillsSorted(customer).map(x => x.billNo);
    const payments = (paymentsByCustomer.get(customer) || []).map(p => ({
      date: String(p[0] || ''),
      amount: Number(p[2] || 0)
    }));
    let payBalance = payments.reduce((s, x) => s + x.amount, 0) - Math.max(opening, 0);
    bills.forEach(billNo => {
      const summary = billSummaries.find(x => String(x.billNo) === String(billNo));
      if (!summary) return;
      const billAmt = Number(summary.grand || 0);
      const allocated = Math.max(0, Math.min(billAmt, payBalance));
      const due = Math.max(0, billAmt - allocated);
      payBalance -= allocated;
      const ageDays = Math.floor((new Date(today()) - new Date(summary.date)) / (1000 * 60 * 60 * 24));
      let status = 'Unpaid';
      if (due <= 0) status = 'Paid';
      else if (allocated > 0) status = 'Partial';
      if (status !== 'Paid' && ageDays > overdueDays) status = 'Overdue';
      statusMap.set(String(billNo), { status, due, paid: allocated, billAmt });
    });
  });
  return statusMap;
}

function getStatusClass(status) {
  if (status === 'Paid') return 'status-paid';
  if (status === 'Partial') return 'status-partial';
  if (status === 'Overdue') return 'status-overdue';
  return 'status-unpaid';
}

function applyDashboardFilters() {
  recentBillsVisibleCount = RECENT_BILLS_PAGE_SIZE;
  loadDashboard();
}

function loadMoreRecentBills() {
  recentBillsVisibleCount += RECENT_BILLS_PAGE_SIZE;
  loadDashboard();
}

function openBillPreviewFromDashboard(billNo) {
  showPage('printBill');
  setTimeout(() => {
    const printSelect = document.getElementById('print-bill-select');
    if (!printSelect) return;
    printSelect.value = String(billNo);
    loadPrintBill();
  }, 120);
}

function openLedgerFromDashboard(customer, evt) {
  if (evt) evt.stopPropagation();
  showPage('ledger');
  setTimeout(() => {
    const sel = document.getElementById('ledger-customer-select');
    if (!sel) return;
    sel.value = customer;
    loadLedger();
  }, 120);
}

async function loadDashboard(forceRefresh = false) {
  if (forceRefresh) await refreshAll();
  const billSummaries = getBillSummaries();
  const bills = billSummaries.map(x => x.billNo);
  const statBills = document.getElementById('stat-bills');
  if (statBills) statBills.textContent = bills.length;
  const totalPay = cachedPayments.reduce((s, r) => s + Number(r[2] || 0), 0);
  const totalSales = billSummaries.reduce((s, x) => s + x.grand, 0);
  const statSales = document.getElementById('stat-sales');
  if (statSales) statSales.textContent = '₹' + fmtNum(totalSales);
  const statPayments = document.getElementById('stat-payments');
  if (statPayments) statPayments.textContent = '₹' + fmtNum(totalPay);
  const statOutstanding = document.getElementById('stat-outstanding');
  if (statOutstanding) statOutstanding.textContent = '₹' + fmtNum(totalSales - totalPay);
  const t = today();
  const todaySales = billSummaries.filter(x => String(x.date).startsWith(t)).reduce((s, x) => s + x.grand, 0);
  const todayCollection = cachedPayments.filter(x => String(x[0]).startsWith(t)).reduce((s, x) => s + Number(x[2] || 0), 0);
  const statTodaySales = document.getElementById('stat-today-sales');
  if (statTodaySales) statTodaySales.textContent = '₹' + fmtNum(todaySales);
  const statTodayCollection = document.getElementById('stat-today-collection');
  if (statTodayCollection) statTodayCollection.textContent = '₹' + fmtNum(todayCollection);
  const month = t.slice(0, 7);
  const monthSales = billSummaries.filter(x => String(x.date).startsWith(month)).reduce((s, x) => s + x.grand, 0);
  const monthMisc = cachedMiscExpenses.filter(x => String(x[0]).startsWith(month)).reduce((s, x) => s + Number(x[2] || 0), 0);
  const statMonthNet = document.getElementById('stat-month-net');
  if (statMonthNet) statMonthNet.textContent = '₹' + fmtNum(monthSales - monthMisc);
  populateCustomerDropdown('dash-customer');
  const rangeSel = document.getElementById('dash-range');
  const fromEl = document.getElementById('dash-from');
  const toEl = document.getElementById('dash-to');
  const searchBill = String(document.getElementById('dash-bill-search')?.value || '').trim().toLowerCase();
  const customerFilter = String(document.getElementById('dash-customer')?.value || '').trim();
  const range = rangeSel?.value || 'thisMonth';
  if (range !== 'custom') {
    const span = getRangeDates(range);
    if (fromEl) fromEl.value = span.from;
    if (toEl) toEl.value = span.to;
  }
  const from = fromEl?.value || '';
  const to = toEl?.value || '';
  const seen = new Set();
  const recent = [];
  for (let r of [...billSummaries].reverse()) {
    if (!isDateWithin(r.date, from, to)) continue;
    if (customerFilter && r.customer !== customerFilter) continue;
    if (searchBill && !String(r.billNo).toLowerCase().includes(searchBill)) continue;
    if (!seen.has(r.billNo)) {
      seen.add(r.billNo);
      recent.push(r);
    }
  }
  const visibleRows = recent.slice(0, recentBillsVisibleCount);
  const infoEl = document.getElementById('recent-bills-info');
  const loadMoreBtn = document.getElementById('recent-bills-load-more');
  if (infoEl) infoEl.textContent = `Showing ${visibleRows.length} of ${recent.length} bills`;
  if (loadMoreBtn) {
    loadMoreBtn.style.display = visibleRows.length < recent.length ? 'inline-flex' : 'none';
  }
  const tbody = document.getElementById('recent-bills-body');
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text3);padding:20px;text-align:center">No bills found for selected filters</td></tr>';
  } else {
    tbody.innerHTML = visibleRows.map(r => {
      return `<tr class="recent-bill-row" onclick="openBillPreviewFromDashboard('${String(r.billNo).replace(/'/g, "\\'")}')">
        <td style="font-family:'JetBrains Mono',monospace;color:var(--accent)">${r.billNo}</td>
        <td>${fmtDate(r.date)}</td>
        <td>${escapeHtml(r.customer)}</td>
        <td style="font-family:'JetBrains Mono',monospace;color:var(--text)">₹${fmtNum(r.grand)}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="openLedgerFromDashboard('${String(r.customer).replace(/'/g, "\\'")}', event)">Ledger</button>
        </td>
      </tr>`;
    }).join('');
  }

  const recentPaymentsBody = document.getElementById('recent-payments-body');
  if (recentPaymentsBody) {
    const recentPayments = [...cachedPayments]
      .filter(p => isDateWithin(p[0], from, to))
      .filter(p => !customerFilter || String(p[1] || '') === customerFilter)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .slice(0, recentBillsVisibleCount);
    if (!recentPayments.length) {
      recentPaymentsBody.innerHTML = '<tr><td colspan="5" style="color:var(--text3);padding:20px;text-align:center">No payments found for selected filters</td></tr>';
    } else {
      recentPaymentsBody.innerHTML = recentPayments.map(p => {
        const customer = String(p[1] || '');
        const amount = Number(p[2] || 0);
        const parsed = parsePaymentNote(p[3]);
        const payType = parsed.mode || 'Other';
        return `<tr>
          <td>${fmtDate(p[0])}</td>
          <td>${escapeHtml(customer)}</td>
          <td style="font-family:'JetBrains Mono',monospace;color:var(--text)">₹${fmtNum(amount)}</td>
          <td>${escapeHtml(payType)}</td>
          <td>
            <button class="btn btn-secondary btn-xs" onclick="openLedgerFromDashboard('${customer.replace(/'/g, "\\'")}', event)">Ledger</button>
          </td>
        </tr>`;
      }).join('');
    }
  }
}

function initNewBill() {
  document.getElementById('bill-date').value = today();
  populateCustomerDropdown('bill-customer');
  document.getElementById('bill-gst').value = '0';
  void applySuggestedBillNumbers();
  lrChips = [];
  renderLrChips();
  updateMarketRateUI();
  maybeAutoRefreshMarketRate();
  const mktInput = document.getElementById('bill-mkt');
  if (mktInput && marketLocalRate && !String(mktInput.value || '').trim()) {
    mktInput.value = String(marketLocalRate);
  }
  normalizeEmptyItemRows();
  refreshAll().then(() => {
    populateCustomerDropdown('bill-customer');
    normalizeEmptyItemRows();
  });
}

function populateCustomerDropdown(id) {
  const sel = document.getElementById(id);
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select customer...</option>';
  cachedCustomers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c[0];
    opt.textContent = c[0];
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

function getAvailableItems() {
  const map = new Map();
  cachedItems.forEach(r => {
    const name = String(r[0] ?? '').trim();
    if (!name) return;
    const paperRate = Number(r[1] || 0);
    if (!map.has(name)) map.set(name, { name, paperRate });
  });
  cachedBillItems.forEach(r => {
    const name = String(r[4] ?? '').trim();
    if (!name || isGstLine(name)) return;
    // If item is present in historical bills but missing in Items master,
    // keep it selectable with zero paper rate by default.
    if (!map.has(name)) map.set(name, { name, paperRate: 0 });
  });
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getCurrentBillMktRate() {
  const mktInput = document.getElementById('bill-mkt');
  const mkt = Number(mktInput?.value || 0);
  return Number.isFinite(mkt) ? mkt : 0;
}

function addItemRow() {
  const tbody = document.getElementById('bill-items-body');
  const idx = tbody.children.length;
  const availableItems = getAvailableItems();
  const itemOptions = availableItems
    .map(i => `<option value="${i.name}" data-paper-rate="${i.paperRate}">${i.name}</option>`)
    .join('');
  const tr = document.createElement('tr');
  tr.className = 'item-row';
  tr.innerHTML = `
    <td>
      <select onchange="onItemSelect(this,${idx})" style="width:100%">
        <option value="">${availableItems.length ? 'Select item...' : 'No items found'}</option>
        ${itemOptions}
      </select>
    </td>
    <td><input type="number" class="item-qty" placeholder="0" oninput="calcRow(${idx})" style="width:100%"></td>
    <td><input type="number" class="item-rate" placeholder="0" oninput="calcRow(${idx})" style="width:100%"></td>
    <td><input type="number" class="item-amount" readonly disabled style="width:100%;background:var(--bg)"></td>
    <td><button class="btn btn-danger" onclick="removeItemRow(this)">✕</button></td>
  `;
  tbody.appendChild(tr);
  updateTotals();
}

function isRowEmpty(row) {
  const item = String(row.querySelector('select')?.value || '').trim();
  const qty = parseFloat(row.querySelector('.item-qty')?.value || 0) || 0;
  const rate = parseFloat(row.querySelector('.item-rate')?.value || 0) || 0;
  return !item && qty === 0 && rate === 0;
}

function normalizeEmptyItemRows() {
  const tbody = document.getElementById('bill-items-body');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('.item-row')];
  if (rows.length === 0) {
    addItemRow();
    return;
  }
  const allEmpty = rows.every(isRowEmpty);
  if (allEmpty && rows.length > 1) {
    rows.slice(1).forEach(r => r.remove());
    updateTotals();
  }
}

function onItemSelect(sel, idx) {
  const opt = sel.options[sel.selectedIndex];
  const paperRate = Number(opt.getAttribute('data-paper-rate') || 0);
  const autoRate = getCurrentBillMktRate() + paperRate;
  const row = sel.closest('tr');
  if (row) row.querySelector('.item-rate').value = autoRate > 0 ? autoRate : '';
  calcRow(idx);
}

function calcRow(idx) {
  const rows = document.querySelectorAll('#bill-items-body .item-row');
  const row = rows[idx];
  if (!row) return;
  const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
  const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
  row.querySelector('.item-amount').value = (qty * rate).toFixed(0);
  updateTotals();
}

function updateTotals() {
  const rows = document.querySelectorAll('#bill-items-body .item-row');
  let totalQty = 0, totalBags = 0, itemsTotal = 0;
  rows.forEach(row => {
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    totalQty += qty;
    itemsTotal += parseFloat(row.querySelector('.item-amount').value) || 0;
    totalBags += qty / 50;
  });
  const transport = parseFloat(document.getElementById('bill-transport').value) || 0;
  const gstRate = parseFloat(document.getElementById('bill-gst').value) || 0;
  const subTotal = itemsTotal + transport;
  const gstAmount = Math.round((subTotal * gstRate) / 100);
  document.getElementById('total-qty').textContent = totalQty + ' kg';
  document.getElementById('total-bags').textContent = totalBags.toFixed(2);
  document.getElementById('items-total').textContent = '₹' + fmtNum(itemsTotal);
  document.getElementById('transport-show').textContent = '₹' + fmtNum(transport);
  document.getElementById('gst-show').textContent = '₹' + fmtNum(gstAmount);
  document.getElementById('grand-total').textContent = '₹' + fmtNum(subTotal + gstAmount);
}

document.addEventListener('input', e => {
  if (e.target.id === 'bill-transport') updateTotals();
});
document.addEventListener('change', e => {
  if (e.target.id === 'bill-gst') updateTotals();
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'bill-lr-input' && e.key === 'Enter') {
    e.preventDefault();
    addLrChip();
  }
  const activePage = getActivePageName();
  if (e.key === 'Escape') {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const appModalBackdrop = document.getElementById('app-modal-backdrop');
    if (modalBackdrop?.classList.contains('open')) closeModal();
    if (appModalBackdrop?.classList.contains('open')) closeAppModal(null);
    toggleLogPanel(false);
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (activePage === 'printBill') {
      document.getElementById('print-bill-select')?.focus();
    } else {
      showPage('dashboard');
      setTimeout(() => document.getElementById('dash-bill-search')?.focus(), 80);
    }
  }
  if (!e.ctrlKey && e.key === '/' && activePage === 'dashboard') {
    const targetTag = String(e.target?.tagName || '').toUpperCase();
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag)) {
      e.preventDefault();
      document.getElementById('dash-bill-search')?.focus();
    }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    if (activePage === 'newBill') {
      e.preventDefault();
      void saveBill();
    } else if (activePage === 'newPayment') {
      e.preventDefault();
      void savePayment();
    }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'p' && activePage === 'printBill') {
    e.preventDefault();
    printBillAsPdf();
  }
});

document.addEventListener('input', e => {
  if (e.target?.id === 'dash-bill-search') {
    if (dashboardSearchDebounceTimer) clearTimeout(dashboardSearchDebounceTimer);
    dashboardSearchDebounceTimer = setTimeout(() => applyDashboardFilters(), 160);
  }
});

function removeItemRow(btn) {
  btn.closest('tr').remove();
  updateTotals();
}

async function saveBill() {
  const bookNo = sanitizeText(document.getElementById('book-no').value, 10);
  const billNoNumeric = sanitizeText(document.getElementById('bill-no').value, 10);
  const billNo = makeStoredBillNo(bookNo, billNoNumeric);
  const date = normalizeDateInput(document.getElementById('bill-date').value);
  const customer = sanitizeText(document.getElementById('bill-customer').value, 120);
  const mkt = sanitizeText(document.getElementById('bill-mkt').value, 30);
  const transport = parseFloat(document.getElementById('bill-transport').value) || 0;
  const gstRate = parseFloat(document.getElementById('bill-gst').value) || 0;
  const lrNo = normalizeLrList(document.getElementById('bill-lr').value).join(', ');

  if (!bookNo || !billNoNumeric || !date || !customer) { toast('Fill Book No, Bill No, Date and Customer', 'error'); return; }
  if (Number(bookNo) <= 0 || Number(billNoNumeric) <= 0) { toast('Book/Bill numbers must be positive', 'error'); return; }
  if (Number(billNoNumeric) > 100) { toast('Bill No must be between 1 and 100', 'error'); return; }
  if (isDuplicateBillNo(bookNo, billNoNumeric)) {
    toast('Book No + Bill No already exists.', 'error');
    return;
  }

  const rows = document.querySelectorAll('#bill-items-body .item-row');
  const items = [];
  let valid = true;
  rows.forEach(row => {
    const itemName = sanitizeText(row.querySelector('select').value, 120);
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    if (!itemName || qty === 0 || rate === 0) { valid = false; return; }
    items.push({
      itemName, qty, rate,
      amount: qty * rate,
      transport: 0,
      bags: parseFloat((qty / 50).toFixed(2))
    });
  });
  if (!valid || items.length === 0) { toast('Each item row needs item, qty and rate > 0', 'error'); return; }

  if (!lrNo) {
    const continueWithoutLr = await openConfirmModal({
      title: 'Save Without LR Number?',
      message: 'No LR number was added. Do you want to continue saving this bill?',
      confirmText: 'Save Bill',
      cancelText: 'Go Back'
    });
    if (!continueWithoutLr) return;
  }

  const itemsOnlyTotal = items.reduce((s, x) => s + Number(x.amount || 0), 0);
  const gstAmount = Math.round(((itemsOnlyTotal + transport) * gstRate) / 100);
  if (gstRate > 0 && gstAmount <= 0) {
    toast('GST selected but calculated GST amount is 0', 'error');
    return;
  }
  if (gstRate > 0 && gstAmount > 0) {
    items.push({
      itemName: `GST ${gstRate}%`,
      qty: 0,
      rate: 0,
      amount: gstAmount,
      transport: 0,
      bags: 0
    });
  }

  items[0].transport = transport;

  const lrList = normalizeLrList(lrNo);
  const oldLrSet = new Set(
    cachedBillItems
      .map(r => normalizeLrList(r[10] || ''))
      .flat()
      .map(x => x.toLowerCase())
  );
  const duplicateLr = lrList.filter(x => oldLrSet.has(x.toLowerCase()));
  if (duplicateLr.length) {
    const proceedWithDuplicateLr = await openConfirmModal({
      title: 'Duplicate LR Number Found',
      message: `These LR numbers were used earlier: ${duplicateLr.join(', ')}.\nDo you still want to continue?`,
      confirmText: 'Continue Saving',
      cancelText: 'Review LR'
    });
    if (!proceedWithDuplicateLr) return;
  }

  document.getElementById('bill-save-status').innerHTML = '<span class="spinner"></span> Saving...';
  const res = await apiPost({ action: 'saveBill', billNo, date, customer, mkt, lrNo, items });
  if (res.status === 'success') {
    toast('Bill saved successfully!', 'success');
    invalidateCacheNow();
    await refreshAll();
    showPage('printBill');
    const printSelect = document.getElementById('print-bill-select');
    if (printSelect) {
      printSelect.value = billNo;
      loadPrintBill();
    }
    resetBillForm();
    document.getElementById('bill-save-status').textContent = '';
  } else {
    toast('Error saving bill', 'error');
    document.getElementById('bill-save-status').textContent = '';
  }
}

function resetBillForm() {
  document.getElementById('book-no').value = '';
  document.getElementById('bill-no').value = '';
  document.getElementById('bill-mkt').value = '';
  document.getElementById('bill-transport').value = '0';
  document.getElementById('bill-gst').value = '0';
  lrChips = [];
  renderLrChips();
  document.getElementById('bill-lr-input').value = '';
  document.getElementById('bill-items-body').innerHTML = '';
  document.getElementById('bill-date').value = today();
  addItemRow();
  void applySuggestedBillNumbers();
  normalizeEmptyItemRows();
  updateTotals();
}

function initNewPayment() {
  document.getElementById('pay-date').value = today();
  populateCustomerDropdown('pay-customer');
  document.getElementById('pay-mode').value = 'Cash';
  refreshAll().then(() => populateCustomerDropdown('pay-customer'));
}

async function savePayment() {
  const date = normalizeDateInput(document.getElementById('pay-date').value);
  const customer = sanitizeText(document.getElementById('pay-customer').value, 120);
  const amount = parseFloat(document.getElementById('pay-amount').value) || 0;
  const mode = sanitizeText(document.getElementById('pay-mode').value || 'Cash', 20);
  const note = sanitizeText(document.getElementById('pay-note').value, 200);
  if (!date || !customer || amount <= 0) { toast('Fill all payment fields with valid amount', 'error'); return; }
  const safeMode = ['Cash', 'Bank', 'Other'].includes(mode) ? mode : 'Other';
  const noteWithMode = safeMode === 'Other' ? note : `[MODE:${safeMode.toUpperCase()}] ${note}`.trim();
  if (isDuplicatePaymentEntry({ date, customer, amount, note: noteWithMode })) {
    const allowDuplicate = await openConfirmModal({
      title: 'Duplicate Payment Detected',
      message: 'Same payment (date/customer/amount/mode/note) already exists.\nSave anyway?',
      confirmText: 'Save Anyway',
      cancelText: 'Cancel'
    });
    if (!allowDuplicate) return;
  }
  document.getElementById('pay-save-status').innerHTML = '<span class="spinner"></span> Saving...';
  const res = await apiPost({ action: 'savePayment', date, customer, amount, note: noteWithMode });
  if (res.status === 'success') {
    toast('Payment saved!', 'success');
    invalidateCacheNow();
    await refreshAll();
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-note').value = '';
    document.getElementById('pay-save-status').textContent = '';
  } else {
    toast('Error saving payment', 'error');
    document.getElementById('pay-save-status').textContent = '';
  }
}

function initPrintBill(options = {}) {
  const preservePreview = Boolean(options.preservePreview);
  const sel = document.getElementById('print-bill-select');
  const metaEl = document.getElementById('print-bill-meta');
  const renderOptions = (preferredValue = '') => {
    const rows = [...new Set(cachedBillItems.map(r => String(r[0])))]
      .map(billNo => {
        const row = (billRowsByNo.get(String(billNo)) || [])[0] || [];
        return {
          billNo: String(billNo),
          date: row[1] || '',
          customer: row[2] || ''
        };
      })
      .sort((a, b) => {
        const da = new Date(a.date || 0);
        const db = new Date(b.date || 0);
        if (db - da !== 0) return db - da;
        return String(b.billNo).localeCompare(String(a.billNo), undefined, { numeric: true });
      });
    const previous = String(preferredValue || sel.value || '');
    sel.innerHTML = '<option value="">Select bill...</option>' + rows
      .map(x => `<option value="${x.billNo}">${x.billNo} • ${fmtDate(x.date)} • ${x.customer || '—'}</option>`)
      .join('');
    if (previous && rows.some(x => String(x.billNo) === previous)) {
      sel.value = previous;
    }
  };
  renderOptions();
  const previewArea = document.getElementById('print-preview-area');
  if (!preservePreview || !sel.value) {
    if (previewArea) previewArea.style.display = 'none';
    if (metaEl) metaEl.textContent = 'Choose a bill to view customer/date details.';
  } else if (lastPreviewInfo && String(lastPreviewInfo.billNo) === String(sel.value)) {
    if (previewArea) previewArea.style.display = 'block';
  } else {
    loadPrintBill();
  }
  sel.onchange = () => {
    const billNo = sel.value;
    if (!billNo) {
      if (previewArea) previewArea.style.display = 'none';
      if (metaEl) metaEl.textContent = 'Choose a bill to view customer/date details.';
      return;
    }
    const row = (billRowsByNo.get(String(billNo)) || [])[0] || [];
    const p = parseStoredBillNo(billNo);
    const billLabel = p.bookNo != null && p.billNo != null ? `Book ${p.bookNo} • Bill ${p.billNo}` : `Bill ${billNo}`;
    if (metaEl) metaEl.textContent = `${billLabel} • ${fmtDate(row[1] || '')} • ${row[2] || 'Unknown customer'}`;
    loadPrintBill();
  };
  refreshAll().then(() => {
    const selectedBefore = sel.value;
    renderOptions(selectedBefore);
    if (preservePreview && sel.value) {
      if (!lastPreviewInfo || String(lastPreviewInfo.billNo) !== String(sel.value)) {
        loadPrintBill();
      } else if (previewArea) {
        previewArea.style.display = 'block';
      }
    }
  });
}

function loadPrintBill() {
  const billNo = document.getElementById('print-bill-select').value;
  if (!billNo) { toast('Select a bill first', 'error'); return; }

  const billRows = billRowsByNo.get(String(billNo)) || [];
  if (!billRows.length) { toast('Bill not found', 'error'); return; }

  const customer = billRows[0][2];
  const date = billRows[0][1];
  const mkt = billRows[0][3];
  const transport = Number(billRows[0][8] || 0);
  const lrNo = billRows[0][10] || '';
  const lrList = normalizeLrList(lrNo);

  const gstRows = billRows.filter(r => isGstLine(r[4]));
  const gstTotal = gstRows.reduce((s, r) => s + Number(r[7] || 0), 0);
  const itemsOnlyTotal = billRows
    .filter(r => !isGstLine(r[4]))
    .reduce((s, r) => s + Number(r[7] || 0), 0);
  const itemsTotal = itemsOnlyTotal + gstTotal;
  const totalQty = billRows.reduce((s, r) => s + Number(r[5] || 0), 0);
  const totalBags = billRows.reduce((s, r) => s + Number(r[9] || 0), 0);
  const grandBillAmt = itemsTotal + transport;

  const allCustomerBills = getCustomerBillsSorted(customer);
  const billIdx = allCustomerBills.findIndex(b => String(b.billNo) === String(billNo));
  let prevBalance = 0;

  if (billIdx === 0) {
    const custRow = cachedCustomers.find(c => c[0] === customer);
    prevBalance = Number(custRow?.[1] || 0);
  } else {
    const prevBillNo = allCustomerBills[billIdx - 1].billNo;
    prevBalance = calcClosingBalance(customer, prevBillNo);
  }

  const prevBillNo = billIdx > 0 ? allCustomerBills[billIdx - 1].billNo : null;
  const prevBillDate = prevBillNo ? (billRowsByNo.get(String(prevBillNo)) || [])[0]?.[1] : null;

  const customerPayments = paymentsByCustomer.get(customer) || [];
  const crEntries = customerPayments.filter(p => {
    const pDate = new Date(p[0]);
    const curDate = new Date(date);
    if (prevBillDate) {
      const prevDate = new Date(prevBillDate);
      return pDate > prevDate && pDate <= curDate;
    } else {
      return pDate <= curDate;
    }
  });

  const totalCr = crEntries.reduce((s, p) => s + Number(p[2] || 0), 0);
  const runningTotal = prevBalance + grandBillAmt;
  const finalTotal = runningTotal - totalCr;
  const modeTotals = { Cash: 0, Bank: 0, Other: 0 };
  crEntries.forEach(p => {
    const parsed = parsePaymentNote(p[3]);
    const mode = parsed.mode || 'Other';
    modeTotals[mode] = (modeTotals[mode] || 0) + Number(p[2] || 0);
  });
  const modeSummary = [
    modeTotals.Cash ? `Cash ₹${fmtNum(modeTotals.Cash)}` : '',
    modeTotals.Bank ? `Bank ₹${fmtNum(modeTotals.Bank)}` : '',
    modeTotals.Other ? `Other ₹${fmtNum(modeTotals.Other)}` : ''
  ].filter(Boolean).join(' | ') || 'No payment entries';
  const parsedBill = parseStoredBillNo(billNo);
  const billLabel = parsedBill.bookNo != null && parsedBill.billNo != null
    ? `Book ${parsedBill.bookNo} Bill ${parsedBill.billNo}`
    : `Bill ${billNo}`;
  lastPreviewInfo = { billNo, date, customer, finalTotal, due: finalTotal, currentBill: grandBillAmt, totalCr, modeSummary, billLabel };

  const productRows = billRows.filter(r => !isGstLine(r[4]));
  const gstLabel = gstRows[0]?.[4] || 'GST';
  const itemsHtml = productRows.map(r => `
    <tr>
      <td>${r[4]}</td>
      <td>${r[5]} kg</td>
      <td>₹${fmtNum(r[6])}</td>
      <td style="text-align:right">₹${fmtNum(r[7])}</td>
    </tr>
  `).join('');

  const crHtml = crEntries.map(p => {
    const parsed = parsePaymentNote(p[3]);
    const mode = parsed.mode || 'Other';
    const note = sanitizeText(parsed.note || '', 120);
    const detail = note ? `${mode} (${note})` : mode;
    return `
      <div class="bill-summary-row cr">
        <span>Cr. [dt. ${fmtDate(p[0])}] — ${escapeHtml(detail)}</span>
        <span>− ₹${fmtNum(p[2])}</span>
      </div>
    `;
  }).join('');

  const html = `
    <div class="bill-header">
      <div class="bill-brand">
        <div>
        <div class="bill-company">Kapil Products</div>
        <div class="bill-company-sub">MKT: ${mkt}</div>
        </div>
      </div>
      <div class="bill-meta">
        <div class="bill-date">${fmtDate(date)}</div>
        <div class="bill-no">No. ${billNo}</div>
      </div>
    </div>
    <div class="bill-customer">
      <div>
        <div class="bill-customer-label">M/s.</div>
        <div class="bill-customer-val">${customer}</div>
      </div>
    </div>
    <div class="bill-items-section">
      <table class="bill-items-table">
        <thead>
          <tr>
            <th>Particulars</th><th>Qty</th><th>Rate</th><th>Amount Rs.</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          ${gstTotal > 0 ? `<tr><td>${gstLabel}</td><td></td><td></td><td style="text-align:right">₹${fmtNum(gstTotal)}</td></tr>` : ''}
          ${transport > 0 ? `<tr><td>Transport</td><td></td><td></td><td style="text-align:right">+ ₹${fmtNum(transport)}</td></tr>` : ''}
          <tr class="bill-current-total-row">
            <td colspan="3"><strong>Current Bill Total</strong></td>
            <td style="text-align:right"><strong>₹${fmtNum(grandBillAmt)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="bill-summary">
      <div class="bill-summary-row" style="color:#c9a84c">
        <span>Previous Balance [dt. ${prevBillDate ? fmtDate(prevBillDate) : 'Opening'}]</span>
        <span>+ ₹${fmtNum(prevBalance)}</span>
      </div>
      <div class="bill-summary-row">
        <span>Sub Total</span>
        <span>₹${fmtNum(runningTotal)}</span>
      </div>
      ${totalCr > 0 ? crHtml : ''}
      <div class="bill-summary-row due">
        <span>Amount Due</span>
        <span>₹${fmtNum(finalTotal)}</span>
      </div>
    </div>
    <div class="bill-dispatch">
      <div class="dispatch-item">
        <div class="dispatch-label">Weight</div>
        <div class="dispatch-val">${totalQty} kg</div>
      </div>
      <div class="dispatch-item">
        <div class="dispatch-label">Bags</div>
        <div class="dispatch-val">${Math.round(totalBags)}</div>
      </div>
      <div class="dispatch-item">
        <div class="dispatch-label">LR No.</div>
        <div class="dispatch-val" style="font-size:13px">${lrList.length ? lrList.join('<br>') : '—'}</div>
      </div>
    </div>
  `;

  document.getElementById('print-bill-content').innerHTML = html;
  document.getElementById('print-preview-area').style.display = 'block';
}

function shareBillWhatsApp() {
  if (!lastPreviewInfo) {
    toast('Preview bill first, then share', 'error');
    return;
  }
  const parsed = parseStoredBillNo(lastPreviewInfo.billNo);
  const billLabel = parsed.bookNo != null && parsed.billNo != null
    ? `Book ${parsed.bookNo} Bill ${parsed.billNo}`
    : `Bill ${lastPreviewInfo.billNo}`;
  const text =
    `${billLabel}\n` +
    `Date: ${fmtDate(lastPreviewInfo.date)}\n` +
    `Customer: ${lastPreviewInfo.customer}\n` +
    `Current Bill: ₹${fmtNum(lastPreviewInfo.currentBill || 0)}\n` +
    `Adjusted Payments: ₹${fmtNum(lastPreviewInfo.totalCr || 0)}\n` +
    `Due: ₹${fmtNum(lastPreviewInfo.due || lastPreviewInfo.finalTotal || 0)}\n` +
    `Payment Modes: ${lastPreviewInfo.modeSummary || '—'}\n` +
    `\nPlease find attached bill PDF/image.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function printBillAsPdf() {
  if (!lastPreviewInfo) {
    toast('Preview bill first', 'error');
    return;
  }
  const filename = `${lastPreviewInfo.billNo}-${String(lastPreviewInfo.customer || '').replace(/[^\w-]+/g, '_')}`;
  const prevTitle = document.title;
  document.title = filename;
  window.print();
  setTimeout(() => { document.title = prevTitle; }, 500);
}

function printMonthlyReportPdf() {
  const month = document.getElementById('report-month')?.value;
  if (!month) {
    toast('Select month first', 'error');
    return;
  }
  loadMonthlyReport();
  const prevTitle = document.title;
  document.title = `Monthly-Report-${month}`;
  document.body.classList.add('print-monthly-only');
  window.print();
  setTimeout(() => {
    document.body.classList.remove('print-monthly-only');
    document.title = prevTitle;
  }, 500);
}

async function ensureHtml2Canvas() {
  if (window.html2canvas) return window.html2canvas;
  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas-loader="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load image renderer')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.async = true;
    script.dataset.html2canvasLoader = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load image renderer'));
    document.head.appendChild(script);
  });
  if (!window.html2canvas) throw new Error('Image renderer not available');
  return window.html2canvas;
}

function cloneNodeWithComputedStyles(sourceNode) {
  const clonedRoot = sourceNode.cloneNode(true);
  const sourceWalker = document.createTreeWalker(sourceNode, NodeFilter.SHOW_ELEMENT);
  const cloneWalker = document.createTreeWalker(clonedRoot, NodeFilter.SHOW_ELEMENT);
  let sourceEl = sourceWalker.currentNode;
  let cloneEl = cloneWalker.currentNode;
  while (sourceEl && cloneEl) {
    const computed = window.getComputedStyle(sourceEl);
    for (const prop of computed) {
      cloneEl.style.setProperty(prop, computed.getPropertyValue(prop), computed.getPropertyPriority(prop));
    }
    cloneEl.style.setProperty('box-sizing', 'border-box');
    sourceEl = sourceWalker.nextNode();
    cloneEl = cloneWalker.nextNode();
  }
  return clonedRoot;
}

async function renderNodeToCanvasViaSvg(node) {
  const rect = node.getBoundingClientRect();
  const contentWidth = Math.max(700, Math.ceil(rect.width + 40));
  const contentHeight = Math.max(800, Math.ceil(Math.max(node.scrollHeight, rect.height) + 40));
  const clonedNode = cloneNodeWithComputedStyles(node);
  const serialized = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${contentWidth}" height="${contentHeight}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff;padding:20px;">${clonedNode.outerHTML}</div>
      </foreignObject>
    </svg>`;
  const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Fallback renderer failed'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = contentWidth;
    canvas.height = contentHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Fallback renderer failed');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, contentWidth, contentHeight);
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function downloadBillImage() {
  const node = document.getElementById('print-bill-content');
  if (!node || !node.innerHTML.trim()) {
    toast('Preview bill first', 'error');
    return;
  }
  try {
    let sourceCanvas;
    try {
      const html2canvas = await ensureHtml2Canvas();
      sourceCanvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: Math.max(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false
      });
    } catch (rendererErr) {
      sourceCanvas = await renderNodeToCanvasViaSvg(node);
    }

    // Billbook-optimized export ratio: 11cm x 18cm.
    const targetWidth = 990;
    const targetHeight = Math.round((targetWidth * 18) / 11);
    const exportPadding = 24;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetWidth;
    outCanvas.height = targetHeight;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) {
      toast('Could not render image', 'error');
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    const availableWidth = targetWidth - exportPadding * 2;
    const availableHeight = targetHeight - exportPadding * 2;
    const fitScale = Math.min(availableWidth / sourceCanvas.width, availableHeight / sourceCanvas.height);
    const drawWidth = Math.floor(sourceCanvas.width * fitScale);
    const drawHeight = Math.floor(sourceCanvas.height * fitScale);
    const drawX = Math.floor((targetWidth - drawWidth) / 2);
    const drawY = exportPadding;
    ctx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);

    outCanvas.toBlob((jpgBlob) => {
      if (!jpgBlob) {
        toast('JPG export failed', 'error');
        return;
      }
      const jpgUrl = URL.createObjectURL(jpgBlob);
      const a = document.createElement('a');
      const fileBase = lastPreviewInfo ? `${lastPreviewInfo.billNo}-${String(lastPreviewInfo.customer || '').replace(/[^\w-]+/g, '_')}` : 'bill';
      a.href = jpgUrl;
      a.download = `${fileBase}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(jpgUrl);
    }, 'image/jpeg', 0.95);
  } catch (err) {
    toast(`JPG export failed: ${err?.message || err}`, 'error');
  }
}

function calcClosingBalance(customer, billNo) {
  const allBills = getCustomerBillsSorted(customer).map(b => b.billNo);
  const custRow = cachedCustomers.find(c => c[0] === customer);
  let balance = Number(custRow?.[1] || 0);
  const customerPayments = paymentsByCustomer.get(customer) || [];

  for (let i = 0; i <= allBills.indexOf(billNo); i++) {
    const bn = allBills[i];
    const bRows = billRowsByNo.get(String(bn)) || [];
    const bDate = bRows[0]?.[1];
    const prevDate = i > 0 ? (billRowsByNo.get(String(allBills[i - 1])) || [])[0]?.[1] : null;

    const itemsTotal = bRows.reduce((s, r) => s + Number(r[7] || 0), 0);
    const transport = Number(bRows[0]?.[8] || 0);
    balance += itemsTotal + transport;

    const payments = customerPayments.filter(p => {
      const pDate = new Date(p[0]);
      const curDate = new Date(bDate);
      if (prevDate) return pDate > new Date(prevDate) && pDate <= curDate;
      return pDate <= curDate;
    });
    balance -= payments.reduce((s, p) => s + Number(p[2] || 0), 0);
  }
  return balance;
}

function initLedger() {
  populateCustomerDropdown('ledger-customer-select');
  document.getElementById('ledger-area').style.display = 'none';
  refreshAll().then(() => populateCustomerDropdown('ledger-customer-select'));
}

function handleLedgerCustomerChange() {
  const customer = document.getElementById('ledger-customer-select')?.value;
  if (!customer) {
    document.getElementById('ledger-area').style.display = 'none';
    return;
  }
  loadLedger();
}

function initMonthlyReport() {
  const monthInput = document.getElementById('report-month');
  if (!monthInput) return;
  if (!monthInput.value) monthInput.value = today().slice(0, 7);
}

function initTransactions() {
  const rangeEl = document.getElementById('tx-range');
  const fromEl = document.getElementById('tx-from');
  const toEl = document.getElementById('tx-to');
  if (!rangeEl || !fromEl || !toEl) return;
  const showCustom = rangeEl.value === 'custom';
  fromEl.style.display = showCustom ? '' : 'none';
  toEl.style.display = showCustom ? '' : 'none';

  const custSel = document.getElementById('tx-customer');
  if (custSel) {
    const cur = custSel.value;
    custSel.innerHTML = '<option value="">All Customers</option>';
    cachedCustomers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c[0];
      opt.textContent = c[0];
      custSel.appendChild(opt);
    });
    if (cur && [...custSel.options].some(o => o.value === cur)) {
      custSel.value = cur;
    }
  }
  loadTransactions();
}

function loadTransactions() {
  const tbody = document.getElementById('transactions-body');
  if (!tbody) return;

  const range = document.getElementById('tx-range')?.value || 'last30';
  const fromEl = document.getElementById('tx-from');
  const toEl = document.getElementById('tx-to');
  const showCustom = range === 'custom';
  if (fromEl) fromEl.style.display = showCustom ? '' : 'none';
  if (toEl) toEl.style.display = showCustom ? '' : 'none';
  if (range !== 'custom') {
    const span = getRangeDates(range);
    if (fromEl) fromEl.value = span.from;
    if (toEl) toEl.value = span.to;
  }
  const from = fromEl?.value || '';
  const to = toEl?.value || '';
  const selectedCustomer = String(document.getElementById('tx-customer')?.value || '').trim();
  const selectedType = String(document.getElementById('tx-type')?.value || '').trim();
  const q = String(document.getElementById('tx-search')?.value || '').trim().toLowerCase();

  const events = [];

  billSummaries.forEach(b => {
    events.push({
      date: b.date,
      type: 'Sale',
      customer: String(b.customer || ''),
      detail: `Bill #${b.billNo}`,
      amount: Number(b.grand || 0),
      action: 'preview',
      billNo: String(b.billNo || '')
    });
  });

  cachedPayments.forEach(p => {
    const parsed = parsePaymentNote(p[3]);
    const modeText = parsed.mode || 'Other';
    const noteText = parsed.note ? ` — ${parsed.note}` : '';
    events.push({
      date: p[0],
      type: 'Payment',
      customer: String(p[1] || ''),
      detail: `${modeText}${noteText}`,
      amount: Number(p[2] || 0),
      action: 'ledger'
    });
  });

  cachedMiscExpenses.forEach(m => {
    const miscType = String(m[1] || 'Misc');
    const note = String(m[5] || '').trim();
    const book = String(m[3] || '').trim();
    const bill = String(m[4] || '').trim();
    let ref = '';
    if (book && bill) {
      const billNo = /^\d+$/.test(bill) ? `${book}-${bill.padStart(3, '0')}` : `${book}-${bill}`;
      ref = ` [${billNo}]`;
    }
    events.push({
      date: m[0],
      type: 'Misc',
      customer: '',
      detail: `${miscType}${ref}${note ? ` — ${note}` : ''}`,
      amount: Number(m[2] || 0),
      action: ''
    });
  });

  const filtered = events
    .filter(e => isDateWithin(e.date, from, to))
    .filter(e => !selectedCustomer || e.customer === selectedCustomer)
    .filter(e => !selectedType || e.type === selectedType)
    .filter(e => {
      if (!q) return true;
      return [
        e.date,
        e.type,
        e.customer,
        e.detail
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No transactions found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    let actionBtn = '—';
    if (e.action === 'preview' && e.billNo) {
      actionBtn = `<button class="btn btn-secondary btn-xs" onclick="openBillPreviewFromDashboard('${e.billNo.replace(/'/g, "\\'")}')">Preview</button>`;
    } else if (e.action === 'ledger' && e.customer) {
      actionBtn = `<button class="btn btn-secondary btn-xs" onclick="openLedgerFromDashboard('${e.customer.replace(/'/g, "\\'")}')">Ledger</button>`;
    }
    const amountClass = e.type === 'Payment' ? 'amount-credit' : 'amount-debit';
    const amountSign = e.type === 'Payment' ? '−' : '+';
    return `<tr>
      <td>${fmtDate(e.date)}</td>
      <td><span class="tag ${e.type === 'Sale' ? 'tag-bill' : e.type === 'Payment' ? 'tag-payment' : ''}">${escapeHtml(e.type)}</span></td>
      <td>${e.customer ? escapeHtml(e.customer) : '—'}</td>
      <td>${escapeHtml(e.detail)}</td>
      <td class="${amountClass}">${amountSign} ₹${fmtNum(Math.abs(e.amount))}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

function getNormalizedBillKeyFromParts(bookNo, billNoNumeric) {
  const b = Number(bookNo || 0);
  const n = Number(billNoNumeric || 0);
  if (!Number.isFinite(b) || !Number.isFinite(n) || b <= 0 || n <= 0) return '';
  return `${b}-${String(n).padStart(3, '0')}`;
}

function getNormalizedBillKey(rawBillNo) {
  const parsed = parseStoredBillNo(rawBillNo);
  if (parsed.bookNo != null && parsed.billNo != null) {
    return getNormalizedBillKeyFromParts(parsed.bookNo, parsed.billNo);
  }
  return sanitizeText(rawBillNo, 30);
}

function isDuplicateBillNo(bookNo, billNoNumeric) {
  const target = getNormalizedBillKeyFromParts(bookNo, billNoNumeric);
  if (!target) return false;
  return cachedBillItems.some(r => getNormalizedBillKey(r[0]) === target);
}

function isDuplicatePaymentEntry({ date, customer, amount, note }) {
  const nd = normalizeDateInput(date);
  const nc = sanitizeText(customer, 120).toLowerCase();
  const na = Number(amount || 0);
  const nn = normalizePaymentNoteForDuplicate(note);
  return cachedPayments.some(p =>
    normalizeDateInput(p[0]) === nd &&
    sanitizeText(p[1], 120).toLowerCase() === nc &&
    Number(p[2] || 0) === na &&
    normalizePaymentNoteForDuplicate(p[3] || '') === nn
  );
}

function isCustomerInUse(customerName) {
  const target = sanitizeText(customerName, 120).toLowerCase();
  if (!target) return false;
  const hasBill = cachedBillItems.some(r => sanitizeText(r[2] || '', 120).toLowerCase() === target);
  const hasPayment = cachedPayments.some(p => sanitizeText(p[1] || '', 120).toLowerCase() === target);
  return hasBill || hasPayment;
}

function isItemInUse(itemName) {
  const target = sanitizeText(itemName, 120).toLowerCase();
  if (!target) return false;
  return cachedBillItems.some(r => sanitizeText(r[4] || '', 120).toLowerCase() === target);
}

function isDuplicateMiscEntry({ date, type, amount, note }) {
  const nd = normalizeDateInput(date);
  const nt = sanitizeText(type, 80).toLowerCase();
  const na = Number(amount || 0);
  const nn = sanitizeText(note, 200).toLowerCase();
  return cachedMiscExpenses.some(m =>
    normalizeDateInput(m[0]) === nd &&
    sanitizeText(m[1], 80).toLowerCase() === nt &&
    Number(m[2] || 0) === na &&
    sanitizeText(m[5], 200).toLowerCase() === nn
  );
}

function buildBackupPayload() {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'BillBook',
    data: {
      customers: cachedCustomers,
      items: cachedItems,
      billItems: cachedBillItems,
      payments: cachedPayments,
      miscExpenses: cachedMiscExpenses
    }
  };
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, message: 'Invalid JSON object' };
  if (!payload.data || typeof payload.data !== 'object') return { ok: false, message: 'Missing data block' };
  const required = ['customers', 'items', 'billItems', 'payments', 'miscExpenses'];
  for (const k of required) {
    if (!Array.isArray(payload.data[k])) return { ok: false, message: `Missing/invalid ${k} array` };
  }
  const normalizedBills = new Set();
  let duplicateBills = 0;
  payload.data.billItems.forEach(r => {
    const key = getNormalizedBillKey(r?.[0] ?? '');
    if (!key) return;
    if (normalizedBills.has(key)) duplicateBills += 1;
    else normalizedBills.add(key);
  });
  const normalizedPayments = new Set();
  let duplicatePayments = 0;
  payload.data.payments.forEach(p => {
    const key = [
      normalizeDateInput(p?.[0] || ''),
      sanitizeText(p?.[1] || '', 120).toLowerCase(),
      Number(p?.[2] || 0),
      normalizePaymentNoteForDuplicate(p?.[3] || '')
    ].join('|');
    if (normalizedPayments.has(key)) duplicatePayments += 1;
    else normalizedPayments.add(key);
  });
  const normalizedMisc = new Set();
  let duplicateMisc = 0;
  payload.data.miscExpenses.forEach(m => {
    const key = [
      normalizeDateInput(m?.[0] || ''),
      sanitizeText(m?.[1] || '', 80).toLowerCase(),
      Number(m?.[2] || 0),
      sanitizeText(m?.[5] || '', 200).toLowerCase()
    ].join('|');
    if (normalizedMisc.has(key)) duplicateMisc += 1;
    else normalizedMisc.add(key);
  });
  return {
    ok: true,
    counts: {
      customers: payload.data.customers.length,
      items: payload.data.items.length,
      billItems: payload.data.billItems.length,
      payments: payload.data.payments.length,
      miscExpenses: payload.data.miscExpenses.length
    },
    schemaVersion: Number(payload.schemaVersion || 0),
    duplicateSummary: {
      bills: duplicateBills,
      payments: duplicatePayments,
      misc: duplicateMisc
    }
  };
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  return rows.map(row => row.map(cell => {
    const value = String(cell ?? '');
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\n');
}

function exportBackupJson() {
  const payload = buildBackupPayload();
  const content = JSON.stringify(payload, null, 2);
  const day = today();
  triggerDownload(`billbook-backup-${day}.json`, content, 'application/json;charset=utf-8');
  const status = document.getElementById('backup-export-status');
  if (status) status.textContent = `JSON backup exported (${day})`;
}

function exportBackupCsvBundle() {
  const files = [
    { name: 'Customers', rows: [['Name', 'Opening Balance'], ...cachedCustomers] },
    { name: 'Items', rows: [['Item Name', 'Paper Rate'], ...cachedItems] },
    { name: 'Bill_Items', rows: [['Bill No', 'Date', 'Customer', 'MKT', 'Item Name', 'Qty', 'Rate', 'Amount', 'Transport', 'Bags', 'LR No'], ...cachedBillItems] },
    { name: 'Payments', rows: [['Date', 'Customer', 'Amount', 'Note'], ...cachedPayments] },
    { name: 'Misc_Expenses', rows: [['Date', 'Type', 'Amount', 'Book No', 'Bill No', 'Note'], ...cachedMiscExpenses] }
  ];
  files.forEach(f => {
    triggerDownload(`Billing System - ${f.name}.csv`, toCsv(f.rows), 'text/csv;charset=utf-8');
  });
  const status = document.getElementById('backup-export-status');
  if (status) status.textContent = `CSV exports generated (${files.length} files)`;
}

function initBackupPage() {
  const resultEl = document.getElementById('backup-validate-result');
  if (resultEl && !resultEl.textContent.trim()) {
    resultEl.textContent = 'No file selected.';
  }
}

async function validateBackupFile() {
  const input = document.getElementById('backup-import-file');
  const resultEl = document.getElementById('backup-validate-result');
  if (!input || !resultEl) return;
  const file = input.files?.[0];
  if (!file) {
    resultEl.textContent = 'No file selected.';
    return;
  }
  try {
    const raw = await file.text();
    const payload = JSON.parse(raw);
    const check = validateBackupPayload(payload);
    if (!check.ok) {
      resultEl.textContent = `Invalid backup: ${check.message}`;
      return;
    }
    const schemaText = check.schemaVersion ? `Schema v${check.schemaVersion}` : 'Schema not declared';
    resultEl.textContent = `${schemaText} | Customers: ${check.counts.customers}, Items: ${check.counts.items}, Bills: ${check.counts.billItems}, Payments: ${check.counts.payments}, Misc: ${check.counts.miscExpenses} | Duplicates -> Bills: ${check.duplicateSummary.bills}, Payments: ${check.duplicateSummary.payments}, Misc: ${check.duplicateSummary.misc}`;
  } catch (err) {
    resultEl.textContent = `Invalid file: ${err?.message || 'Could not parse JSON'}`;
  }
}

function loadMonthlyReport() {
  const month = document.getElementById('report-month')?.value;
  if (!month) {
    toast('Select month first', 'error');
    return;
  }
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const monthStart = `${month}-01`;
  const monthEndDate = new Date(year, monthNum, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const prevDayDate = new Date(year, monthNum - 1, 0);
  const prevDay = prevDayDate.toISOString().slice(0, 10);

  const allBills = getBillSummaries();
  const monthBills = allBills.filter(x => String(x.date || '').startsWith(month));
  const monthPayments = cachedPayments.filter(x => String(x[0] || '').startsWith(month));
  const monthMisc = cachedMiscExpenses.filter(x => String(x[0] || '').startsWith(month));

  const sales = monthBills.reduce((s, x) => s + Number(x.grand || 0), 0);
  const collection = monthPayments.reduce((s, x) => s + Number(x[2] || 0), 0);
  const misc = monthMisc.reduce((s, x) => s + Number(x[2] || 0), 0);
  const netMovement = sales - collection;

  const totalOpening = cachedCustomers.reduce((s, c) => s + Number(c[1] || 0), 0);
  const salesTill = (toDate) => allBills
    .filter(x => String(x.date || '') && String(x.date || '').slice(0, 10) <= toDate)
    .reduce((s, x) => s + Number(x.grand || 0), 0);
  const paymentsTill = (toDate) => cachedPayments
    .filter(x => String(x[0] || '') && String(x[0] || '').slice(0, 10) <= toDate)
    .reduce((s, x) => s + Number(x[2] || 0), 0);

  const openingOutstanding = totalOpening + salesTill(prevDay) - paymentsTill(prevDay);
  const closingOutstanding = totalOpening + salesTill(monthEnd) - paymentsTill(monthEnd);

  document.getElementById('report-sales').textContent = '₹' + fmtNum(sales);
  document.getElementById('report-collection').textContent = '₹' + fmtNum(collection);
  document.getElementById('report-net-change').textContent = '₹' + fmtNum(netMovement);
  document.getElementById('report-closing-outstanding').textContent = '₹' + fmtNum(closingOutstanding);
  document.getElementById('report-opening-outstanding').textContent = '₹' + fmtNum(openingOutstanding);
  document.getElementById('report-closing-outstanding-inline').textContent = '₹' + fmtNum(closingOutstanding);
  document.getElementById('report-misc-inline').textContent = '₹' + fmtNum(misc);

  const miscNote = document.getElementById('report-misc-note');
  if (miscNote) {
    miscNote.textContent = miscFeatureAvailable
      ? 'Misc is shown separately and not mixed with core credit/recovery movement.'
      : 'Misc_Expenses feed is not connected in backend yet, so misc is partial.';
  }

  // Customer-wise: Sales vs Collection vs Net Change
  const salesByCustomer = new Map();
  const collectionByCustomer = new Map();
  monthBills.forEach(b => {
    const key = String(b.customer || '').trim();
    if (!key) return;
    salesByCustomer.set(key, (salesByCustomer.get(key) || 0) + Number(b.grand || 0));
  });
  monthPayments.forEach(p => {
    const key = String(p[1] || '').trim();
    if (!key) return;
    collectionByCustomer.set(key, (collectionByCustomer.get(key) || 0) + Number(p[2] || 0));
  });
  const allCustomers = new Set([...salesByCustomer.keys(), ...collectionByCustomer.keys()]);
  const customerRows = [...allCustomers].map(name => {
    const cSales = salesByCustomer.get(name) || 0;
    const cCollection = collectionByCustomer.get(name) || 0;
    return { name, sales: cSales, collection: cCollection, net: cSales - cCollection };
  }).sort((a, b) => b.sales - a.sales);

  const custBody = document.getElementById('report-customer-body');
  custBody.innerHTML = customerRows.length
    ? customerRows.map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="text-mono">₹${fmtNum(r.sales)}</td>
        <td class="text-mono">₹${fmtNum(r.collection)}</td>
        <td class="${r.net >= 0 ? 'amount-debit' : 'amount-credit'}">${r.net >= 0 ? '+' : '−'} ₹${fmtNum(Math.abs(r.net))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" style="color:var(--text3);padding:20px;text-align:center">No data</td></tr>';

  // Top 5 customers by sales
  const top5Body = document.getElementById('report-top5-customer-body');
  const top5 = customerRows.filter(r => r.sales > 0).slice(0, 5);
  top5Body.innerHTML = top5.length
    ? top5.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="text-mono">₹${fmtNum(r.sales)}</td></tr>`).join('')
    : '<tr><td colspan="2" style="color:var(--text3);padding:20px;text-align:center">No data</td></tr>';

  // Item-wise: Qty, Amount, Avg Rate, % of total sales
  const itemMap = new Map();
  cachedBillItems
    .filter(r => String(r[1] || '').startsWith(month) && !isGstLine(r[4]))
    .forEach(r => {
      const item = String(r[4] || '').trim();
      if (!item) return;
      const prev = itemMap.get(item) || { qty: 0, amt: 0 };
      prev.qty += Number(r[5] || 0);
      prev.amt += Number(r[7] || 0);
      itemMap.set(item, prev);
    });
  const itemRows = [...itemMap.entries()]
    .map(([name, v]) => ({
      name,
      qty: v.qty,
      amt: v.amt,
      avg: v.qty > 0 ? (v.amt / v.qty) : 0,
      pct: sales > 0 ? ((v.amt / sales) * 100) : 0
    }))
    .sort((a, b) => b.amt - a.amt);
  const itemBody = document.getElementById('report-item-body');
  itemBody.innerHTML = itemRows.length
    ? itemRows.map(r => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td class="text-mono">${r.qty.toFixed(2)}</td>
        <td class="text-mono">₹${fmtNum(r.amt)}</td>
        <td class="text-mono">₹${fmtNum(Math.round(r.avg))}</td>
        <td class="text-mono">${r.pct.toFixed(1)}%</td>
      </tr>
    `).join('')
    : '<tr><td colspan="5" style="color:var(--text3);padding:20px;text-align:center">No data</td></tr>';

  // Daily sales trend for selected month
  const dailyMap = new Map();
  monthBills.forEach(b => {
    const date = String(b.date || '').slice(0, 10);
    if (!date) return;
    dailyMap.set(date, (dailyMap.get(date) || 0) + Number(b.grand || 0));
  });
  const dailyRows = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const trendEl = document.getElementById('report-daily-trend');
  if (trendEl) {
    if (!dailyRows.length) {
      trendEl.innerHTML = '<div class="table-empty">No daily sales data</div>';
    } else {
      const max = Math.max(...dailyRows.map(x => x[1]), 1);
      trendEl.innerHTML = dailyRows.map(([date, amount]) => {
        const pct = Math.max(2, Math.round((amount / max) * 100));
        const d = new Date(date);
        const label = Number.isFinite(d.getTime())
          ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
          : date;
        return `
          <div class="trend-row">
            <div class="trend-date">${label}</div>
            <div class="trend-bar-wrap"><div class="trend-bar" style="width:${pct}%"></div></div>
            <div class="trend-amt">₹${fmtNum(amount)}</div>
          </div>
        `;
      }).join('');
    }
  }
}

function loadLedger(options = {}) {
  const { silentNoCustomer = false } = options;
  const customer = document.getElementById('ledger-customer-select').value;
  if (!customer) {
    if (!silentNoCustomer) toast('Select a customer', 'error');
    return;
  }

  document.getElementById('ledger-customer-title').textContent = customer;
  document.getElementById('ledger-area').style.display = 'block';

  const custRow = cachedCustomers.find(c => c[0] === customer);
  let balance = Number(custRow?.[1] || 0);
  const rows = [];

  if (balance !== 0) {
    rows.push({ date: '—', type: 'Opening', detail: 'Opening Balance', debit: balance, credit: 0, balance });
  }

  const allBillNos = getCustomerBillsSorted(customer).map(b => b.billNo);
  const allPayments = paymentsByCustomer.get(customer) || [];

  const events = [];
  allBillNos.forEach(bn => {
    const bRows = billRowsByNo.get(String(bn)) || [];
    const date = bRows[0][1];
    const itemsTotal = bRows.reduce((s, r) => s + Number(r[7] || 0), 0);
    const transport = Number(bRows[0]?.[8] || 0);
    events.push({ date, type: 'Bill', billNo: bn, amount: itemsTotal + transport, items: bRows.map(r => r[4]).join(', ') });
  });
  allPayments.forEach(p => {
    events.push({ date: p[0], type: 'Payment', amount: Number(p[2] || 0), note: p[3] });
  });
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  const range = document.getElementById('ledger-range')?.value || 'last30';
  const fromEl = document.getElementById('ledger-from');
  const toEl = document.getElementById('ledger-to');
  if (range !== 'custom') {
    const span = getRangeDates(range);
    if (fromEl) fromEl.value = span.from;
    if (toEl) toEl.value = span.to;
  }
  const from = fromEl?.value || '';
  const to = toEl?.value || '';
  const billSearch = String(document.getElementById('ledger-bill-search')?.value || '').trim().toLowerCase();
  const modeFilter = String(document.getElementById('ledger-paymode')?.value || '').trim();

  events.forEach(ev => {
    if (ev.type === 'Bill') {
      balance += ev.amount;
      if (!isDateWithin(ev.date, from, to)) return;
      if (billSearch && !String(ev.billNo).toLowerCase().includes(billSearch)) return;
      rows.push({ date: ev.date, type: 'Bill', detail: `Bill #${ev.billNo} — ${ev.items}`, debit: ev.amount, credit: 0, balance, billNo: ev.billNo });
    } else {
      balance -= ev.amount;
      const parsed = parsePaymentNote(ev.note);
      if (!isDateWithin(ev.date, from, to)) return;
      const mode = parsed.mode || 'Other';
      if (modeFilter && mode !== modeFilter) return;
      const detail = parsed.mode
        ? `${parsed.mode}${parsed.note ? ' — ' + parsed.note : ''}`
        : (parsed.note || 'Payment received');
      rows.push({ date: ev.date, type: 'Payment', detail, debit: 0, credit: ev.amount, balance, mode, rawNote: ev.note });
    }
  });

  document.getElementById('ledger-balance').textContent = '₹' + fmtNum(balance);

  const tbody = document.getElementById('ledger-body');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text3);padding:20px;text-align:center">No transactions found</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td><span class="tag ${r.type === 'Bill' ? 'tag-bill' : 'tag-payment'}">${r.type}</span></td>
      <td style="color:var(--text2)">${r.detail}</td>
      <td class="${r.debit ? 'amount-positive' : ''}">${r.debit ? '₹' + fmtNum(r.debit) : '—'}</td>
      <td class="${r.credit ? 'amount-negative' : ''}">${r.credit ? '₹' + fmtNum(r.credit) : '—'}</td>
      <td class="balance-cell">₹${fmtNum(r.balance)}</td>
      <td>
        ${r.type === 'Bill'
          ? `<div class="row-actions">
              <button class="btn btn-secondary btn-xs" onclick="editBillRecord('${String(r.billNo).replace(/'/g, "\\'")}')">Edit</button>
              <button class="btn btn-danger btn-xs" onclick="deleteBillRecord('${String(r.billNo).replace(/'/g, "\\'")}')">Delete</button>
            </div>`
          : `<div class="row-actions">
              <button class="btn btn-secondary btn-xs" onclick="editPaymentRecord('${r.date}','${String(customer).replace(/'/g, "\\'")}',${Number(r.credit || 0)},'${String(r.rawNote || '').replace(/'/g, "\\'")}')">Edit</button>
              <button class="btn btn-danger btn-xs" onclick="deletePaymentRecord('${r.date}','${String(customer).replace(/'/g, "\\'")}',${Number(r.credit || 0)},'${String(r.rawNote || '').replace(/'/g, "\\'")}')">Delete</button>
            </div>`
        }
      </td>
    </tr>
  `).join('');
}

async function refreshAfterCrudMutation() {
  invalidateCacheNow();
  await refreshAll();
  loadDashboard(true);
  loadCustomersPage();
  loadItemsPage();
  loadTransactions();
  loadLedger({ silentNoCustomer: true });
  if (getActivePageName() === 'printBill') {
    initPrintBill({ preservePreview: true });
  }
}

async function editBillRecord(billNo) {
  const rows = billRowsByNo.get(String(billNo)) || [];
  if (!rows.length) {
    toast('Bill not found', 'error');
    return;
  }
  const shouldEdit = await openConfirmModal({
    title: `Edit Bill ${billNo}?`,
    message: 'Do you want to edit this bill details?',
    confirmText: 'Continue',
    cancelText: 'Cancel'
  });
  if (!shouldEdit) return;
  const values = await openFormModal({
    title: `Edit Bill ${billNo}`,
    confirmText: 'Update Bill',
    fields: [
      { name: 'date', label: 'Bill Date (YYYY-MM-DD)', type: 'date', value: String(rows[0][1] || ''), required: true },
      { name: 'mkt', label: 'MKT', value: String(rows[0][3] || ''), required: true },
      { name: 'transport', label: 'Transport', type: 'number', value: String(rows[0][8] || '0'), required: true },
      { name: 'lrNo', label: 'LR No (comma separated)', value: String(rows[0][10] || '') }
    ]
  });
  if (!values) return;
  const date = normalizeDateInput(values.date);
  const mkt = sanitizeText(values.mkt, 30);
  const transport = Number(values.transport || 0);
  const lrNo = normalizeLrList(values.lrNo).join(', ');
  if (!date || !mkt) {
    toast('Date and MKT are required', 'error');
    return;
  }
  if (!Number.isFinite(transport) || transport < 0) {
    toast('Transport must be 0 or more', 'error');
    return;
  }
  const res = await apiPost({
    action: 'editBill',
    billNo,
    updates: {
      date,
      mkt,
      transport,
      lrNo
    }
  });
  if (res.status === 'success') {
    toast('Bill updated', 'success');
    await refreshAfterCrudMutation();
    return;
  }
  toast('editBill action missing in backend or failed', 'error');
}

async function deleteBillRecord(billNo) {
  const shouldDelete = await openConfirmModal({
    title: `Delete Bill ${billNo}?`,
    message: 'This should be used only for wrong entries. This action cannot be undone from UI.',
    confirmText: 'Delete Bill',
    cancelText: 'Cancel',
    danger: true
  });
  if (!shouldDelete) return;
  const res = await apiPost({ action: 'deleteBill', billNo });
  if (res.status === 'success') {
    await refreshAfterCrudMutation();
    const stillExists = (billRowsByNo.get(String(billNo)) || []).length > 0;
    if (stillExists) {
      toast('Delete failed: bill still exists in backend', 'error');
      return;
    }
    toast('Bill deleted', 'success');
    return;
  }
  toast('deleteBill action missing in backend or failed', 'error');
}

async function editPaymentRecord(date, customer, amount, rawNote) {
  const shouldEdit = await openConfirmModal({
    title: 'Edit Payment?',
    message: `Do you want to edit payment for ${customer}?`,
    confirmText: 'Continue',
    cancelText: 'Cancel'
  });
  if (!shouldEdit) return;
  const parsed = parsePaymentNote(rawNote);
  const values = await openFormModal({
    title: `Edit Payment - ${customer}`,
    confirmText: 'Update Payment',
    fields: [
      { name: 'date', label: 'Payment Date', type: 'date', value: String(date || ''), required: true },
      { name: 'amount', label: 'Amount', type: 'number', value: String(amount || 0), required: true },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        value: parsed.mode || 'Cash',
        options: [
          { value: 'Cash', label: 'Cash' },
          { value: 'Bank', label: 'Bank' },
          { value: 'Other', label: 'Other' }
        ]
      },
      { name: 'note', label: 'Note', value: parsed.note || '' }
    ]
  });
  if (!values) return;
  const newDate = normalizeDateInput(values.date);
  const newAmount = Number(values.amount || 0);
  if (!newDate || !Number.isFinite(newAmount) || newAmount <= 0) {
    toast('Payment date and amount (> 0) are required', 'error');
    return;
  }
  const cleanMode = ['Cash', 'Bank'].includes(values.mode) ? values.mode : 'Other';
  const cleanNote = sanitizeText(values.note || '', 200);
  const nextNote = cleanMode === 'Other' ? cleanNote : `[MODE:${cleanMode.toUpperCase()}] ${cleanNote}`.trim();
  const oldKey = {
    date: normalizeDateInput(date),
    customer: sanitizeText(customer, 120).toLowerCase(),
    amount: Number(amount || 0),
    note: normalizePaymentNoteForDuplicate(rawNote || '')
  };
  const duplicateEditedPayment = cachedPayments.some(p => {
    const candidate = {
      date: normalizeDateInput(p[0]),
      customer: sanitizeText(p[1], 120).toLowerCase(),
      amount: Number(p[2] || 0),
      note: normalizePaymentNoteForDuplicate(p[3] || '')
    };
    if (
      candidate.date === oldKey.date &&
      candidate.customer === oldKey.customer &&
      candidate.amount === oldKey.amount &&
      candidate.note === oldKey.note
    ) {
      return false;
    }
    return (
      candidate.date === newDate &&
      candidate.customer === sanitizeText(customer, 120).toLowerCase() &&
      candidate.amount === newAmount &&
      candidate.note === normalizePaymentNoteForDuplicate(nextNote)
    );
  });
  if (duplicateEditedPayment) {
    toast('Another payment with same date/customer/amount/mode/note already exists', 'error');
    return;
  }
  const res = await apiPost({
    action: 'editPayment',
    match: { date, customer, amount: Number(amount || 0), note: rawNote },
    updates: {
      date: newDate,
      amount: newAmount,
      note: nextNote
    }
  });
  if (res.status === 'success') {
    toast('Payment updated', 'success');
    await refreshAfterCrudMutation();
    return;
  }
  toast('editPayment action missing in backend or failed', 'error');
}

async function deletePaymentRecord(date, customer, amount, rawNote) {
  const shouldDelete = await openConfirmModal({
    title: 'Delete Payment?',
    message: `Delete payment ₹${fmtNum(amount)} for ${customer}?`,
    confirmText: 'Delete Payment',
    cancelText: 'Cancel',
    danger: true
  });
  if (!shouldDelete) return;
  const res = await apiPost({
    action: 'deletePayment',
    match: { date, customer, amount: Number(amount || 0), note: rawNote }
  });
  if (res.status === 'success') {
    await refreshAfterCrudMutation();
    const stillExists = cachedPayments.some(p =>
      normalizeDateInput(p[0]) === normalizeDateInput(date) &&
      sanitizeText(p[1], 120).toLowerCase() === sanitizeText(customer, 120).toLowerCase() &&
      Number(p[2] || 0) === Number(amount || 0) &&
      sanitizeText(p[3] || '', 220) === sanitizeText(rawNote || '', 220)
    );
    if (stillExists) {
      toast('Delete failed: payment still exists in backend', 'error');
      return;
    }
    toast('Payment deleted', 'success');
    return;
  }
  toast('deletePayment action missing in backend or failed', 'error');
}

async function loadCustomersPage() {
  const tbody = document.getElementById('customers-body');
  const query = String(
    document.getElementById('customers-search')?.value ||
    document.getElementById('cust-search')?.value ||
    ''
  ).trim().toLowerCase();
  const filtered = cachedCustomers.filter(c => {
    if (!query) return true;
    return String(c[0] || '').toLowerCase().includes(query) || String(c[1] || '').toLowerCase().includes(query);
  });
  if (filtered.length === 0) {
    const msg = query ? 'No matching customers found' : 'No customers yet';
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text3);padding:20px;text-align:center">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((c, i) => `
    <tr>
      <td style="color:var(--text3)">${i + 1}</td>
      <td>${c[0]}</td>
      <td style="font-family:'JetBrains Mono',monospace">₹${fmtNum(c[1] || 0)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-xs" onclick="editCustomerRecord('${String(c[0]).replace(/'/g, "\\'")}')">Edit</button>
          <button class="btn btn-danger btn-xs" onclick="deleteCustomerRecord('${String(c[0]).replace(/'/g, "\\'")}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function saveCustomer() {
  const name = sanitizeText(document.getElementById('cust-name').value, 120);
  const openingBalance = parseFloat(document.getElementById('cust-opening').value) || 0;
  if (!name) { toast('Enter customer name', 'error'); return; }
  if (name.length < 2) { toast('Customer name must be at least 2 characters', 'error'); return; }
  if (!Number.isFinite(openingBalance)) { toast('Opening balance must be a valid number', 'error'); return; }
  if (cachedCustomers.some(c => sanitizeText(c[0], 120).toLowerCase() === name.toLowerCase())) {
    toast('Customer already exists', 'error');
    return;
  }
  document.getElementById('cust-save-status').innerHTML = '<span class="spinner"></span> Saving...';
  const res = await apiPost({ action: 'saveCustomer', name, openingBalance });
  if (res.status === 'success') {
    toast('Customer added!', 'success');
    document.getElementById('cust-name').value = '';
    document.getElementById('cust-opening').value = '0';
    document.getElementById('cust-save-status').textContent = '';
    invalidateCacheNow();
    await refreshAll();
    loadCustomersPage();
  } else {
    toast('Error saving customer', 'error');
    document.getElementById('cust-save-status').textContent = '';
  }
}

async function loadItemsPage() {
  const tbody = document.getElementById('items-body');
  const query = String(
    document.getElementById('items-search')?.value ||
    document.getElementById('item-search')?.value ||
    ''
  ).trim().toLowerCase();
  const filtered = cachedItems.filter(it => {
    if (!query) return true;
    return String(it[0] || '').toLowerCase().includes(query) || String(it[1] || '').toLowerCase().includes(query);
  });
  if (filtered.length === 0) {
    const msg = query ? 'No matching items found' : 'No items yet';
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--text3);padding:20px;text-align:center">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((it, i) => `
    <tr>
      <td style="color:var(--text3)">${i + 1}</td>
      <td>${it[0]}</td>
      <td style="font-family:'JetBrains Mono',monospace">₹${fmtNum(it[1] || 0)}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-xs" onclick="editItemRecord('${String(it[0]).replace(/'/g, "\\'")}')">Edit</button>
          <button class="btn btn-danger btn-xs" onclick="deleteItemRecord('${String(it[0]).replace(/'/g, "\\'")}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function editCustomerRecord(customerName) {
  const existing = cachedCustomers.find(c => String(c[0] || '') === String(customerName));
  if (!existing) {
    toast('Customer not found', 'error');
    return;
  }
  const values = await openFormModal({
    title: `Edit Customer - ${customerName}`,
    confirmText: 'Update',
    fields: [
      { name: 'name', label: 'Customer Name', value: String(existing[0] || ''), required: true },
      { name: 'openingBalance', label: 'Opening Balance', type: 'number', value: String(Number(existing[1] || 0)), required: true }
    ]
  });
  if (!values) return;
  const newName = sanitizeText(values.name, 120);
  const openingBalance = Number(values.openingBalance || 0);
  if (!newName || newName.length < 2) {
    toast('Customer name must be at least 2 characters', 'error');
    return;
  }
  if (!Number.isFinite(openingBalance)) {
    toast('Opening balance must be a valid number', 'error');
    return;
  }
  const duplicateName = cachedCustomers.some(c =>
    String(c[0] || '').toLowerCase() === newName.toLowerCase() &&
    String(c[0] || '') !== String(customerName)
  );
  if (duplicateName) {
    toast('Another customer with same name already exists', 'error');
    return;
  }
  const res = await apiPost({
    action: 'editCustomer',
    match: { name: customerName },
    updates: { name: newName, openingBalance }
  });
  if (res.status === 'success') {
    toast('Customer updated', 'success');
    await refreshAfterCrudMutation();
    return;
  }
  toast(`Customer update failed: ${res?.message || 'backend error'}`, 'error');
}

async function deleteCustomerRecord(customerName) {
  if (isCustomerInUse(customerName)) {
    toast('Cannot delete customer with existing bill/payment history', 'error');
    return;
  }
  const confirmed = await openConfirmModal({
    title: 'Delete Customer?',
    message: `Delete customer "${customerName}"? This should be used only if no bill/payment history depends on it.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true
  });
  if (!confirmed) return;
  const res = await apiPost({
    action: 'deleteCustomer',
    match: { name: customerName }
  });
  if (res.status === 'success') {
    await refreshAfterCrudMutation();
    const stillExists = cachedCustomers.some(c => sanitizeText(c[0], 120).toLowerCase() === sanitizeText(customerName, 120).toLowerCase());
    if (stillExists) {
      toast('Delete failed: customer still exists in backend', 'error');
      return;
    }
    toast('Customer deleted', 'success');
    return;
  }
  toast(`Customer delete failed: ${res?.message || 'backend error'}`, 'error');
}

async function editItemRecord(itemName) {
  const existing = cachedItems.find(it => String(it[0] || '') === String(itemName));
  if (!existing) {
    toast('Item not found', 'error');
    return;
  }
  const values = await openFormModal({
    title: `Edit Item - ${itemName}`,
    confirmText: 'Update',
    fields: [
      { name: 'itemName', label: 'Item Name', value: String(existing[0] || ''), required: true },
      { name: 'paperRate', label: 'Paper Rate', type: 'number', value: String(Number(existing[1] || 0)), required: true }
    ]
  });
  if (!values) return;
  const newItemName = sanitizeText(values.itemName, 120);
  const paperRate = Number(values.paperRate || 0);
  if (!newItemName) {
    toast('Item name required', 'error');
    return;
  }
  if (paperRate < 0) {
    toast('Paper rate cannot be negative', 'error');
    return;
  }
  if (!Number.isFinite(paperRate)) {
    toast('Paper rate must be a valid number', 'error');
    return;
  }
  const duplicateName = cachedItems.some(it =>
    String(it[0] || '').toLowerCase() === newItemName.toLowerCase() &&
    String(it[0] || '') !== String(itemName)
  );
  if (duplicateName) {
    toast('Another item with same name already exists', 'error');
    return;
  }
  const res = await apiPost({
    action: 'editItem',
    match: { itemName },
    updates: { itemName: newItemName, defaultRate: paperRate }
  });
  if (res.status === 'success') {
    toast('Item updated', 'success');
    await refreshAfterCrudMutation();
    return;
  }
  toast(`Item update failed: ${res?.message || 'backend error'}`, 'error');
}

async function deleteItemRecord(itemName) {
  if (isItemInUse(itemName)) {
    toast('Cannot delete item because existing bills depend on it', 'error');
    return;
  }
  const confirmed = await openConfirmModal({
    title: 'Delete Item?',
    message: `Delete item "${itemName}"? This should be used only if no bill rows depend on it.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true
  });
  if (!confirmed) return;
  const res = await apiPost({
    action: 'deleteItem',
    match: { itemName }
  });
  if (res.status === 'success') {
    await refreshAfterCrudMutation();
    const stillExists = cachedItems.some(it => sanitizeText(it[0], 120).toLowerCase() === sanitizeText(itemName, 120).toLowerCase());
    if (stillExists) {
      toast('Delete failed: item still exists in backend', 'error');
      return;
    }
    toast('Item deleted', 'success');
    return;
  }
  toast(`Item delete failed: ${res?.message || 'backend error'}`, 'error');
}

async function saveItem() {
  const itemName = sanitizeText(document.getElementById('item-name').value, 120);
  const defaultRate = parseFloat(document.getElementById('item-rate').value) || 0;
  if (!itemName) { toast('Enter item name', 'error'); return; }
  if (!Number.isFinite(defaultRate)) { toast('Paper rate must be a valid number', 'error'); return; }
  if (defaultRate < 0) { toast('Paper rate cannot be negative', 'error'); return; }
  if (cachedItems.some(it => sanitizeText(it[0], 120).toLowerCase() === itemName.toLowerCase())) {
    toast('Item already exists', 'error');
    return;
  }
  document.getElementById('item-save-status').innerHTML = '<span class="spinner"></span> Saving...';
  const res = await apiPost({ action: 'saveItem', itemName, defaultRate });
  if (res.status === 'success') {
    toast('Item added!', 'success');
    document.getElementById('item-name').value = '';
    document.getElementById('item-rate').value = '';
    document.getElementById('item-save-status').textContent = '';
    invalidateCacheNow();
    await refreshAll();
    loadItemsPage();
  } else {
    toast('Error saving item', 'error');
    document.getElementById('item-save-status').textContent = '';
  }
}

function refreshCurrentPageSafely() {
  const page = getActivePageName();
  if (page === 'dashboard') {
    loadDashboard();
    return;
  }
  if (page === 'ledger') {
    const selectedCustomer = document.getElementById('ledger-customer-select')?.value;
    if (selectedCustomer) loadLedger();
    return;
  }
  if (page === 'printBill') {
    initPrintBill({ preservePreview: true });
    return;
  }
  if (page === 'transactions') {
    loadTransactions();
    return;
  }
  if (page === 'backup') {
    initBackupPage();
    return;
  }
  if (page === 'customers') {
    loadCustomersPage();
    return;
  }
  if (page === 'items') {
    loadItemsPage();
  }
}

async function runBackgroundRefresh() {
  if (isAnyFormDirty()) {
    updateRefreshIndicator('Refresh paused while editing');
    return;
  }
  updateRefreshIndicator('Refreshing...');
  try {
    invalidateCacheNow();
    await refreshAll();
    lastBackgroundRefreshAt = Date.now();
    updateRefreshIndicator('Refresh complete');
    refreshCurrentPageSafely();
  } catch (err) {
    updateRefreshIndicator('Refresh failed');
    logEvent(`Background refresh failed: ${err?.message || 'unknown'}`, 'warn');
  }
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1') {
    document.body.classList.add('debug-mode');
  }
  setAppLoading(true);
  updateRefreshIndicator('Loading...');
  await refreshAll();
  loadDashboard();
  populateCustomerDropdown('bill-customer');
  populateCustomerDropdown('pay-customer');
  populateCustomerDropdown('ledger-customer-select');
  document.getElementById('bill-date').value = today();
  document.getElementById('pay-date').value = today();
  addItemRow();
  loadCustomersPage();
  loadItemsPage();
  renderLogPanel();
  loadCachedMarketRate();
  updateMarketRateUI();
  maybeAutoRefreshMarketRate();
  setAppLoading(false);
  lastBackgroundRefreshAt = Date.now();
  updateRefreshIndicator('Ready');
})();

setInterval(runBackgroundRefresh, 30000);

function toggleLogPanel() {
  const drawer = document.getElementById('log-drawer');
  const backdrop = document.getElementById('log-backdrop');
  if (!drawer) return;
  const shouldOpen = arguments.length ? Boolean(arguments[0]) : !drawer.classList.contains('open');
  drawer.classList.toggle('open', shouldOpen);
  if (backdrop) backdrop.classList.toggle('open', shouldOpen);
  if (shouldOpen) renderLogPanel();
}

function renderLogPanel() {
  const panel = document.getElementById('log-panel');
  const count = document.getElementById('log-count');
  if (count) count.textContent = String(appLogs.length);
  if (!panel) return;
  if (!appLogs.length) {
    panel.innerHTML = '<div class="log-line">No logs yet.</div>';
    return;
  }
  panel.innerHTML = appLogs.slice().reverse().map(x => {
    const lower = String(x).toLowerCase();
    const cls = lower.includes(' error ') ? 'error' : lower.includes(' warn ') ? 'warn' : '';
    return `<div class="log-line ${cls}">${x}</div>`;
  }).join('');
}

function clearLogs() {
  appLogs = [];
  renderLogPanel();
}

async function copyLogs() {
  try {
    const text = appLogs.join('\n');
    await navigator.clipboard.writeText(text || 'No logs');
    toast('Logs copied', 'success');
  } catch {
    toast('Could not copy logs', 'error');
  }
}

function getQuickSmokeTestChecklist() {
  return [
    'Create 1 customer and 1 item, confirm they show in dropdowns',
    'Create one bill and verify auto jump to Print preview',
    'Print dialog opens and filename uses bill/customer pattern',
    'Save one payment and verify ledger balance reduces',
    'Open Monthly Report and confirm Sales/Collection values render'
  ];
}

window.showPage = showPage;
window.addItemRow = addItemRow;
window.onItemSelect = onItemSelect;
window.calcRow = calcRow;
window.removeItemRow = removeItemRow;
window.saveBill = saveBill;
window.resetBillForm = resetBillForm;
window.savePayment = savePayment;
window.loadPrintBill = loadPrintBill;
window.loadLedger = loadLedger;
window.saveCustomer = saveCustomer;
window.saveItem = saveItem;
window.addLrChip = addLrChip;
window.removeLrChip = removeLrChip;
window.refreshMarketRate = refreshMarketRate;
window.shareBillWhatsApp = shareBillWhatsApp;
window.printBillAsPdf = printBillAsPdf;
window.downloadBillImage = downloadBillImage;
window.loadMonthlyReport = loadMonthlyReport;
window.printMonthlyReportPdf = printMonthlyReportPdf;
window.toggleLogPanel = toggleLogPanel;
window.renderLogPanel = renderLogPanel;
window.clearLogs = clearLogs;
window.copyLogs = copyLogs;
window.exportBackupJson = exportBackupJson;
window.exportBackupCsvBundle = exportBackupCsvBundle;
window.validateBackupFile = validateBackupFile;
window.getQuickSmokeTestChecklist = getQuickSmokeTestChecklist;
window.applyDashboardFilters = applyDashboardFilters;
window.loadMoreRecentBills = loadMoreRecentBills;
window.openBillPreviewFromDashboard = openBillPreviewFromDashboard;
window.openLedgerFromDashboard = openLedgerFromDashboard;
window.handleLedgerCustomerChange = handleLedgerCustomerChange;
window.initTransactions = initTransactions;
window.loadTransactions = loadTransactions;
window.editBillRecord = editBillRecord;
window.deleteBillRecord = deleteBillRecord;
window.editPaymentRecord = editPaymentRecord;
window.deletePaymentRecord = deletePaymentRecord;
window.editCustomerRecord = editCustomerRecord;
window.deleteCustomerRecord = deleteCustomerRecord;
window.editItemRecord = editItemRecord;
window.deleteItemRecord = deleteItemRecord;
window.closeAppModal = closeAppModal;
window.closeAppModalFromBackdrop = closeAppModalFromBackdrop;
