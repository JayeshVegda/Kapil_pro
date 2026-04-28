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
// DB-only mode: Party Summary reads directly from PocketBase.
const POCKETBASE_BASE_URL = 'https://kapil.cosearch.me/pb';
const PB_FETCH_PAGE_SIZE = 60; // low-bandwidth mode for Apps Script quotas

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

    // Fast incremental rebuild: only customers touched by new rows.
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
  // Clear data zone (rows DATA_START onward)
  const lastRow = sh.getLastRow();
  if (lastRow >= DATA_START) {
    sh.getRange(DATA_START, 1, lastRow - DATA_START + 1, 16).clearContent().clearFormat();
  }

  // Build structured bill groups
  const billGroups = buildBillGroups_(billRows);   // [{first, items[], totalQty, finalAmt, billRef, dateObj, mkt}]

  // Build payment list (Opening Balance always first)
  const payments = buildPaymentList_(billRows, payRows, openingBalance);

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
function buildPaymentList_(billRows, payRows, openingBalance) {
  const openingDate = resolveOpeningBalanceDate_(billRows, payRows);
  const list = [{ date: openingDate, amount: openingBalance, mode: '', note: 'Opening Balance', isOpening: true }];
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

function resolveOpeningBalanceDate_(billRows, payRows) {
  let minTs = null;

  billRows.forEach(row => {
    const d = serialToDateObj_(row[B_DATE]);
    if (!d) return;
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return;
    if (minTs === null || ts < minTs) minTs = ts;
  });

  payRows.forEach(row => {
    const d = serialToDateObj_(row[P_DATE]);
    if (!d) return;
    const ts = d.getTime();
    if (!Number.isFinite(ts)) return;
    if (minTs === null || ts < minTs) minTs = ts;
  });

  // Fallback: today if no transactions exist yet for this party.
  return minTs === null ? new Date() : new Date(minTs);
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
  sh.getRange(totalsRow, COL.AMOUNT).setNumberFormat('₹#,##0');
  sh.getRange(totalsRow, COL.TRANSPORT).setNumberFormat('₹#,##0');
  sh.getRange(totalsRow, COL.FINAL).setNumberFormat('₹#,##0').setFontStyle('italic');

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
    .setHorizontalAlignment('right').setNumberFormat('₹#,##0');

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

  // Row heights (batched)
  sh.setRowHeights(ds, totalRows, 25);

  // ── Number formats ──────────────────────────────────────
  sh.getRange(ds, COL.DATE, totalRows, 1).setNumberFormat('dd-MMM-yyyy');
  sh.getRange(ds, COL.QTY, totalRows, 1).setNumberFormat('#,##0');     // E qty
  sh.getRange(ds, COL.RATE, totalRows, 1).setNumberFormat('₹#,##0');   // F rate
  sh.getRange(ds, COL.AMOUNT, totalRows, 1).setNumberFormat('₹#,##0'); // G amount
  sh.getRange(ds, COL.TRANSPORT, totalRows, 1).setNumberFormat('₹#,##0'); // H transport
  sh.getRange(ds, COL.GSTAMT, totalRows, 1).setNumberFormat('₹#,##0'); // J gst amount
  sh.getRange(ds, COL.FINAL, totalRows, 1).setNumberFormat('₹#,##0').setFontWeight('bold').setFontStyle('italic');

  if (payRowCount > 1) {
    // Date format for actual payment rows (skip Opening Bal text row)
    sh.getRange(ds + 1, COL.PDATE, payRowCount - 1, 1).setNumberFormat('dd-MMM-yyyy');
  }
  sh.getRange(ds, COL.PAMOUNT, payRowCount, 1).setNumberFormat('₹#,##0');

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

  // ── Zebra striping (batched) ─────────────────────────────
  const zebraSales = [];
  const zebraPays = [];
  for (let i = 0; i < totalRows; i++) {
    const bg = (i % 2 === 0) ? '#FFFFFF' : '#F7F9FB';
    zebraSales.push(new Array(11).fill(bg));
    zebraPays.push(new Array(4).fill(bg));
  }
  sh.getRange(ds, COL.DATE, totalRows, 11).setBackgrounds(zebraSales);
  sh.getRange(ds, COL.PDATE, totalRows, 4).setBackgrounds(zebraPays);

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
  sh.getRange(r4, 2, dr, 1).setNumberFormat('₹#,##0');         // B Opening
  sh.getRange(r4, 3, dr, 1).setNumberFormat('#,##0');          // C Bills
  sh.getRange(r4, 4, dr, 3).setNumberFormat('₹#,##0');         // D:E:F amounts
  sh.getRange(r4, 7, dr, 2).setNumberFormat('dd-MMM-yyyy');    // G:H dates
  sh.getRange(r4, 9, dr, 1).setNumberFormat('0');              // I days

  // Alignment
  sh.getRange(r4, 1, dr, 1).setHorizontalAlignment('left').setFontWeight('bold');
  sh.getRange(r4, 2, dr, 8).setHorizontalAlignment('right');
  sh.getRange(r4, 7, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 9, dr, 2).setHorizontalAlignment('center');
  sh.getRange(r4, 1, dr, 10).setVerticalAlignment('middle');

  // Row heights + zebra (batched)
  sh.setRowHeights(r4, dr, 26);
  const zebraMaster = [];
  for (let i = 0; i < dr; i++) {
    zebraMaster.push(new Array(10).fill(i % 2 === 0 ? '#FFFFFF' : '#F4F6F9'));
  }
  sh.getRange(r4, 1, dr, 10).setBackgrounds(zebraMaster);

  // Conditional formatting for Status / Outstanding / Days (range based, faster)
  applyMasterConditionalFormats_(sh, r4, dr);

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
  sh.getRange(footerRow, 2, 1, 1).setNumberFormat('₹#,##0'); // Opening
  sh.getRange(footerRow, 4, 1, 3).setNumberFormat('₹#,##0'); // Sales/Paid/Outstanding
  sh.getRange(footerRow, 1).setHorizontalAlignment('left');
  sh.setRowHeight(footerRow, 28);

  // Outer border on full table
  sh.getRange(3, 1, dr + 2, 10)
    .setBorder(true, true, true, true, false, false,
      '#C5D0DE', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

function applyMasterConditionalFormats_(sh, startRow, rowCount) {
  const statusRange = sh.getRange(startRow, 10, rowCount, 1); // J
  const outstandingRange = sh.getRange(startRow, 6, rowCount, 1); // F
  const daysRange = sh.getRange(startRow, 9, rowCount, 1); // I

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
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
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

/**
 * Unified source loader:
 * - PocketBase API (recommended for your current setup), or
 * - Legacy Billing Google Sheet (fallback)
 */
function getSourceRows_() {
  return fetchPocketBaseRows_();
}

/**
 * Pulls all required records from PocketBase and maps them into the exact
 * array layout expected by the existing logic/index constants above.
 */
function fetchPocketBaseRows_() {
  const customers = pbGetAll_('customers', {
    sort: 'name',
    fields: 'id,name,opening_balance',
  });
  const bills = pbGetAll_('bills', {
    sort: 'date,bill_no',
    fields: 'id,book_no,bill_no,date,customer_name,mkt,transport,gst_rate,gst_amount,lr_no',
  });
  const billItems = pbGetAll_('bill_items', {
    sort: 'id',
    // keep payload lean; amount is derived as qty*rate during mapping
    fields: 'id,bill,item_name,qty,rate,bags',
  });
  const payments = pbGetAll_('payments', {
    sort: 'date',
    fields: 'id,date,customer_name,amount,mode,note',
  });

  const billById = {};
  bills.forEach(b => {
    billById[String(b.id)] = b;
  });

  // Build Bill_Items rows in legacy column order:
  // Book No,Bill No,Date,Customer,MKT,Item Name,Qty,Rate,Amount,Transport,Bags,GST Rate,GST Amount,LR No
  const billRows = [];
  billItems.forEach(item => {
    const bill = billById[String(item.bill)];
    if (!bill) return;
    billRows.push([
      num_(bill.book_no),            // 0 B_BOOKNO
      num_(bill.bill_no),            // 1 B_BILLNO
      str_(bill.date).slice(0, 10),  // 2 B_DATE
      str_(bill.customer_name),      // 3 B_CUSTOMER
      num_(bill.mkt),                // 4 B_MKT
      str_(item.item_name),          // 5 B_ITEM
      num_(item.qty),                // 6 B_QTY
      num_(item.rate),               // 7 B_RATE
      num_(item.qty) * num_(item.rate), // 8 B_AMOUNT (derived to reduce transfer)
      num_(bill.transport),          // 9 B_TRANSPORT
      num_(item.bags),               // 10 B_BAGS
      num_(bill.gst_rate),           // 11 B_GSTRATE
      num_(bill.gst_amount),         // 12 B_GSTAMT
      str_(bill.lr_no),              // 13 B_LRNO
    ]);
  });

  // Build Payments rows in legacy column order:
  // Date,Customer,Amount,Mode,Note
  const payRows = payments.map(p => [
    str_(p.date).slice(0, 10),       // 0 P_DATE
    str_(p.customer_name),           // 1 P_CUSTOMER
    num_(p.amount),                  // 2 P_AMOUNT
    str_(p.mode),                    // 3 P_MODE
    str_(p.note),                    // 4 P_NOTE
  ]);

  // Build Customers rows in legacy column order:
  // Name,Opening Balance
  const custRows = customers.map(c => [
    str_(c.name),                    // 0 C_NAME
    num_(c.opening_balance),         // 1 C_OPENING
  ]);

  return { billRows, payRows, custRows };
}

/**
 * PocketBase paginated fetch helper.
 */
function pbGetAll_(collection, opts) {
  const out = [];
  let page = 1;
  const perPage = PB_FETCH_PAGE_SIZE;
  const sort = opts && opts.sort ? String(opts.sort) : '';
  const fields = opts && opts.fields ? String(opts.fields) : '';
  while (true) {
    const params = [
      `perPage=${perPage}`,
      `page=${page}`,
      sort ? `sort=${encodeURIComponent(sort)}` : '',
      fields ? `fields=${encodeURIComponent(fields)}` : '',
      'skipTotal=1',
    ].filter(Boolean).join('&');
    const url = `${POCKETBASE_BASE_URL}/api/collections/${encodeURIComponent(collection)}/records?${params}`;
    const resp = fetchWithRetry_(url, 6);
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code < 200 || code >= 300) {
      throw new Error(`PocketBase fetch failed (${collection}) HTTP ${code}: ${body}`);
    }
    const json = JSON.parse(body);
    const items = json.items || [];
    out.push.apply(out, items);
    if (items.length < perPage) break;
    page += 1;
  }
  return out;
}

function fetchWithRetry_(url, maxAttempts) {
  let attempt = 1;
  while (true) {
    const resp = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
      },
    });
    const code = resp.getResponseCode();
    if (code < 400) return resp;
    if (attempt >= maxAttempts) return resp;
    Utilities.sleep(1200 * attempt); // stronger backoff for quota throttling
    attempt += 1;
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