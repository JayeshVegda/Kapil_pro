const API = 'https://script.google.com/macros/s/AKfycbx0y_3pJg4Z9N3M0qodYm6NAd3upuuuj8RL12CCQApBo_iVXw7j7wR5ua1j2ciEuHYI/exec';

// cache/state
let cachedCustomers = [];
let cachedItems = [];
let cachedBillItems = [];
let cachedPayments = [];
let cachedMiscExpenses = [];
let lrChips = [];
let marketLocalRate = null;
let marketRateDate = '';
let marketRateStatus = '';
let lastPreviewInfo = null;
let appLogs = [];
let lastFullRefreshAt = 0;
let refreshInFlight = null;
const REFRESH_TTL_MS = 20000;
let billRowsByNo = new Map();
let billSummaries = [];
let billsByCustomer = new Map();
let paymentsByCustomer = new Map();
let miscFeatureAvailable = true;
let toastTimer = null;

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  if (toastTimer) clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = 'toast show ' + type;
  const messageLength = String(msg || '').trim().length;
  const duration = Math.min(7000, Math.max(2500, 1800 + (messageLength * 40)));
  toastTimer = setTimeout(() => t.className = 'toast', duration);
}

function logEvent(message, level = 'info') {
  const entry = `[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} ${message}`;
  appLogs.push(entry);
  if (appLogs.length > 100) appLogs.shift();
  if (typeof window.renderLogPanel === 'function') {
    window.renderLogPanel();
  }
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function today() {
  return new Date().toISOString().split('T')[0];
}
