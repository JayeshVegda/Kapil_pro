const SHEET_ID = '1sF-haW0mrnwSpl6Ck3gWWt4501gbmi-GIPn475qNYqI';

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeStr(v) {
  return String(v == null ? '' : v).trim();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getSheetOrThrow(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet not found: ${name}`);
  return sh;
}

function dataRows(sh) {
  const vals = sh.getDataRange().getValues();
  return vals.length > 1 ? vals.slice(1) : [];
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = safeStr(data.action);
    const ss = SpreadsheetApp.openById(SHEET_ID);

    // ---------- CREATE ----------
    if (action === 'saveBill') {
      const sheet = getSheetOrThrow(ss, 'Bill_Items');
      const items = Array.isArray(data.items) ? data.items : [];
      items.forEach(item => {
        sheet.appendRow([
          data.billNo,                // col 0
          data.date,                  // col 1
          data.customer,              // col 2
          data.mkt,                   // col 3
          item.itemName,              // col 4
          safeNum(item.qty),          // col 5
          safeNum(item.rate),         // col 6
          safeNum(item.amount),       // col 7
          safeNum(item.transport),    // col 8
          safeNum(item.bags),         // col 9
          data.lrNo || ''             // col 10
        ]);
      });
      return jsonOut({ status: 'success' });
    }

    if (action === 'savePayment') {
      const sheet = getSheetOrThrow(ss, 'Payments');
      sheet.appendRow([data.date, data.customer, safeNum(data.amount), data.note || '']);
      return jsonOut({ status: 'success' });
    }

    if (action === 'saveCustomer') {
      const sheet = getSheetOrThrow(ss, 'Customers');
      sheet.appendRow([data.name, safeNum(data.openingBalance)]);
      return jsonOut({ status: 'success' });
    }

    if (action === 'saveItem') {
      const sheet = getSheetOrThrow(ss, 'Items');
      sheet.appendRow([data.itemName, safeNum(data.defaultRate)]);
      return jsonOut({ status: 'success' });
    }

    // ---------- UPDATE ----------
    if (action === 'editCustomer') {
      const sheet = getSheetOrThrow(ss, 'Customers');
      const rows = dataRows(sheet);
      const oldName = safeStr(data.match && data.match.name).toLowerCase();
      const newName = safeStr(data.updates && data.updates.name);
      const openingBalance = safeNum(data.updates && data.updates.openingBalance);

      let updated = false;
      rows.forEach((r, idx) => {
        if (safeStr(r[0]).toLowerCase() === oldName) {
          sheet.getRange(idx + 2, 1, 1, 2).setValues([[newName, openingBalance]]);
          updated = true;
        }
      });

      return jsonOut(updated ? { status: 'success' } : { status: 'error', message: 'Customer not found' });
    }

    if (action === 'editItem') {
      const sheet = getSheetOrThrow(ss, 'Items');
      const rows = dataRows(sheet);
      const oldName = safeStr(data.match && data.match.itemName).toLowerCase();
      const newName = safeStr(data.updates && data.updates.itemName);
      const defaultRate = safeNum(data.updates && data.updates.defaultRate);

      let updated = false;
      rows.forEach((r, idx) => {
        if (safeStr(r[0]).toLowerCase() === oldName) {
          sheet.getRange(idx + 2, 1, 1, 2).setValues([[newName, defaultRate]]);
          updated = true;
        }
      });

      return jsonOut(updated ? { status: 'success' } : { status: 'error', message: 'Item not found' });
    }

    if (action === 'editBill') {
      const sheet = getSheetOrThrow(ss, 'Bill_Items');
      const rows = dataRows(sheet);
      const billNo = safeStr(data.billNo);
      const updates = data.updates || {};

      let count = 0;
      rows.forEach((r, idx) => {
        if (safeStr(r[0]) === billNo) {
          const newDate = safeStr(updates.date) || safeStr(r[1]);
          const newMkt = safeStr(updates.mkt) || safeStr(r[3]);
          const newTransport = updates.transport == null ? safeNum(r[8]) : safeNum(updates.transport);
          const newLr = updates.lrNo == null ? safeStr(r[10]) : safeStr(updates.lrNo);

          sheet.getRange(idx + 2, 2).setValue(newDate);      // date col (2)
          sheet.getRange(idx + 2, 4).setValue(newMkt);       // mkt col (4)
          sheet.getRange(idx + 2, 9).setValue(newTransport); // transport col (9)
          sheet.getRange(idx + 2, 11).setValue(newLr);       // lr col (11)
          count++;
        }
      });

      return jsonOut(count > 0 ? { status: 'success' } : { status: 'error', message: 'Bill not found' });
    }

    if (action === 'editPayment') {
      const sheet = getSheetOrThrow(ss, 'Payments');
      const rows = dataRows(sheet);
      const match = data.match || {};
      const updates = data.updates || {};

      let updated = false;
      rows.forEach((r, idx) => {
        const ok =
          safeStr(r[0]) === safeStr(match.date) &&
          safeStr(r[1]) === safeStr(match.customer) &&
          safeNum(r[2]) === safeNum(match.amount) &&
          safeStr(r[3]) === safeStr(match.note);

        if (ok && !updated) {
          sheet.getRange(idx + 2, 1, 1, 4).setValues([[
            safeStr(updates.date) || safeStr(r[0]),
            safeStr(r[1]),
            updates.amount == null ? safeNum(r[2]) : safeNum(updates.amount),
            safeStr(updates.note) || safeStr(r[3])
          ]]);
          updated = true;
        }
      });

      return jsonOut(updated ? { status: 'success' } : { status: 'error', message: 'Payment not found' });
    }

    // ---------- DELETE ----------
    if (action === 'deleteCustomer') {
      const sheet = getSheetOrThrow(ss, 'Customers');
      const rows = dataRows(sheet);
      const name = safeStr(data.match && data.match.name).toLowerCase();

      for (let i = rows.length - 1; i >= 0; i--) {
        if (safeStr(rows[i][0]).toLowerCase() === name) sheet.deleteRow(i + 2);
      }
      return jsonOut({ status: 'success' });
    }

    if (action === 'deleteItem') {
      const sheet = getSheetOrThrow(ss, 'Items');
      const rows = dataRows(sheet);
      const itemName = safeStr(data.match && data.match.itemName).toLowerCase();

      for (let i = rows.length - 1; i >= 0; i--) {
        if (safeStr(rows[i][0]).toLowerCase() === itemName) sheet.deleteRow(i + 2);
      }
      return jsonOut({ status: 'success' });
    }

    if (action === 'deleteBill') {
      const sheet = getSheetOrThrow(ss, 'Bill_Items');
      const rows = dataRows(sheet);
      const billNo = safeStr(data.billNo);

      for (let i = rows.length - 1; i >= 0; i--) {
        if (safeStr(rows[i][0]) === billNo) sheet.deleteRow(i + 2);
      }
      return jsonOut({ status: 'success' });
    }

    if (action === 'deletePayment') {
      const sheet = getSheetOrThrow(ss, 'Payments');
      const rows = dataRows(sheet);
      const match = data.match || {};

      for (let i = rows.length - 1; i >= 0; i--) {
        const ok =
          safeStr(rows[i][0]) === safeStr(match.date) &&
          safeStr(rows[i][1]) === safeStr(match.customer) &&
          safeNum(rows[i][2]) === safeNum(match.amount) &&
          safeStr(rows[i][3]) === safeStr(match.note);
        if (ok) sheet.deleteRow(i + 2);
      }
      return jsonOut({ status: 'success' });
    }

    return jsonOut({ status: 'error', message: `Unknown action: ${action}` });
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}

function doGet(e) {
  try {
    const action = safeStr(e && e.parameter && e.parameter.action);
    const ss = SpreadsheetApp.openById(SHEET_ID);

    if (action === 'getCustomers') {
      return jsonOut(getSheetOrThrow(ss, 'Customers').getDataRange().getValues());
    }

    if (action === 'getItems') {
      return jsonOut(getSheetOrThrow(ss, 'Items').getDataRange().getValues());
    }

    if (action === 'getBillItems') {
      return jsonOut(getSheetOrThrow(ss, 'Bill_Items').getDataRange().getValues());
    }

    if (action === 'getPayments') {
      return jsonOut(getSheetOrThrow(ss, 'Payments').getDataRange().getValues());
    }

    if (action === 'getMiscExpenses') {
      const sh = ss.getSheetByName('Misc_Expenses');
      return jsonOut(sh ? sh.getDataRange().getValues() : []);
    }

    return jsonOut([]);
  } catch (err) {
    return jsonOut({ status: 'error', message: String(err) });
  }
}