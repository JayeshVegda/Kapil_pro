/**
 * ============================================================
 *  PARTY SUMMARY — APPS SCRIPT v5
 *  Formula-driven · Dynamic layout · Clean Master
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
const BILLING_SHEET_ID = '1sF-haW0mrnwSpl6Ck3gWWt4501gbmi-GIPn475qNYqI';

// Bill_Items columns (0-indexed)
const B_BOOKNO    = 0;
const B_BILLNO    = 1;
const B_DATE      = 2;
const B_CUSTOMER  = 3;
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
const P_CUSTOMER = 1;
const P_AMOUNT   = 2;
const P_MODE     = 3;
const P_NOTE     = 4;

// Customers columns (0-indexed)
const C_NAME    = 0;
const C_OPENING = 1;

// Layout
const DATA_START = 6; // first data row on every party sheet

// Party sheet column map (1-indexed for Sheets API)
// SALES PANE: A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8 I=9 J=10 K=11
// DIVIDER:    L=12
// PAY PANE:   M=13 N=14 O=15 P=16
const COL = {
  // Sales
  DATE:       1,   // A
  BILLREF:    2,   // B
  MKTRATE:    3,   // C
  ITEM:       4,   // D
  QTY:        5,   // E
  RATE:       6,   // F
  AMOUNT:     7,   // G
  TRANSPORT:  8,   // H
  GSTPCT:     9,   // I
  GSTAMT:     10,  // J
  FINAL:      11,  // K  ← formula: =G+H+J on last item row of each bill
  // Divider
  DIVIDER:    12,  // L  ← thin visual gap, hidden col
  // Payments
  PDATE:      13,  // M
  PAMOUNT:    14,  // N
  PMODE:      15,  // O
  PNOTE:      16,  // P
};

// Letter helpers for formula strings
const CL = {
  DATE:      'A', BILLREF: 'B', MKTRATE: 'C', ITEM: 'D',
  QTY:       'E', RATE:    'F', AMOUNT:  'G', TRANSPORT: 'H',
  GSTPCT:    'I', GSTAMT:  'J', FINAL:   'K',
  DIVIDER:   'L',
  PDATE:     'M', PAMOUNT: 'N', PMODE:   'O', PNOTE: 'P',
};


// ─── MENU ───────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Party Summary')
    .addItem('▶  Run Sync (new data only)', 'runSync')
    .addItem('🔄  Full Rebuild (reset everything)', 'runFullRebuild')
    .addSeparator()
    .addItem('⏰  Set Daily Auto-Sync at 7 AM', 'installDailyTrigger')
    .addToUi();
}


// ─── FULL REBUILD ───────────────────────────────────────────
function runFullRebuild() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.alert('Full Rebuild',
    'Delete all customer sheets and rebuild from scratch?\nThis may take 30–60 seconds.',
    ui.ButtonSet.YES_NO);
  if (ans !== ui.Button.YES) return;

  try {
    const billing = SpreadsheetApp.openById(BILLING_SHEET_ID);
    const summary = SpreadsheetApp.getActiveSpreadsheet();

    const keep = new Set(['Master', 'Sync_State', 'Sync_Log']);
    summary.getSheets().forEach(sh => {
      if (!keep.has(sh.getName())) summary.deleteSheet(sh);
    });

    ensureSystemSheets_(summary);

    const billRows   = readRows_(billing, 'Bill_Items');
    const payRows    = readRows_(billing, 'Payments');
    const custRows   = readRows_(billing, 'Customers');
    const openingMap = buildOpeningMap_(custRows);

    buildAllPartySheets_(summary, billRows, payRows, openingMap);
    buildMaster_(summary, openingMap, billRows, payRows);

    saveState_(summary, billRows.length, payRows.length);
    hideSystemSheets_(summary);
    writeLog_(summary, billRows.length, payRows.length, 'FULL REBUILD', '');

    ui.alert('Done ✓\n\n' + billRows.length + ' bills · ' + payRows.length + ' payments loaded.');
  } catch (err) {
    SpreadsheetApp.getUi().alert('ERROR:\n' + err.message + '\n\n' + err.stack);
    throw err;
  }
}


// ─── INCREMENTAL SYNC ───────────────────────────────────────
function runSync() {
  try {
    const billing = SpreadsheetApp.openById(BILLING_SHEET_ID);
    const summary = SpreadsheetApp.getActiveSpreadsheet();

    ensureSystemSheets_(summary);

    const billRows   = readRows_(billing, 'Bill_Items');
    const payRows    = readRows_(billing, 'Payments');
    const custRows   = readRows_(billing, 'Customers');
    const openingMap = buildOpeningMap_(custRows);
    const state      = readState_(summary);

    const newBills = billRows.slice(state.billCursor);
    const newPays  = payRows.slice(state.payCursor);

    if (!newBills.length && !newPays.length) {
      SpreadsheetApp.getActive().toast('Already up to date.', 'Sync', 4);
      return;
    }

    // Full rebuild of all affected sheets keeps formulas consistent
    buildAllPartySheets_(summary, billRows, payRows, openingMap);
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

function buildAllPartySheets_(summary, allBillRows, allPayRows, openingMap) {
  // Group by customer
  const billsBy = groupBy_(allBillRows, r => str_(r[B_CUSTOMER]));
  const paysBy  = groupBy_(allPayRows,  r => str_(r[P_CUSTOMER]));

  const allCustomers = new Set([
    ...openingMap.keys(),
    ...billsBy.keys(),
    ...paysBy.keys()
  ]);

  allCustomers.forEach(c => {
    if (!c) return;
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
  // Clear data zone (rows DATA_START onward)
  const lastRow = sh.getLastRow();
  if (lastRow >= DATA_START) {
    sh.getRange(DATA_START, 1, lastRow - DATA_START + 1, 16).clearContent().clearFormat();
  }

  // Build structured bill groups
  const billGroups = buildBillGroups_(billRows);   // [{first, items[], totalQty, finalAmt, billRef, dateObj, mkt}]

  // Build payment list (Opening Balance always first)
  const payments = buildPaymentList_(payRows, openingBalance);

  // Count total rows needed for each pane
  const salesRowCount = billGroups.reduce((n, g) => n + g.items.length, 0);
  const payRowCount   = payments.length;
  const totalRows     = Math.max(salesRowCount, payRowCount, 1);

  // ── Write sales pane values (no Final Amount — that's a formula) ──
  // Grid: 16 cols (A:P), totalRows rows
  // We write values for cols A:K (sales) and M:P (payments)
  // Col K (FINAL) is written as formula strings per bill-last-row
  // Col L (DIVIDER) stays blank always

  const salesGrid  = buildSalesGrid_(billGroups, totalRows);   // Array[totalRows][11]  A:K values/formulas
  const payGrid    = buildPayGrid_(payments, totalRows);        // Array[totalRows][4]   M:P values

  // Merge into full 16-col grid
  const fullGrid = [];
  for (let i = 0; i < totalRows; i++) {
    fullGrid.push([
      ...salesGrid[i],   // cols A:K (11 cols)
      '',                // col L divider
      ...payGrid[i]      // cols M:P (4 cols)
    ]);
  }

  // Batch write — one API call
  sh.getRange(DATA_START, 1, totalRows, 16).setValues(fullGrid);

  // Now write formulas for Final Amount (col K) on bill-last rows
  // and formula-based totals footer
  writeFinalAmountFormulas_(sh, billGroups);
  writePartyFooter_(sh, salesRowCount, payRowCount, payRows.length);
  applyPartyFormatting_(sh, totalRows, billGroups, payRowCount);
}


// ─── BUILD BILL GROUPS ──────────────────────────────────────
/**
 * Returns array of bill group objects.
 * Preserves original bill order (Map preserves insertion order).
 */
function buildBillGroups_(billRows) {
  const map = new Map();
  billRows.forEach(row => {
    const key = str_(row[B_BOOKNO]) + '|' + str_(row[B_BILLNO]) + '|' + str_(row[B_DATE]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });

  const groups = [];
  map.forEach((rows, key) => {
    const first  = rows[0];
    const bookNo = str_(first[B_BOOKNO]);
    const billNo = str_(first[B_BILLNO]);
    groups.push({
      billRef:  bookNo + '-' + String(billNo).padStart(3, '0'),
      dateObj:  serialToDateObj_(first[B_DATE]),
      mkt:      num_(first[B_MKT]),
      items:    rows,
    });
  });
  return groups;
}


// ─── BUILD SALES GRID ───────────────────────────────────────
/**
 * Returns totalRows × 11 array (cols A:K).
 * Final Amount (col K / index 10) is left as '' here —
 * formula is applied separately via writeFinalAmountFormulas_().
 */
function buildSalesGrid_(billGroups, totalRows) {
  const grid = [];

  billGroups.forEach(g => {
    g.items.forEach((row, idx) => {
      const isFirst = idx === 0;
      grid.push([
        isFirst ? (g.dateObj || '') : '',   // A: Date
        isFirst ? g.billRef : '',            // B: Bill Ref
        isFirst ? (g.mkt || '') : '',        // C: Market Rate
        str_(row[B_ITEM]),                   // D: Item
        num_(row[B_QTY])      || '',         // E: Qty
        num_(row[B_RATE])     || '',         // F: Rate
        num_(row[B_AMOUNT])   || '',         // G: Amount
        num_(row[B_TRANSPORT])|| '',         // H: Transport
        num_(row[B_GSTRATE])  || '',         // I: GST%
        num_(row[B_GSTAMT])   || '',         // J: GST Amt
        '',                                  // K: Final Amount (formula applied later)
      ]);
    });
  });

  // Pad remaining rows
  while (grid.length < totalRows) grid.push(['', '', '', '', '', '', '', '', '', '', '']);
  return grid;
}


// ─── WRITE FINAL AMOUNT FORMULAS ────────────────────────────
/**
 * For the LAST item row of each bill, writes a SUM formula in col K
 * that adds up G+H+J for all rows belonging to that bill.
 *
 * Single-item bill  (row 6):       =G6+H6+J6
 * Multi-item bill   (rows 6–8):    =SUM(G6:G8)+SUM(H6:H8)+SUM(J6:J8)
 *
 * This is fully formula-driven — editing any source cell auto-updates K.
 */
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
  const list = [{ date: 'Opening Bal', amount: openingBalance, mode: '', note: '', isOpening: true }];
  payRows.forEach(row => {
    list.push({
      date:   serialToDateObj_(row[P_DATE]) || '',
      amount: num_(row[P_AMOUNT]),
      mode:   str_(row[P_MODE]) || 'Cash',
      note:   str_(row[P_NOTE]),
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
/**
 * All formula-driven.
 *
 * Totals row:
 *   Total Sale  = COUNTIF(K_data, ">0")  |  SUM(E) | SUM(G) | SUM(H) | SUM(K)
 *   Total Pay   = SUM(N_data) — skips Opening Balance row
 *
 * Outstanding card:
 *   = Opening Balance cell + Total Sale cell − Total Payment cell
 *   Conditional formatting via Apps Script (red if > 0, green if ≤ 0)
 */
function writePartyFooter_(sh, salesRowCount, payRowCount, rawPayCount) {
  const ds        = DATA_START;
  const salesEnd  = ds + salesRowCount - 1;
  const payEnd    = ds + payRowCount   - 1;
  const totalRows = Math.max(salesRowCount, payRowCount, 1);
  const gapRow    = ds + totalRows;          // 1 blank gap row
  const totalsRow = gapRow + 1;
  const outRow    = totalsRow + 2;

  // Clear old footer zone (generous: 30 rows from gapRow)
  sh.getRange(gapRow, 1, 30, 16).clearContent().clearFormat();
  sh.getRange(gapRow, COL.DIVIDER, 30, 1).setBackground('#FFFFFF');

  // ── Totals row — Sales side ──────────────────────────────
  const salesRange = `${CL.DATE}${ds}:${CL.DATE}${salesEnd}`; // col A used for COUNTA of bills
  const kRange     = `${CL.FINAL}${ds}:${CL.FINAL}${salesEnd}`;
  const eRange     = `${CL.QTY}${ds}:${CL.QTY}${salesEnd}`;
  const gRange     = `${CL.AMOUNT}${ds}:${CL.AMOUNT}${salesEnd}`;
  const hRange     = `${CL.TRANSPORT}${ds}:${CL.TRANSPORT}${salesEnd}`;

  sh.getRange(totalsRow, COL.DATE)
    .setValue('Total Sale');
  sh.getRange(totalsRow, COL.BILLREF)
    .setFormula(`=IFERROR(COUNTIF(${kRange},">0"),0)`);          // Bill count
  sh.getRange(totalsRow, COL.QTY)
    .setFormula(`=IFERROR(SUM(${eRange}),0)`);                   // Total Qty
  sh.getRange(totalsRow, COL.AMOUNT)
    .setFormula(`=IFERROR(SUM(${gRange}),0)`);                   // Total Amount
  sh.getRange(totalsRow, COL.TRANSPORT)
    .setFormula(`=IFERROR(SUM(${hRange}),0)`);                   // Total Transport
  sh.getRange(totalsRow, COL.FINAL)
    .setFormula(`=IFERROR(SUM(${kRange}),0)`);                   // Total Final

  // Style totals sales side
  sh.getRange(totalsRow, COL.DATE, 1, 11)
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setFontWeight('bold').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(totalsRow, COL.DATE).setHorizontalAlignment('left');
  sh.getRange(totalsRow, COL.BILLREF, 1, 10).setHorizontalAlignment('right');
  sh.getRange(totalsRow, COL.BILLREF).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.QTY).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.AMOUNT).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.TRANSPORT).setNumberFormat('#,##0');
  sh.getRange(totalsRow, COL.FINAL).setNumberFormat('#,##0');

  // ── Totals row — Payments side ───────────────────────────
  // Opening Balance is at row ds (col N). Actual payments start at ds+1.
  const obCell      = CL.PAMOUNT + ds;          // e.g. N6
  const payDataEnd  = ds + payRowCount - 1;

  sh.getRange(totalsRow, COL.PDATE).setValue('Total Payment');
  if (rawPayCount > 0) {
    // Sum only actual payments (skip Opening Bal row)
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
    .setHorizontalAlignment('right').setNumberFormat('#,##0');

  // Divider cell on totals row
  sh.getRange(totalsRow, COL.DIVIDER).setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
  sh.setRowHeight(totalsRow, 28);

  // ── Outstanding card ─────────────────────────────────────
  // Formula: =OB_cell + TotalSale_cell − TotalPay_cell
  const salKCell = CL.FINAL + totalsRow;
  const payNCell = CL.PAMOUNT + totalsRow;
  const outFormula = `=${obCell}+${salKCell}-${payNCell}`;

  sh.getRange(outRow, COL.DATE, 1, 11).merge()
    .setValue('Total Outstanding Balance')
    .setBackground('#1E3557').setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);

  // Outstanding value cell — conditional color applied after formula written
  const outValRange = sh.getRange(outRow, COL.PDATE, 1, 4);
  outValRange.merge()
    .setFormula(outFormula)
    .setFontWeight('bold').setFontSize(18)
    .setHorizontalAlignment('right')
    .setNumberFormat('₹#,##0.00')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);

  // Conditional formatting: positive = red-tinted, zero/negative = green-tinted
  applyOutstandingConditionalFormat_(sh, outRow);

  sh.setRowHeight(outRow, 40);
  sh.getRange(outRow, COL.DIVIDER).setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ─── OUTSTANDING CONDITIONAL FORMAT ─────────────────────────
/**
 * Uses Apps Script conditional formatting rules so the
 * outstanding card updates live as data changes.
 * Red-tinted (#FDECEA text #B71C1C) when > 0
 * Green-tinted (#E8F5E9 text #1B5E20) when ≤ 0
 */
function applyOutstandingConditionalFormat_(sh, outRow) {
  const range = sh.getRange(outRow, COL.PDATE, 1, 4);

  // Remove any existing conditional format rules on this range
  const existing = sh.getConditionalFormatRules();
  const a1 = range.getA1Notation();
  const filtered = existing.filter(rule => {
    return !rule.getRanges().some(r => r.getA1Notation() === a1);
  });

  const rulePositive = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0)
    .setBackground('#FDECEA')
    .setFontColor('#B71C1C')
    .setRanges([range])
    .build();

  const ruleClear = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThanOrEqualTo(0)
    .setBackground('#E8F5E9')
    .setFontColor('#1B5E20')
    .setRanges([range])
    .build();

  filtered.push(rulePositive, ruleClear);
  sh.setConditionalFormatRules(filtered);
}


// ─── PARTY SHEET FORMATTING ─────────────────────────────────
function applyPartyFormatting_(sh, totalRows, billGroups, payRowCount) {
  const ds = DATA_START;
  if (totalRows < 1) return;

  // Row heights
  for (let r = ds; r < ds + totalRows; r++) sh.setRowHeight(r, 25);

  // ── Number formats ──────────────────────────────────────
  sh.getRange(ds, COL.DATE, totalRows, 1).setNumberFormat('dd-MMM-yyyy');
  sh.getRange(ds, COL.QTY,  totalRows, 7).setNumberFormat('#,##0');  // E:K
  sh.getRange(ds, COL.FINAL, totalRows, 1).setNumberFormat('#,##0');

  if (payRowCount > 1) {
    // Date format for actual payment rows (skip Opening Bal text row)
    sh.getRange(ds + 1, COL.PDATE, payRowCount - 1, 1).setNumberFormat('dd-MMM-yyyy');
  }
  sh.getRange(ds, COL.PAMOUNT, payRowCount, 1).setNumberFormat('#,##0');

  // ── Alignments — Sales ──────────────────────────────────
  sh.getRange(ds, COL.DATE,    totalRows, 3).setHorizontalAlignment('center'); // A:C
  sh.getRange(ds, COL.ITEM,    totalRows, 1).setHorizontalAlignment('left');   // D
  sh.getRange(ds, COL.QTY,     totalRows, 7).setHorizontalAlignment('right');  // E:K
  sh.getRange(ds, COL.DATE,    totalRows, 11).setVerticalAlignment('middle');

  // ── Alignments — Payments ───────────────────────────────
  sh.getRange(ds, COL.PDATE,   payRowCount, 1).setHorizontalAlignment('center');
  sh.getRange(ds, COL.PAMOUNT, payRowCount, 1).setHorizontalAlignment('right');
  sh.getRange(ds, COL.PMODE,   payRowCount, 1).setHorizontalAlignment('center');
  sh.getRange(ds, COL.PNOTE,   payRowCount, 1).setHorizontalAlignment('left');
  sh.getRange(ds, COL.PDATE,   payRowCount, 4).setVerticalAlignment('middle');

  // ── Zebra striping ───────────────────────────────────────
  for (let i = 0; i < totalRows; i++) {
    const row = ds + i;
    const bg  = (i % 2 === 0) ? '#FFFFFF' : '#F7F9FB';
    sh.getRange(row, COL.DATE,  1, 11).setBackground(bg);
    sh.getRange(row, COL.PDATE, 1, 4).setBackground(bg);
  }

  // ── Light grid borders on panes ─────────────────────────
  sh.getRange(ds, COL.DATE,  totalRows, 11)
    .setBorder(true, true, true, true, true, true,
      '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(ds, COL.PDATE, payRowCount, 4)
    .setBorder(true, true, true, true, true, true,
      '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);

  // ── Bill-bottom strong borders ───────────────────────────
  // Placed on the LAST item row of each bill group
  let cursor = ds;
  billGroups.forEach(g => {
    const lastRow = cursor + g.items.length - 1;
    sh.getRange(lastRow, COL.DATE, 1, 11)
      .setBorder(null, null, true, null, false, false,
        '#1E3557', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    cursor += g.items.length;
  });

  // ── Opening Balance row: bold ─────────────────────────────
  sh.getRange(ds, COL.PDATE).setFontWeight('bold');
  sh.getRange(ds, COL.PAMOUNT).setFontWeight('bold');

  // ── Divider column L: clean white, no border ────────────
  const clearRows = totalRows + 30;
  sh.getRange(1, COL.DIVIDER, clearRows, 1)
    .setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ─── SHEET HEADER ───────────────────────────────────────────
function makeSheetHeader_(sh, customerName) {
  sh.getRange('A1:P5').clearContent().clearFormat().breakApart();
  sh.getRange('A1:P5').setFontFamily('Arial');

  sh.setRowHeight(1, 8);   // thin top margin

  // Row 2: Title
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

  sh.setRowHeight(3, 10);  // gap

  // Row 4: Section labels
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

  // Row 5: Column headers
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

  // Column widths (col M removed — now col 12=L divider, 13=M pay)
  sh.setColumnWidth(1,  100);   // A Date
  sh.setColumnWidth(2,  90);    // B Bill No
  sh.setColumnWidth(3,  88);    // C Market Rate
  sh.setColumnWidth(4,  180);   // D Item
  sh.setColumnWidth(5,  80);    // E Qty
  sh.setColumnWidth(6,  76);    // F Rate
  sh.setColumnWidth(7,  108);   // G Amount
  sh.setColumnWidth(8,  94);    // H Transport
  sh.setColumnWidth(9,  60);    // I GST%
  sh.setColumnWidth(10, 86);    // J GST Amt
  sh.setColumnWidth(11, 122);   // K Final Amount
  sh.setColumnWidth(12, 10);    // L divider (thin)
  sh.setColumnWidth(13, 100);   // M Pay Date
  sh.setColumnWidth(14, 115);   // N Pay Amount
  sh.setColumnWidth(15, 82);    // O Mode
  sh.setColumnWidth(16, 210);   // P Note

  sh.setFrozenRows(5);

  // Keep divider clean
  sh.getRange('L1:L300').setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);
}


// ════════════════════════════════════════════════════════════
//  MASTER SHEET
// ════════════════════════════════════════════════════════════

function buildMaster_(summary, openingMap, billRows, payRows) {
  const sh = ensureMasterSheet_(summary);

  // Aggregate by customer
  const sales    = {};
  const paid     = {};
  const billCnt  = {};
  const lastBill = {};
  const lastPay  = {};

  billRows.forEach(row => {
    const c = str_(row[B_CUSTOMER]);
    if (!c) return;
    // Final amount = amount + transport + gst
    sales[c]   = (sales[c]   || 0) + num_(row[B_AMOUNT]) + num_(row[B_TRANSPORT]) + num_(row[B_GSTAMT]);
    billCnt[c] = (billCnt[c] || 0);
    const key  = str_(row[B_BOOKNO]) + '|' + str_(row[B_BILLNO]);
    // Count unique bills
    if (!lastBill[c + '|keys']) lastBill[c + '|keys'] = new Set();
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
      nameCell,      // A Customer
      opening,       // B Opening Bal
      bills,         // C Bill Count
      totalSales,    // D Total Sales
      totalPaid,     // E Total Paid
      outstanding,   // F Outstanding
      lastBill[c] ? serialToDateObj_(lastBill[c]) : '',  // G Last Bill
      lastPay[c]  ? serialToDateObj_(lastPay[c])  : '',  // H Last Pay
      typeof daysSince === 'number' ? daysSince : '',    // I Days Since
      status         // J Status
    ]);
  });

  rows.sort((a, b) => {
    const na = String(a[0]).replace(/.*"([^"]+)"\)$/, '$1');
    const nb = String(b[0]).replace(/.*"([^"]+)"\)$/, '$1');
    return na.localeCompare(nb);
  });

  // Clear old data
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

  // Row 1: Big title
  sh.getRange('A1:J1').merge()
    .setValue('PARTY SUMMARY')
    .setFontSize(15).setFontWeight('bold')
    .setBackground('#1F3A5F').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);

  // Row 2: subtitle / date stamp
  sh.getRange('A2:J2').merge()
    .setFormula('="Last updated: "&TEXT(NOW(),"dd-mmm-yyyy hh:mm AM/PM")')
    .setFontSize(9).setFontColor('#888888')
    .setBackground('#F7F9FB')
    .setHorizontalAlignment('right').setVerticalAlignment('middle');
  sh.setRowHeight(2, 20);

  // Row 3: Column headers
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

  // Column widths
  sh.setColumnWidth(1,  200);  // A Customer
  sh.setColumnWidth(2,  110);  // B Opening
  sh.setColumnWidth(3,  70);   // C Bills
  sh.setColumnWidth(4,  120);  // D Sales
  sh.setColumnWidth(5,  110);  // E Paid
  sh.setColumnWidth(6,  130);  // F Outstanding
  sh.setColumnWidth(7,  110);  // G Last Bill
  sh.setColumnWidth(8,  110);  // H Last Pay
  sh.setColumnWidth(9,  88);   // I Days
  sh.setColumnWidth(10, 90);   // J Status

  if (dataRowCount < 1) return;

  const dr = dataRowCount;
  const r4 = 4;

  // Number formats
  sh.getRange(r4, 2, dr, 5).setNumberFormat('#,##0');          // B:F numbers
  sh.getRange(r4, 7, dr, 2).setNumberFormat('dd-MMM-yyyy');    // G:H dates
  sh.getRange(r4, 9, dr, 1).setNumberFormat('0');              // I days

  // Alignment
  sh.getRange(r4, 1, dr, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sh.getRange(r4, 2, dr, 8).setHorizontalAlignment('right');
  sh.getRange(r4, 7, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 9, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 1, dr, 10).setVerticalAlignment('middle');

  // Row heights + zebra
  for (let i = 0; i < dr; i++) {
    const row = r4 + i;
    sh.setRowHeight(row, 26);
    sh.getRange(row, 1, 1, 10)
      .setBackground(i % 2 === 0 ? '#FFFFFF' : '#F4F6F9');
  }

  // Status conditional colors
  for (let i = 0; i < dr; i++) {
    const row = r4 + i;
    const status = str_(sh.getRange(row, 10).getValue());
    const statusCell = sh.getRange(row, 10);
    if (status === 'Clear') {
      statusCell.setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    } else if (status === 'Pending') {
      statusCell.setBackground('#FFF8E1').setFontColor('#F57F17').setFontWeight('bold');
    } else if (status === 'Overdue') {
      statusCell.setBackground('#FDECEA').setFontColor('#B71C1C').setFontWeight('bold');
    }
  }

  // Outstanding column: red if > 0, green if ≤ 0
  for (let i = 0; i < dr; i++) {
    const cell = sh.getRange(r4 + i, 6);
    const val  = num_(cell.getValue());
    if (val > 0)  cell.setFontColor('#B71C1C').setFontWeight('bold');
    else          cell.setFontColor('#2E7D32').setFontWeight('bold');
  }

  // Days aging
  for (let i = 0; i < dr; i++) {
    const cell = sh.getRange(r4 + i, 9);
    const days = num_(cell.getValue());
    if (!days && days !== 0) continue;
    if (days < 15)       cell.setBackground('#E8F5E9').setFontColor('#2E7D32');
    else if (days <= 30) cell.setBackground('#FFF8E1').setFontColor('#F57F17');
    else                 cell.setBackground('#FDECEA').setFontColor('#B71C1C').setFontWeight('bold');
  }

  // ── Summary footer row ──────────────────────────────────
  const footerRow = r4 + dr + 1;
  sh.getRange(footerRow, 1).setValue('TOTAL');
  sh.getRange(footerRow, 2).setFormula(`=IFERROR(SUM(B${r4}:B${r4+dr-1}),0)`);  // Opening
  sh.getRange(footerRow, 3).setFormula(`=IFERROR(SUM(C${r4}:C${r4+dr-1}),0)`);  // Bills
  sh.getRange(footerRow, 4).setFormula(`=IFERROR(SUM(D${r4}:D${r4+dr-1}),0)`);  // Sales
  sh.getRange(footerRow, 5).setFormula(`=IFERROR(SUM(E${r4}:E${r4+dr-1}),0)`);  // Paid
  sh.getRange(footerRow, 6).setFormula(`=IFERROR(SUM(F${r4}:F${r4+dr-1}),0)`);  // Outstanding
  sh.getRange(footerRow, 1, 1, 10)
    .setBackground('#1F3A5F').setFontColor('#FFFFFF')
    .setFontWeight('bold').setHorizontalAlignment('right')
    .setNumberFormat('#,##0')
    .setBorder(true, true, true, true, false, false,
      '#2A4A7A', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(footerRow, 1).setHorizontalAlignment('left');
  sh.setRowHeight(footerRow, 28);

  // Outer border on full table
  sh.getRange(3, 1, dr + 2, 10)
    .setBorder(true, true, true, true, false, false,
      '#C5D0DE', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
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

function readRows_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
    .getValues()
    .filter(r => r.some(c => str_(c) !== ''));
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