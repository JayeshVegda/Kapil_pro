const API_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function apiGet(action) {
  try {
    const res = await fetchWithTimeout(`${API}?action=${encodeURIComponent(action)}`);
    if (!res.ok) {
      if (action === 'getMiscExpenses') {
        miscFeatureAvailable = false;
        return [];
      }
      logEvent(`GET ${action} failed: HTTP ${res.status}`, 'warn');
      return [];
    }
    if (action === 'getMiscExpenses') miscFeatureAvailable = true;
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch (parseErr) {
      if (action === 'getMiscExpenses') {
        miscFeatureAvailable = false;
        return [];
      }
      const bodyHint = String(txt || '').slice(0, 140).replace(/\s+/g, ' ');
      logEvent(`GET ${action} parse failed: ${parseErr?.message || 'invalid json'}${bodyHint ? ` | ${bodyHint}` : ''}`, 'warn');
      return [];
    }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `timeout after ${API_TIMEOUT_MS}ms` : (err?.message || 'fetch error');
    if (action === 'getMiscExpenses') {
      miscFeatureAvailable = false;
      return [];
    }
    logEvent(`GET ${action} failed: ${msg}`, 'warn');
    return [];
  }
}

async function apiPost(data) {
  try {
    const res = await fetchWithTimeout(API, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    const txt = await res.text();
    if (!res.ok) {
      const bodyHint = String(txt || '').slice(0, 140).replace(/\s+/g, ' ');
      return { status: 'error', message: `HTTP ${res.status}${bodyHint ? `: ${bodyHint}` : ''}` };
    }
    try {
      return JSON.parse(txt);
    } catch (parseErr) {
      const raw = String(txt || '').trim();
      const lower = raw.toLowerCase();
      // Backward-compat: some GAS deployments return plain text.
      if (lower === 'ok' || lower === 'success' || lower.includes('success')) {
        return { status: 'success', message: raw || 'success' };
      }
      return {
        status: 'error',
        message: raw || `Invalid JSON response: ${parseErr?.message || 'parse failed'}`
      };
    }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `Request timeout after ${API_TIMEOUT_MS}ms` : (err?.message || 'fetch error');
    return { status: 'error', message: msg };
  }
}

function normalizeSheetRows(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const rows = data.filter(r => Array.isArray(r));
  if (!rows.length) return [];
  const firstRow = rows[0].map(x => String(x ?? '').trim().toLowerCase());
  const headerLike = firstRow.some(x => ['name', 'item name', 'bill no', 'date', 'customer', 'amount'].includes(x));
  const body = headerLike ? rows.slice(1) : rows;
  return body.filter(r => r.some(v => String(v ?? '').trim() !== ''));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => String(x ?? '').trim());
}

function parseCsvText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

async function fetchCsvRows(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return [];
    const txt = await res.text();
    return parseCsvText(txt);
  } catch {
    return [];
  }
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const serialDate = new Date((value - 25569) * 86400 * 1000);
    if (Number.isFinite(serialDate.getTime())) return serialDate.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    const serialDate = new Date((serial - 25569) * 86400 * 1000);
    if (Number.isFinite(serialDate.getTime())) return serialDate.toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function hasDateValue(value) {
  return normalizeDateValue(value) !== '';
}

function makeBillNoFromParts(bookNo, billNo) {
  const b = Number(bookNo || 0);
  const n = Number(billNo || 0);
  if (!b && !n) return '';
  if (!b) return String(n);
  return `${b}-${String(n).padStart(3, '0')}`;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function isCombinedBillNo(value) {
  return /^\d+-\d+$/.test(String(value || '').trim());
}

function mapBillRowNewSchema(r) {
  const billNo = makeBillNoFromParts(r[0], r[1]);
  const date = normalizeDateValue(r[2]);
  const customer = String(r[3] || '').trim();
  const mkt = r[4] || '';
  const itemName = String(r[5] || '').trim();
  const qty = toNumber(r[6]);
  const rate = toNumber(r[7]);
  const amount = toNumber(r[8]);
  const transport = toNumber(r[9]);
  const bags = toNumber(r[10]);
  const gstRate = toNumber(r[11]);
  const gstAmount = toNumber(r[12]);
  const lrNo = r[13] || '';
  if (!billNo || !date || !customer || !itemName) return [];
  const out = [[billNo, date, customer, mkt, itemName, qty, rate, amount, transport, bags, lrNo]];
  if (gstRate > 0 && gstAmount > 0) {
    out.push([billNo, date, customer, mkt, `GST ${gstRate}%`, 0, 0, gstAmount, 0, 0, lrNo]);
  }
  return out;
}

function mapBillRowLegacySchema(r) {
  const billNo = String(r[0] || '').trim();
  const date = normalizeDateValue(r[1]);
  const customer = String(r[2] || '').trim();
  const mkt = r[3] || '';
  const itemName = String(r[4] || '').trim();
  const qty = toNumber(r[5]);
  const rate = toNumber(r[6]);
  const amount = toNumber(r[7]);
  const transport = toNumber(r[8]);
  const bags = toNumber(r[9]);
  const lrNo = r[10] || '';
  if (!billNo || !date || !customer || !itemName) return [];
  return [[billNo, date, customer, mkt, itemName, qty, rate, amount, transport, bags, lrNo]];
}

function mapBillItemsCsvToAppRows(csvRows) {
  const body = normalizeSheetRows(csvRows);
  const out = [];
  body.forEach(r => {
    // New schema: Book No, Bill No, Date, ...
    if (/^\d+$/.test(String(r[0] || '').trim()) && /^\d+$/.test(String(r[1] || '').trim()) && hasDateValue(r[2])) {
      out.push(...mapBillRowNewSchema(r));
      return;
    }
    // Legacy/mixed schema: BillNo(eg 51-027), Date, Customer, ...
    if ((isCombinedBillNo(r[0]) || /^\d+$/.test(String(r[0] || '').trim())) && hasDateValue(r[1])) {
      out.push(...mapBillRowLegacySchema(r));
    }
  });
  return out;
}

function normalizeBillItemsForApp(rows) {
  const body = normalizeSheetRows(rows);
  if (!body.length) return [];
  return mapBillItemsCsvToAppRows(body);
}

function mapPaymentsCsvToAppRows(csvRows) {
  const body = normalizeSheetRows(csvRows);
  return body.map(r => {
    const date = normalizeDateValue(r[0]) || String(r[0] || '').trim();
    const customer = r[1] || '';
    const amount = toNumber(r[2]);
    const hasModeColumn = r.length >= 5;
    const mode = hasModeColumn ? String(r[3] || '').trim() : '';
    const note = hasModeColumn ? String(r[4] || '').trim() : String(r[3] || '').trim();
    const noteWithMode = mode
      ? `[MODE:${mode.toUpperCase()}] ${note}`.trim()
      : note;
    return [date, customer, amount, noteWithMode];
  }).filter(r => r[0] && r[1]);
}

function mapMiscCsvToAppRows(csvRows) {
  return normalizeSheetRows(csvRows).map(r => [r[0] || '', r[1] || '', toNumber(r[2]), r[3] || '', r[4] || '', r[5] || '']);
}

async function loadFromCsvFallback() {
  const [c, i, b, p, m] = await Promise.all([
    fetchCsvRows('./csv/Billing System - Customers.csv'),
    fetchCsvRows('./csv/Billing System - Items.csv'),
    fetchCsvRows('./csv/Billing System - Bill_Items.csv'),
    fetchCsvRows('./csv/Billing System - Payments.csv'),
    fetchCsvRows('./csv/Billing System - Misc_Expenses.csv')
  ]);
  return {
    customers: normalizeSheetRows(c),
    items: normalizeSheetRows(i),
    billItems: normalizeBillItemsForApp(b),
    payments: mapPaymentsCsvToAppRows(p),
    misc: mapMiscCsvToAppRows(m)
  };
}

function buildDerivedIndexes() {
  billRowsByNo = new Map();
  billsByCustomer = new Map();
  paymentsByCustomer = new Map();

  cachedBillItems.forEach(r => {
    const billNo = String(r[0] ?? '');
    if (!billRowsByNo.has(billNo)) billRowsByNo.set(billNo, []);
    billRowsByNo.get(billNo).push(r);

    const customer = String(r[2] ?? '');
    if (!billsByCustomer.has(customer)) billsByCustomer.set(customer, new Set());
    billsByCustomer.get(customer).add(billNo);
  });

  billSummaries = [...billRowsByNo.entries()].map(([billNo, rows]) => {
    const first = rows[0] || [];
    const itemsTotal = rows.reduce((s, x) => s + Number(x[7] || 0), 0);
    const transport = Number(first[8] || 0);
    return {
      billNo,
      date: first[1],
      customer: first[2],
      mkt: first[3],
      itemsTotal,
      transport,
      grand: itemsTotal + transport
    };
  }).sort((a, b) => {
    const da = new Date(a.date);
    const db = new Date(b.date);
    if (da - db !== 0) return da - db;
    return String(a.billNo).localeCompare(String(b.billNo), undefined, { numeric: true });
  });

  cachedPayments.forEach(p => {
    const customer = String(p[1] ?? '');
    if (!paymentsByCustomer.has(customer)) paymentsByCustomer.set(customer, []);
    paymentsByCustomer.get(customer).push(p);
  });
  paymentsByCustomer.forEach((arr, key) => {
    arr.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    paymentsByCustomer.set(key, arr);
  });
}

async function refreshAll() {
  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }
  if (lastFullRefreshAt && (Date.now() - lastFullRefreshAt) < REFRESH_TTL_MS) {
    return;
  }
  refreshInFlight = (async () => {
    const [c, i, b, p, m] = await Promise.all([
      apiGet('getCustomers'),
      apiGet('getItems'),
      apiGet('getBillItems'),
      apiGet('getPayments'),
      apiGet('getMiscExpenses')
    ]);
    let customers = normalizeSheetRows(c);
    let items = normalizeSheetRows(i);
    let billItems = normalizeBillItemsForApp(b);
    let payments = mapPaymentsCsvToAppRows(p);
    let misc = normalizeSheetRows(m);
    const needCsvFallback = !customers.length || !items.length || !billItems.length || !payments.length;
    if (needCsvFallback) {
      const csv = await loadFromCsvFallback();
      if (!customers.length && csv.customers.length) customers = csv.customers;
      if (!items.length && csv.items.length) items = csv.items;
      if (!billItems.length && csv.billItems.length) billItems = csv.billItems;
      if (!payments.length && csv.payments.length) payments = csv.payments;
      if (!misc.length && csv.misc.length) {
        misc = csv.misc;
        // When misc data is available via CSV fallback, treat it as available
        // so reports don't show a false "partial" warning.
        miscFeatureAvailable = true;
      }
      logEvent('Using CSV fallback for missing API data.', 'warn');
    }
    cachedCustomers = customers;
    cachedItems = items;
    cachedBillItems = billItems;
    cachedPayments = payments;
    cachedMiscExpenses = misc;
    if (!cachedBillItems.length) {
      logEvent('No bill items loaded from API or CSV fallback. Check API response, CSV path, and browser file access.', 'warn');
    }
    buildDerivedIndexes();
    lastFullRefreshAt = Date.now();
  })();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function invalidateCacheNow() {
  lastFullRefreshAt = 0;
}
