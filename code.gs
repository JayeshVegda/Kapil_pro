/**
 * ============================================================
 *  PARTY SUMMARY — APPS SCRIPT v6
 *  Formula-driven · Dynamic layout · Clean Master
 *  v6: Unified "Company (Customer)" party key — resolves
 *      bill/payment name mismatch when customers have both
 *      a company_name and a personal name field.
 * ============================================================
 *
 *  HOW TO INSTALL:
 *  1. Open your Party Summary Google Sheet
 *  2. Extensions → Apps Script
 *  3. Delete ALL old code (Ctrl+A, Delete)
 *  4. Paste this entire script
 *  5. Save → Refresh sheet → Party Summary → Full Rebuild
 * ============================================================
 */

// ─── SETTINGS ───────────────────────────────────────────────
const POCKETBASE_BASE_URL = 'https://kapil.zayu.dev/pb';
const PB_LOGIN_EMAIL = 'jayeshvegda198@gmail.com';
const PB_LOGIN_PASSWORD = '02889999';
const PB_FETCH_PAGE_SIZE = 60;

// Bill_Items columns (0-indexed)
const B_BOOKNO    = 0;
const B_BILLNO    = 1;
const B_DATE      = 2;
const B_CUSTOMER  = 3;   // ← unified "Company (Customer)" key
const B_MKT       = 4;
const B_ITEM      = 5;
const B_QTY       = 6;
const B_RATE      = 7;
const B_AMOUNT    = 8;
const B_TRANSPORT = 9;
const B_BAGS      = 10;
const B_GSTRATE   = 11;
const B_GSTAMT    = 12;
const B_LRNO      = 13;

// Payments columns (0-indexed)
const P_DATE     = 0;
const P_CUSTOMER = 1;   // ← unified "Company (Customer)" key
const P_AMOUNT   = 2;
const P_MODE     = 3;
const P_NOTE     = 4;

// Customers columns (0-indexed)
const C_NAME    = 0;
const C_OPENING = 1;

// Layout
const DATA_START = 6;

// Party sheet column map (1-indexed for Sheets API)
const COL = {
  DATE:       1,
  BILLREF:    2,
  MKTRATE:    3,
  ITEM:       4,
  QTY:        5,
  RATE:       6,
  AMOUNT:     7,
  TRANSPORT:  8,
  GSTPCT:     9,
  GSTAMT:     10,
  FINAL:      11,
  DIVIDER:    12,
  PDATE:      13,
  PAMOUNT:    14,
  PMODE:      15,
  PNOTE:      16,
};

const CL = {
  DATE:      'A', BILLREF: 'B', MKTRATE: 'C', ITEM: 'D',
  QTY:       'E', RATE:    'F', AMOUNT:  'G', TRANSPORT: 'H',
  GSTPCT:    'I', GSTAMT:  'J', FINAL:   'K',
  DIVIDER:   'L',
  PDATE:     'M', PAMOUNT: 'N', PMODE:   'O', PNOTE: 'P',
};


// ─── MENU ───────────────────────────────────────────────────
function onOpen() {
  const ui = getUiSafe_();
  if (!ui) return;
  ui.createMenu('Party Summary')
    .addItem('▶  Run Sync (new data only)', 'runSync')
    .addItem('🔄  Full Rebuild (reset everything)', 'runFullRebuild')
    .addSeparator()
    .addItem('⏰  Set Daily Auto-Sync at 7 AM', 'installDailyTrigger')
    .addToUi();
}


// ─── FULL REBUILD ───────────────────────────────────────────
function runFullRebuild() {
  const ui = getUiSafe_();
  if (ui) {
    const ans = ui.alert('Full Rebuild',
      'Delete all customer sheets and rebuild from scratch?\nThis may take 30–60 seconds.',
      ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }

  try {
    const summary = SpreadsheetApp.getActiveSpreadsheet();

    const keep = new Set(['Master', 'Sync_State', 'Sync_Log']);
    summary.getSheets().forEach(sh => {
      if (!keep.has(sh.getName())) summary.deleteSheet(sh);
    });

    ensureSystemSheets_(summary);

    const sourceRows = getSourceRows_();
    const billRows   = sourceRows.billRows;
    const payRows    = sourceRows.payRows;
    const custRows   = sourceRows.custRows;
    const openingMap = buildOpeningMap_(custRows);

    buildAllPartySheets_(summary, billRows, payRows, openingMap);
    buildMaster_(summary, openingMap, billRows, payRows);

    saveState_(summary, billRows.length, payRows.length);
    hideSystemSheets_(summary);
    writeLog_(summary, billRows.length, payRows.length, 'FULL REBUILD', '');

    if (ui) {
      ui.alert('Done ✓\n\n' + billRows.length + ' bills · ' + payRows.length + ' payments loaded.');
    }
  } catch (err) {
    const safeUi = getUiSafe_();
    if (safeUi) safeUi.alert('ERROR:\n' + err.message + '\n\n' + err.stack);
    throw err;
  }
}


// ─── INCREMENTAL SYNC ───────────────────────────────────────
function runSync() {
  try {
    const summary = SpreadsheetApp.getActiveSpreadsheet();

    ensureSystemSheets_(summary);

    const sourceRows = getSourceRows_();
    const billRows   = sourceRows.billRows;
    const payRows    = sourceRows.payRows;
    const custRows   = sourceRows.custRows;
    const openingMap = buildOpeningMap_(custRows);
    const state      = readState_(summary);

    const newBills = billRows.slice(state.billCursor);
    const newPays  = payRows.slice(state.payCursor);

    if (!newBills.length && !newPays.length) {
      SpreadsheetApp.getActive().toast('Already up to date.', 'Sync', 4);
      return;
    }

    const changedCustomers = new Set();
    newBills.forEach(r => changedCustomers.add(str_(r[B_CUSTOMER])));
    newPays.forEach(r => changedCustomers.add(str_(r[P_CUSTOMER])));

    if (!changedCustomers.size) {
      SpreadsheetApp.getActive().toast('Already up to date.', 'Sync', 4);
      return;
    }

    buildAllPartySheets_(summary, billRows, payRows, openingMap, changedCustomers);
    buildMaster_(summary, openingMap, billRows, payRows);
    saveState_(summary, billRows.length, payRows.length);
    hideSystemSheets_(summary);

    writeLog_(summary, newBills.length, newPays.length, 'SUCCESS', '');
    SpreadsheetApp.getActive().toast(
      newBills.length + ' new bills · ' + newPays.length + ' new payments synced.',
      'Sync Complete ✓', 5);

  } catch (err) {
    writeLog_(SpreadsheetApp.getActiveSpreadsheet(), 0, 0, 'FAILED', String(err));
    SpreadsheetApp.getActive().toast('Sync FAILED: ' + err.message, 'Error', 10);
    throw err;
  }
}


// ════════════════════════════════════════════════════════════
//  PARTY SHEET BUILDER
// ════════════════════════════════════════════════════════════

function buildAllPartySheets_(summary, allBillRows, allPayRows, openingMap, targetCustomers) {
  const billsBy = groupBy_(allBillRows, r => str_(r[B_CUSTOMER]));
  const paysBy  = groupBy_(allPayRows,  r => str_(r[P_CUSTOMER]));

  const allCustomers = new Set([
    ...openingMap.keys(),
    ...billsBy.keys(),
    ...paysBy.keys()
  ]);

  allCustomers.forEach(c => {
    if (!c) return;
    if (targetCustomers && !targetCustomers.has(c)) return;
    const sh = getOrMakeSheet_(summary, c);
    buildPartySheet_(sh, c,
      billsBy.get(c)  || [],
      paysBy.get(c)   || [],
      openingMap.get(c) || 0,
      summary);
  });
}


// ─── CORE PARTY SHEET WRITER ────────────────────────────────
function buildPartySheet_(sh, customer, billRows, payRows, openingBalance, summary) {
  const lastRow = sh.getLastRow();
  if (lastRow >= DATA_START) {
    sh.getRange(DATA_START, 1, lastRow - DATA_START + 1, 16).clearContent().clearFormat();
  }

  const billGroups = buildBillGroups_(billRows);
  const payments   = buildPaymentList_(payRows, openingBalance);

  const salesRowCount = billGroups.reduce((n, g) => n + g.items.length, 0);
  const payRowCount   = payments.length;
  const totalRows     = Math.max(salesRowCount, payRowCount, 1);

  const salesGrid = buildSalesGrid_(billGroups, totalRows);
  const payGrid   = buildPayGrid_(payments, totalRows);

  const fullGrid = [];
  for (let i = 0; i < totalRows; i++) {
    fullGrid.push([
      ...salesGrid[i],
      '',
      ...payGrid[i]
    ]);
  }

  sh.getRange(DATA_START, 1, totalRows, 16).setValues(fullGrid);

  writeFinalAmountFormulas_(sh, billGroups);
  writePartyFooter_(sh, salesRowCount, payRowCount, payRows.length);
  applyPartyFormatting_(sh, totalRows, billGroups, payRowCount);
}


// ─── BUILD BILL GROUPS ──────────────────────────────────────

function buildBillGroups_(billRows) {
  const map = new Map();
  billRows.forEach(row => {
    const key = str_(row[B_BOOKNO]) + '|' + str_(row[B_BILLNO]) + '|' + str_(row[B_DATE]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });

  const groups = [];
  map.forEach((rows) => {
    const first  = rows[0];
    const bookNo = str_(first[B_BOOKNO]);
    const billNo = str_(first[B_BILLNO]);
    groups.push({
      billRef:  bookNo + '-' + String(billNo).padStart(3, '0'),
      dateObj:  serialToDateObj_(first[B_DATE]),
      dateStr:  str_(first[B_DATE]),
      mkt:      num_(first[B_MKT]),
      items:    rows,
    });
  });

  // ← Sort descending: newest bill first
  groups.sort((a, b) => {
    if (!a.dateStr && !b.dateStr) return 0;
    if (!a.dateStr) return 1;
    if (!b.dateStr) return -1;
    return b.dateStr.localeCompare(a.dateStr);
  });

  return groups;
}

// ─── BUILD SALES GRID ───────────────────────────────────────
function buildSalesGrid_(billGroups, totalRows) {
  const grid = [];

  billGroups.forEach(g => {
    g.items.forEach((row, idx) => {
      const isFirst = idx === 0;
      grid.push([
        isFirst ? (g.dateObj || '') : '',
        isFirst ? g.billRef : '',
        isFirst ? (g.mkt || '') : '',
        str_(row[B_ITEM]),
        num_(row[B_QTY])       || '',
        num_(row[B_RATE])      || '',
        num_(row[B_AMOUNT])    || '',
        isFirst ? (num_(row[B_TRANSPORT]) || '') : '',  // ← transport: first row only
        isFirst ? (num_(row[B_GSTRATE])   || '') : '',  // ← GST%: first row only
        isFirst ? (num_(row[B_GSTAMT])    || '') : '',  // ← GST amt: first row only
        '',
      ]);
    });
  });

  while (grid.length < totalRows) grid.push(['', '', '', '', '', '', '', '', '', '', '']);
  return grid;
}



// ─── WRITE FINAL AMOUNT FORMULAS ────────────────────────────
function writeFinalAmountFormulas_(sh, billGroups) {
  let cursor = DATA_START;
  billGroups.forEach(g => {
    const count   = g.items.length;
    const firstR  = cursor;
    const lastR   = cursor + count - 1;

    let formula;
    if (count === 1) {
      formula = `=${CL.AMOUNT}${firstR}+${CL.TRANSPORT}${firstR}+${CL.GSTAMT}${firstR}`;
    } else {
      formula = `=SUM(${CL.AMOUNT}${firstR}:${CL.AMOUNT}${lastR})`
              + `+SUM(${CL.TRANSPORT}${firstR}:${CL.TRANSPORT}${lastR})`
              + `+SUM(${CL.GSTAMT}${firstR}:${CL.GSTAMT}${lastR})`;
    }

    sh.getRange(lastR, COL.FINAL).setFormula(formula);
    cursor += count;
  });
}


// ─── BUILD PAYMENT GRID ─────────────────────────────────────
function buildPaymentList_(payRows, openingBalance) {
  // Sort descending: newest payment first
  const sorted = [...payRows].sort((a, b) => {
    const da = str_(a[P_DATE]);
    const db = str_(b[P_DATE]);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });

  const list = [{ date: 'Opening Bal', amount: openingBalance, mode: '', note: '', isOpening: true }];
  sorted.forEach(row => {
    list.push({
      date:      serialToDateObj_(row[P_DATE]) || '',
      amount:    num_(row[P_AMOUNT]),
      mode:      str_(row[P_MODE]) || 'Cash',
      note:      str_(row[P_NOTE]),
      isOpening: false
    });
  });
  return list;
}

function buildPayGrid_(payments, totalRows) {
  const grid = payments.map(p => [p.date, p.amount, p.mode, p.note]);
  while (grid.length < totalRows) grid.push(['', '', '', '']);
  return grid;
}


// ─── PARTY FOOTER (TOTALS + OUTSTANDING) ────────────────────
function writePartyFooter_(sh, salesRowCount, payRowCount, rawPayCount) {
  const ds        = DATA_START;
  const salesEnd  = ds + salesRowCount - 1;
  const payEnd    = ds + payRowCount   - 1;
  const totalRows = Math.max(salesRowCount, payRowCount, 1);
  const gapRow    = ds + totalRows;
  const totalsRow = gapRow + 1;
  const outRow    = totalsRow + 2;

  sh.getRange(gapRow, 1, 30, 16).clearContent().clearFormat();
  sh.getRange(gapRow, COL.DIVIDER, 30, 1).setBackground('#FFFFFF');

  const kRange = `${CL.FINAL}${ds}:${CL.FINAL}${salesEnd}`;
  const eRange = `${CL.QTY}${ds}:${CL.QTY}${salesEnd}`;
  const gRange = `${CL.AMOUNT}${ds}:${CL.AMOUNT}${salesEnd}`;
  const hRange = `${CL.TRANSPORT}${ds}:${CL.TRANSPORT}${salesEnd}`;

  sh.getRange(totalsRow, COL.DATE).setValue('Total Sale');
  sh.getRange(totalsRow, COL.BILLREF).setFormula(`=IFERROR(COUNTIF(${kRange},">0"),0)`);
  sh.getRange(totalsRow, COL.QTY).setFormula(`=IFERROR(SUM(${eRange}),0)`);
  sh.getRange(totalsRow, COL.AMOUNT).setFormula(`=IFERROR(SUM(${gRange}),0)`);
  sh.getRange(totalsRow, COL.TRANSPORT).setFormula(`=IFERROR(SUM(${hRange}),0)`);
  sh.getRange(totalsRow, COL.FINAL).setFormula(`=IFERROR(SUM(${kRange}),0)`);

  sh.getRange(totalsRow, COL.DATE, 1, 11)
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setFontWeight('bold').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(totalsRow, COL.DATE).setHorizontalAlignment('left');
  sh.getRange(totalsRow, COL.BILLREF, 1, 10).setHorizontalAlignment('right');
  sh.getRange(totalsRow, COL.BILLREF).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.QTY).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.AMOUNT).setNumberFormat('₹#,##0');
  sh.getRange(totalsRow, COL.TRANSPORT).setNumberFormat('₹#,##0');
  sh.getRange(totalsRow, COL.FINAL).setNumberFormat('₹#,##0').setFontStyle('italic');

  const obCell     = CL.PAMOUNT + ds;
  const payDataEnd = ds + payRowCount - 1;

  sh.getRange(totalsRow, COL.PDATE).setValue('Total Payment');
  if (rawPayCount > 0) {
    sh.getRange(totalsRow, COL.PAMOUNT)
      .setFormula(`=IFERROR(SUM(${CL.PAMOUNT}${ds + 1}:${CL.PAMOUNT}${payDataEnd}),0)`);
  } else {
    sh.getRange(totalsRow, COL.PAMOUNT).setValue(0);
  }

  sh.getRange(totalsRow, COL.PDATE, 1, 4)
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setFontWeight('bold').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(totalsRow, COL.PDATE).setHorizontalAlignment('left');
  sh.getRange(totalsRow, COL.PAMOUNT)
    .setHorizontalAlignment('right').setNumberFormat('₹#,##0');

  sh.getRange(totalsRow, COL.DIVIDER).setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
  sh.setRowHeight(totalsRow, 28);

  const salKCell   = CL.FINAL + totalsRow;
  const payNCell   = CL.PAMOUNT + totalsRow;
  const outFormula = `=${obCell}+${salKCell}-${payNCell}`;

  sh.getRange(outRow, COL.DATE, 1, 11).merge()
    .setValue('Total Outstanding Balance')
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);

  const outValRange = sh.getRange(outRow, COL.PDATE, 1, 4);
  outValRange.merge()
    .setFormula(outFormula)
    .setFontWeight('bold').setFontSize(18)
    .setHorizontalAlignment('right')
    .setNumberFormat('₹#,##0.00')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);

  applyOutstandingConditionalFormat_(sh, outRow);

  sh.setRowHeight(outRow, 40);
  sh.getRange(outRow, COL.DIVIDER).setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ─── OUTSTANDING CONDITIONAL FORMAT ─────────────────────────
function applyOutstandingConditionalFormat_(sh, outRow) {
  const range = sh.getRange(outRow, COL.PDATE, 1, 4);

  const existing = sh.getConditionalFormatRules();
  const a1 = range.getA1Notation();
  const filtered = existing.filter(rule => {
    return !rule.getRanges().some(r => r.getA1Notation() === a1);
  });

  const rulePositive = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setBackground('#FDECEA').setFontColor('#B71C1C')
    .setRanges([range]).build();

  const ruleClear = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThanOrEqualTo(0)
    .setBackground('#E8F5E9').setFontColor('#1B5E20')
    .setRanges([range]).build();

  filtered.push(rulePositive, ruleClear);
  sh.setConditionalFormatRules(filtered);
}


// ─── PARTY SHEET FORMATTING ─────────────────────────────────
function applyPartyFormatting_(sh, totalRows, billGroups, payRowCount) {
  const ds = DATA_START;
  if (totalRows < 1) return;

  sh.setRowHeights(ds, totalRows, 25);

  sh.getRange(ds, COL.DATE, totalRows, 1).setNumberFormat('dd-MMM-yyyy');
  sh.getRange(ds, COL.QTY, totalRows, 1).setNumberFormat('#,##0');
  sh.getRange(ds, COL.RATE, totalRows, 1).setNumberFormat('₹#,##0');
  sh.getRange(ds, COL.AMOUNT, totalRows, 1).setNumberFormat('₹#,##0');
  sh.getRange(ds, COL.TRANSPORT, totalRows, 1).setNumberFormat('₹#,##0');
  sh.getRange(ds, COL.GSTAMT, totalRows, 1).setNumberFormat('₹#,##0');
  sh.getRange(ds, COL.FINAL, totalRows, 1).setNumberFormat('₹#,##0').setFontWeight('bold').setFontStyle('italic');

  if (payRowCount > 1) {
    sh.getRange(ds + 1, COL.PDATE, payRowCount - 1, 1).setNumberFormat('dd-MMM-yyyy');
  }
  sh.getRange(ds, COL.PAMOUNT, payRowCount, 1).setNumberFormat('₹#,##0');

  sh.getRange(ds, COL.DATE,    totalRows, 3).setHorizontalAlignment('center');
  sh.getRange(ds, COL.ITEM,    totalRows, 1).setHorizontalAlignment('left');
  sh.getRange(ds, COL.QTY,     totalRows, 7).setHorizontalAlignment('right');
  sh.getRange(ds, COL.DATE,    totalRows, 11).setVerticalAlignment('middle');

  sh.getRange(ds, COL.PDATE,   payRowCount, 1).setHorizontalAlignment('center');
  sh.getRange(ds, COL.PAMOUNT, payRowCount, 1).setHorizontalAlignment('right');
  sh.getRange(ds, COL.PMODE,   payRowCount, 1).setHorizontalAlignment('center');
  sh.getRange(ds, COL.PNOTE,   payRowCount, 1).setHorizontalAlignment('left');
  sh.getRange(ds, COL.PDATE,   payRowCount, 4).setVerticalAlignment('middle');

  const zebraSales = [];
  const zebraPays  = [];
  for (let i = 0; i < totalRows; i++) {
    const bg = (i % 2 === 0) ? '#FFFFFF' : '#F7F9FB';
    zebraSales.push(new Array(11).fill(bg));
    zebraPays.push(new Array(4).fill(bg));
  }
  sh.getRange(ds, COL.DATE,  totalRows, 11).setBackgrounds(zebraSales);
  sh.getRange(ds, COL.PDATE, totalRows, 4).setBackgrounds(zebraPays);

  sh.getRange(ds, COL.DATE,  totalRows, 11)
    .setBorder(true, true, true, true, true, true,
      '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(ds, COL.PDATE, payRowCount, 4)
    .setBorder(true, true, true, true, true, true,
      '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);

  let cursor = ds;
  billGroups.forEach(g => {
    const lastRow = cursor + g.items.length - 1;
    sh.getRange(lastRow, COL.DATE, 1, 11)
      .setBorder(null, null, true, null, false, false,
        '#1E3557', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    cursor += g.items.length;
  });

  sh.getRange(ds, COL.PDATE).setFontWeight('bold');
  sh.getRange(ds, COL.PAMOUNT).setFontWeight('bold');

  const clearRows = totalRows + 30;
  sh.getRange(1, COL.DIVIDER, clearRows, 1)
    .setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ─── SHEET HEADER ───────────────────────────────────────────
function makeSheetHeader_(sh, customerName) {
  sh.getRange('A1:P5').clearContent().clearFormat().breakApart();
  sh.getRange('A1:P5').setFontFamily('Arial');

  sh.setRowHeight(1, 8);

  sh.getRange('A2:O2').merge()
    .setValue(customerName + ' — Party Ledger')
    .setFontSize(16).setFontWeight('bold')
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(2, 44);

  const master = sh.getParent().getSheetByName('Master');
  if (master) {
    sh.getRange('P2')
      .setFormula(`=HYPERLINK("#gid=${master.getSheetId()}","◀ Master")`)
      .setHorizontalAlignment('right')
      .setBackground('#1E3557').setFontColor('#9FC3E6')
      .setFontSize(9).setVerticalAlignment('middle');
  }

  sh.getRange('A2:P2')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);

  sh.setRowHeight(3, 10);

  sh.getRange('A4:K4').merge()
    .setValue('SALES')
    .setFontWeight('bold').setFontSize(10)
    .setBackground('#EAF1F8').setFontColor('#1F3552')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(4, 22);
  sh.getRange('L4').setBackground('#FFFFFF');

  sh.getRange('M4:P4').merge()
    .setValue('PAYMENTS')
    .setFontWeight('bold').setFontSize(10)
    .setBackground('#EAF4EE').setFontColor('#1F4533')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  sh.getRange('A5:P5').setValues([[
    'Date', 'Bill No', 'Market Rate', 'Item', 'Qty (kg)', 'Rate',
    'Amount', 'Transport', 'GST%', 'GST Amt', 'Final Amount',
    '',
    'Date', 'Amount', 'Mode', 'Note'
  ]])
    .setFontWeight('bold')
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  sh.getRange('L5').clearContent().setBackground('#FFFFFF').clearFormat();
  sh.setRowHeight(5, 28);

  sh.getRange('A5:K5')
    .setBorder(true, true, true, true, true, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange('M5:P5')
    .setBackground('#1E4A33')
    .setBorder(true, true, true, true, true, false,
      '#1E4A33', SpreadsheetApp.BorderStyle.SOLID);

  sh.setColumnWidth(1,  100);
  sh.setColumnWidth(2,  90);
  sh.setColumnWidth(3,  88);
  sh.setColumnWidth(4,  180);
  sh.setColumnWidth(5,  80);
  sh.setColumnWidth(6,  76);
  sh.setColumnWidth(7,  108);
  sh.setColumnWidth(8,  94);
  sh.setColumnWidth(9,  60);
  sh.setColumnWidth(10, 86);
  sh.setColumnWidth(11, 122);
  sh.setColumnWidth(12, 10);
  sh.setColumnWidth(13, 100);
  sh.setColumnWidth(14, 115);
  sh.setColumnWidth(15, 82);
  sh.setColumnWidth(16, 210);

  sh.setFrozenRows(5);

  sh.getRange('L1:L300').setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ════════════════════════════════════════════════════════════
//  MASTER SHEET
// ════════════════════════════════════════════════════════════

function buildMaster_(summary, openingMap, billRows, payRows) {
  const sh = ensureMasterSheet_(summary);

  const sales    = {};
  const paid     = {};
  const billCnt  = {};
  const lastBill = {};
  const lastPay  = {};

  billRows.forEach(row => {
    const c = str_(row[B_CUSTOMER]);
    if (!c) return;
    sales[c]   = (sales[c]   || 0) + num_(row[B_AMOUNT]) + num_(row[B_TRANSPORT]) + num_(row[B_GSTAMT]);
    if (!lastBill[c + '|keys']) lastBill[c + '|keys'] = new Set();
    const key = str_(row[B_BOOKNO]) + '|' + str_(row[B_BILLNO]);
    lastBill[c + '|keys'].add(key);
    billCnt[c] = lastBill[c + '|keys'].size;
    const d = str_(row[B_DATE]);
    if (!lastBill[c] || d > lastBill[c]) lastBill[c] = d;
  });

  payRows.forEach(row => {
    const c = str_(row[P_CUSTOMER]);
    if (!c) return;
    paid[c] = (paid[c] || 0) + num_(row[P_AMOUNT]);
    const d = str_(row[P_DATE]);
    if (!lastPay[c] || d > lastPay[c]) lastPay[c] = d;
  });

  const all = new Set([...openingMap.keys(), ...Object.keys(sales), ...Object.keys(paid)]);
  const rows = [];

  all.forEach(c => {
    const opening     = num_(openingMap.get(c) || 0);
    const totalSales  = num_(sales[c]  || 0);
    const totalPaid   = num_(paid[c]   || 0);
    const outstanding = opening + totalSales - totalPaid;
    const bills       = billCnt[c] || 0;

    let daysSince = '';
    if (lastBill[c]) {
      const ms = new Date() - serialToDateObj_(lastBill[c]);
      if (!isNaN(ms)) daysSince = Math.floor(ms / 86400000);
    }

    let status = 'Clear';
    if (outstanding > 0) {
      status = (typeof daysSince === 'number' && daysSince > 30) ? 'Overdue' : 'Pending';
    }

    const partySheet = summary.getSheetByName(safeName_(c));
    const nameCell   = partySheet
      ? `=HYPERLINK("#gid=${partySheet.getSheetId()}","${String(c).replace(/"/g, '""')}")`
      : c;

    rows.push([
      nameCell,
      opening,
      bills,
      totalSales,
      totalPaid,
      outstanding,
      lastBill[c] ? serialToDateObj_(lastBill[c]) : '',
      lastPay[c]  ? serialToDateObj_(lastPay[c])  : '',
      typeof daysSince === 'number' ? daysSince : '',
      status
    ]);
  });

  rows.sort((a, b) => {
    const na = String(a[0]).replace(/.*"([^"]+)"\)$/, '$1');
    const nb = String(b[0]).replace(/.*"([^"]+)"\)$/, '$1');
    return na.localeCompare(nb);
  });

  const lastRow = sh.getLastRow();
  if (lastRow >= 4) sh.getRange(4, 1, lastRow - 3, 10).clearContent().clearFormat();

  if (rows.length > 0) sh.getRange(4, 1, rows.length, 10).setValues(rows);

  formatMaster_(sh, rows.length);
}


// ─── MASTER: ENSURE + FORMAT ────────────────────────────────
function ensureMasterSheet_(summary) {
  let sh = summary.getSheetByName('Master');
  if (!sh) sh = summary.insertSheet('Master');

  sh.getRange('A1:J3').breakApart().clearContent().clearFormat();

  sh.getRange('A1:J1').merge()
    .setValue('PARTY SUMMARY')
    .setFontSize(15).setFontWeight('bold')
    .setBackground('#1F3A5F').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  sh.getRange('A2:J2').merge()
    .setFormula('="Last updated: "&TEXT(NOW(),"dd-mmm-yyyy hh:mm AM/PM")')
    .setFontSize(9).setFontColor('#888888')
    .setBackground('#F7F9FB')
    .setHorizontalAlignment('right').setVerticalAlignment('middle');
  sh.setRowHeight(2, 20);

  sh.getRange('A3:J3').setValues([[
    'Customer', 'Opening Bal', 'Bills', 'Total Sales',
    'Total Paid', 'Outstanding', 'Last Bill', 'Last Payment',
    'Days Since', 'Status'
  ]])
    .setFontWeight('bold').setFontSize(10)
    .setBackground('#1F3A5F').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(3, 30);

  return sh;
}

function formatMaster_(sh, dataRowCount) {
  sh.setFrozenRows(3);

  sh.setColumnWidth(1,  200);
  sh.setColumnWidth(2,  110);
  sh.setColumnWidth(3,  70);
  sh.setColumnWidth(4,  120);
  sh.setColumnWidth(5,  110);
  sh.setColumnWidth(6,  130);
  sh.setColumnWidth(7,  110);
  sh.setColumnWidth(8,  110);
  sh.setColumnWidth(9,  88);
  sh.setColumnWidth(10, 90);

  if (dataRowCount < 1) return;

  const dr = dataRowCount;
  const r4 = 4;

  sh.getRange(r4, 2, dr, 1).setNumberFormat('₹#,##0');
  sh.getRange(r4, 3, dr, 1).setNumberFormat('#,##0');
  sh.getRange(r4, 4, dr, 3).setNumberFormat('₹#,##0');
  sh.getRange(r4, 7, dr, 2).setNumberFormat('dd-MMM-yyyy');
  sh.getRange(r4, 9, dr, 1).setNumberFormat('0');

  sh.getRange(r4, 1, dr, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sh.getRange(r4, 2, dr, 8).setHorizontalAlignment('right');
  sh.getRange(r4, 7, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 9, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 1, dr, 10).setVerticalAlignment('middle');

  sh.setRowHeights(r4, dr, 26);
  const zebraMaster = [];
  for (let i = 0; i < dr; i++) {
    zebraMaster.push(new Array(10).fill(i % 2 === 0 ? '#FFFFFF' : '#F4F6F9'));
  }
  sh.getRange(r4, 1, dr, 10).setBackgrounds(zebraMaster);

  applyMasterConditionalFormats_(sh, r4, dr);

  const footerRow = r4 + dr + 1;
  sh.getRange(footerRow, 1).setValue('TOTAL');
  sh.getRange(footerRow, 2).setFormula(`=IFERROR(SUM(B${r4}:B${r4+dr-1}),0)`);
  sh.getRange(footerRow, 3).setFormula(`=IFERROR(SUM(C${r4}:C${r4+dr-1}),0)`);
  sh.getRange(footerRow, 4).setFormula(`=IFERROR(SUM(D${r4}:D${r4+dr-1}),0)`);
  sh.getRange(footerRow, 5).setFormula(`=IFERROR(SUM(E${r4}:E${r4+dr-1}),0)`);
  sh.getRange(footerRow, 6).setFormula(`=IFERROR(SUM(F${r4}:F${r4+dr-1}),0)`);
  sh.getRange(footerRow, 1, 1, 10)
    .setBackground('#1F3A5F').setFontColor('#FFFFFF')
    .setFontWeight('bold').setHorizontalAlignment('right')
    .setNumberFormat('#,##0')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(footerRow, 2, 1, 1).setNumberFormat('₹#,##0');
  sh.getRange(footerRow, 4, 1, 3).setNumberFormat('₹#,##0');
  sh.getRange(footerRow, 1).setHorizontalAlignment('left');
  sh.setRowHeight(footerRow, 28);

  sh.getRange(3, 1, dr + 2, 10)
    .setBorder(true, true, true, true, false, false,
      '#C5D0DE', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

function applyMasterConditionalFormats_(sh, startRow, rowCount) {
  const statusRange      = sh.getRange(startRow, 10, rowCount, 1);
  const outstandingRange = sh.getRange(startRow, 6,  rowCount, 1);
  const daysRange        = sh.getRange(startRow, 9,  rowCount, 1);

  const toRemove = new Set([
    statusRange.getA1Notation(),
    outstandingRange.getA1Notation(),
    daysRange.getA1Notation(),
  ]);

  const existing = sh.getConditionalFormatRules().filter(rule => {
    return !rule.getRanges().some(r => toRemove.has(r.getA1Notation()));
  });

  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Clear').setBackground('#E8F5E9').setFontColor('#2E7D32').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Pending').setBackground('#FFF8E1').setFontColor('#F57F17').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Overdue').setBackground('#FDECEA').setFontColor('#B71C1C').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#B71C1C').setRanges([outstandingRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThanOrEqualTo(0).setFontColor('#2E7D32').setRanges([outstandingRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(15).setBackground('#E8F5E9').setFontColor('#2E7D32').setRanges([daysRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(15, 30).setBackground('#FFF8E1').setFontColor('#F57F17').setRanges([daysRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(30).setBackground('#FDECEA').setFontColor('#B71C1C').setRanges([daysRange]).build(),
  ];

  sh.setConditionalFormatRules(existing.concat(rules));
}


// ════════════════════════════════════════════════════════════
//  SYSTEM SHEETS
// ════════════════════════════════════════════════════════════

function ensureSystemSheets_(summary) {
  ensureMasterSheet_(summary);
  ensureStateSheet_(summary);
  ensureLogSheet_(summary);
}

function ensureStateSheet_(summary) {
  let sh = summary.getSheetByName('Sync_State');
  if (!sh) {
    sh = summary.insertSheet('Sync_State');
    sh.appendRow(['Key', 'Value', 'Updated At']);
    sh.appendRow(['bill_cursor', 0, now_()]);
    sh.appendRow(['pay_cursor',  0, now_()]);
    sh.appendRow(['last_sync',  '', now_()]);
  }
  sh.setTabColor('#9e9e9e');
}

function ensureLogSheet_(summary) {
  let sh = summary.getSheetByName('Sync_Log');
  if (!sh) {
    sh = summary.insertSheet('Sync_Log');
    sh.appendRow(['Time', 'Bills', 'Payments', 'Status', 'Message']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  sh.setTabColor('#9e9e9e');
}

function readState_(summary) {
  const sh  = summary.getSheetByName('Sync_State');
  if (!sh) return { billCursor: 0, payCursor: 0 };
  const map = {};
  sh.getDataRange().getValues().slice(1).forEach(r => { map[str_(r[0])] = r[1]; });
  return { billCursor: num_(map['bill_cursor']), payCursor: num_(map['pay_cursor']) };
}

function saveState_(summary, billCount, payCount) {
  const sh   = summary.getSheetByName('Sync_State');
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  const idx  = {};
  for (let i = 1; i < data.length; i++) idx[str_(data[i][0])] = i + 1;
  const set = (key, val) => {
    if (idx[key]) sh.getRange(idx[key], 2, 1, 2).setValues([[val, now_()]]);
    else sh.appendRow([key, val, now_()]);
  };
  set('bill_cursor', billCount);
  set('pay_cursor',  payCount);
  set('last_sync',   now_());
}

function writeLog_(summary, bills, pays, status, msg) {
  const sh = summary.getSheetByName('Sync_Log');
  if (sh) sh.appendRow([now_(), bills, pays, status, msg || '']);
}

function hideSystemSheets_(summary) {
  ['Sync_State', 'Sync_Log'].forEach(name => {
    const sh = summary.getSheetByName(name);
    if (sh) sh.hideSheet();
  });
}

function getUiSafe_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}


// ─── TRIGGER ────────────────────────────────────────────────
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runSync')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runSync').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getActive().toast('Auto-sync set for 7 AM daily.', 'Done', 4);
}


// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function getOrMakeSheet_(summary, customerName) {
  const safe = safeName_(customerName);
  let sh = summary.getSheetByName(safe);
  if (!sh) sh = summary.insertSheet(safe);
  makeSheetHeader_(sh, customerName);
  return sh;
}

/**
 * ─── UNIFIED PARTY KEY ──────────────────────────────────────────────────────
 *
 * Bills are created against a COMPANY.  Payments are recorded against a
 * CUSTOMER (person).  Both live on the same PocketBase `customers` record,
 * which has two separate fields:
 *
 *   customers.company_name  — the trading company  (e.g. "ABC Traders")
 *   customers.name          — the contact person    (e.g. "Ramesh Patel")
 *
 * Problem: bills store company_name in `bills.customer_name`, while payments
 * store the personal name.  code.gs groups sheets by that stored string, so
 * the same party ends up on two separate sheets.
 *
 * Fix: we build ONE canonical key per customer ID from the customers table:
 *
 *   "Company Name (Customer Name)"     when both fields are present
 *   "Company Name"                     when company_name only
 *   "Customer Name"                    when name only
 *
 * Every bill row and every payment row is re-keyed to this canonical string
 * via a lookup map (customerId → partyKey).  The sheet name, Master row, and
 * openingMap all use this same key — so bills and payments always land on the
 * same sheet regardless of which name was originally stored.
 */
function buildPartyKeyMap_(customers) {
  // customers: array of PB customer objects with id, name, company_name
  const map = new Map();  // customerId → display key
  customers.forEach(c => {
    const company  = str_(c.company_name);
    const personal = str_(c.name);
    let key;
    if (company && personal && company !== personal) {
      key = company + ' (' + personal + ')';
    } else if (company) {
      key = company;
    } else {
      key = personal || ('Customer-' + str_(c.id).slice(0, 6));
    }
    map.set(str_(c.id), key);
  });
  return map;  // Map<customerId, partyKey>
}

/**
 * Re-keys a bill/payment row's customer field (index customerIdx) to the
 * canonical party key.  Falls back to the stored name if the ID isn't found
 * (handles historical records where no customer record exists).
 */
function resolvePartyKey_(row, customerIdx, idIdx, partyKeyMap) {
  const id  = str_(row[idIdx]);
  if (id && partyKeyMap.has(id)) return partyKeyMap.get(id);
  // Fallback: use whatever name was stored (prevents data loss on orphan rows)
  return str_(row[customerIdx]) || '(Unknown)';
}


// ─── SOURCE DATA LOADER ──────────────────────────────────────
function getSourceRows_() {
  return fetchPocketBaseRows_();
}

/**
 * Fetches all data from PocketBase and maps into the legacy row arrays that
 * the rest of the script uses — with ONE critical change in v6:
 *
 * The B_CUSTOMER / P_CUSTOMER slot (index 3 / index 1) is now filled with
 * the CANONICAL PARTY KEY ("Company (Customer)") rather than whatever raw
 * name was stored on the bill or payment record.  This guarantees that bills
 * and payments for the same customer always share one sheet.
 *
 * Additional fields fetched (vs v5):
 *   customers: +company_name
 *   bills:     +customer (ID field, for key resolution)
 *   payments:  +customer (ID field, for key resolution)
 */
function fetchPocketBaseRows_() {
  pbConnectionCheck_();

  // ── 1. Fetch raw PocketBase records ──────────────────────
  const customers = pbGetAll_('customers', {
    sort: 'name',
    fields: 'id,name,company_name,opening_balance',  // ← company_name added
  });

  const bills = pbGetAll_('bills', {
    sort: 'date,bill_no',
    fields: 'id,book_no,bill_no,date,customer,customer_name,mkt,transport,gst_rate,gst_amount,lr_no',
    // ↑ customer (ID) added alongside customer_name
  });

  const billItems = pbGetAll_('bill_items', {
    sort: 'id',
    fields: 'id,bill,item_name,qty,rate,bags',
  });

  const payments = pbGetAll_('payments', {
    sort: 'date',
    fields: 'id,date,customer,customer_name,amount,mode,note',
    // ↑ customer (ID) added alongside customer_name
  });

  // ── 2. Build canonical party key map from customer records ─
  //    Map<customerId, "Company (Customer)">
  const partyKeyMap = buildPartyKeyMap_(customers);

  // ── 3. Index bills by id for bill_items join ─────────────
  const billById = {};
  bills.forEach(b => { billById[str_(b.id)] = b; });

  // ── 4. Build bill rows — B_CUSTOMER = canonical party key ─
  const billRows = [];
  billItems.forEach(item => {
    const bill = billById[str_(item.bill)];
    if (!bill) return;

    // Resolve party key: prefer customer ID lookup, fall back to stored name
    const customerId   = str_(bill.customer);
    const storedName   = str_(bill.customer_name);
    const partyKey = (customerId && partyKeyMap.has(customerId))
      ? partyKeyMap.get(customerId)
      : storedName || '(Unknown)';

    billRows.push([
      num_(bill.book_no),              // 0  B_BOOKNO
      num_(bill.bill_no),              // 1  B_BILLNO
      str_(bill.date).slice(0, 10),    // 2  B_DATE
      partyKey,                        // 3  B_CUSTOMER  ← canonical key
      num_(bill.mkt),                  // 4  B_MKT
      str_(item.item_name),            // 5  B_ITEM
      num_(item.qty),                  // 6  B_QTY
      num_(item.rate),                 // 7  B_RATE
      num_(item.qty) * num_(item.rate),// 8  B_AMOUNT
      num_(bill.transport),            // 9  B_TRANSPORT
      num_(item.bags),                 // 10 B_BAGS
      num_(bill.gst_rate),             // 11 B_GSTRATE
      num_(bill.gst_amount),           // 12 B_GSTAMT
      str_(bill.lr_no),                // 13 B_LRNO
    ]);
  });

  // ── 5. Build payment rows — P_CUSTOMER = canonical party key ─
  const payRows = payments.map(p => {
    const customerId = str_(p.customer);
    const storedName = str_(p.customer_name);
    const partyKey = (customerId && partyKeyMap.has(customerId))
      ? partyKeyMap.get(customerId)
      : storedName || '(Unknown)';

    return [
      str_(p.date).slice(0, 10),  // 0  P_DATE
      partyKey,                   // 1  P_CUSTOMER  ← canonical key
      num_(p.amount),             // 2  P_AMOUNT
      str_(p.mode),               // 3  P_MODE
      str_(p.note),               // 4  P_NOTE
    ];
  });

  // ── 6. Build customer rows — keyed by canonical party key ─
  //    Opening balance map also uses the canonical key so it matches.
  const custRows = customers.map(c => {
    const company  = str_(c.company_name);
    const personal = str_(c.name);
    let key;
    if (company && personal && company !== personal) {
      key = company + ' (' + personal + ')';
    } else if (company) {
      key = company;
    } else {
      key = personal || ('Customer-' + str_(c.id).slice(0, 6));
    }
    return [
      key,                       // 0  C_NAME  (canonical party key)
      num_(c.opening_balance),   // 1  C_OPENING
    ];
  });

  return { billRows, payRows, custRows };
}


// ─── POCKETBASE HELPERS ─────────────────────────────────────
function pbGetAll_(collection, opts) {
  const authToken = pbAuthToken_();
  const out = [];
  let page = 1;
  const perPage = PB_FETCH_PAGE_SIZE;
  const sort   = opts && opts.sort   ? String(opts.sort)   : '';
  const fields = opts && opts.fields ? String(opts.fields) : '';
  while (true) {
    const params = [
      `perPage=${perPage}`,
      `page=${page}`,
      sort   ? `sort=${encodeURIComponent(sort)}`     : '',
      fields ? `fields=${encodeURIComponent(fields)}` : '',
      'skipTotal=1',
    ].filter(Boolean).join('&');
    const url = `${POCKETBASE_BASE_URL}/api/collections/${encodeURIComponent(collection)}/records?${params}`;
    let resp = fetchWithRetry_(url, 6, authToken);
    let code = resp.getResponseCode();
    if (code === 401 || code === 403) {
      pbClearAuthCache_();
      resp = fetchWithRetry_(url, 6, pbAuthToken_());
      code = resp.getResponseCode();
    }
    const body = resp.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`PocketBase fetch failed (${collection}) HTTP ${code}: ${body}`);
    }
    const json  = JSON.parse(body);
    const items = json.items || [];
    out.push.apply(out, items);
    if (items.length < perPage) break;
    page += 1;
  }
  return out;
}

function fetchWithRetry_(url, maxAttempts, authToken) {
  let attempt = 1;
  while (true) {
    const headers = { Accept: 'application/json', 'Accept-Encoding': 'gzip' };
    if (authToken) headers.Authorization = 'Bearer ' + authToken;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers });
    const code = resp.getResponseCode();
    if (code < 400) return resp;
    if (attempt >= maxAttempts) return resp;
    Utilities.sleep(1200 * attempt);
    attempt += 1;
  }
}

function pbAuthToken_() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('PB_AUTH_TOKEN');
  if (cached) return cached;

  const scriptProps = PropertiesService.getScriptProperties();
  const email    = str_(scriptProps.getProperty('PB_LOGIN_EMAIL')    || PB_LOGIN_EMAIL);
  const password = str_(scriptProps.getProperty('PB_LOGIN_PASSWORD') || PB_LOGIN_PASSWORD);
  if (!email || !password) {
    throw new Error('Missing PocketBase login credentials.');
  }

  const url  = `${POCKETBASE_BASE_URL}/api/collections/users/auth-with-password`;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ identity: email, password }),
    headers: { Accept: 'application/json' },
  });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code < 200 || code >= 300) throw new Error(`PocketBase auth failed HTTP ${code}: ${body}`);
  const json  = JSON.parse(body || '{}');
  const token = str_(json.token);
  if (!token) throw new Error('PocketBase auth succeeded but no token returned.');
  cache.put('PB_AUTH_TOKEN', token, 60 * 40);
  return token;
}

function pbClearAuthCache_() {
  CacheService.getScriptCache().remove('PB_AUTH_TOKEN');
}

function pbConnectionCheck_() {
  const token = pbAuthToken_();
  const url   = `${POCKETBASE_BASE_URL}/api/health`;
  const resp  = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`PocketBase health check failed HTTP ${code}: ${resp.getContentText()}`);
  }
}

function buildOpeningMap_(custRows) {
  const map = new Map();
  custRows.forEach(r => {
    const name = str_(r[C_NAME]);
    if (name) map.set(name, num_(r[C_OPENING]));
  });
  return map;
}

function groupBy_(arr, keyFn) {
  const map = new Map();
  arr.forEach(item => {
    const k = keyFn(item);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
}

function serialToDateObj_(v) {
  if (v === null || v === undefined || v === '') return null;
  let d;
  if (v instanceof Date) {
    d = v;
  } else if (typeof v === 'number') {
    d = new Date((v - 25569) * 86400 * 1000);
  } else {
    const s = str_(v);
    d = /^\d+(\.\d+)?$/.test(s)
      ? new Date((Number(s) - 25569) * 86400 * 1000)
      : new Date(s);
  }
  return isNaN(d.getTime()) ? null : d;
}

function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function safeName_(name) {
  return str_(name).replace(/[\\\/\?\*\[\]\:']/g, '').slice(0, 99) || 'Customer';
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}