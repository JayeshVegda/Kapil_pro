/**
 * PocketBase bridge for Party Summary.
 *
 * Keep the existing Party Summary layout code intact. Use these helpers to
 * replace only the old Google Sheet reads with PocketBase REST reads.
 *
 * Required script properties:
 * - POCKETBASE_BASE_URL: https://kapil.cosearch.me/pb
 */

const PB_PROP_BASE_URL = 'POCKETBASE_BASE_URL';

function getPocketBaseBaseUrl_() {
  const url = PropertiesService.getScriptProperties().getProperty(PB_PROP_BASE_URL);
  if (!url) throw new Error('Set script property POCKETBASE_BASE_URL first.');
  return url.replace(/\/$/, '');
}

function fetchPocketBaseList_(collection, query) {
  const baseUrl = getPocketBaseBaseUrl_();
  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${baseUrl}/api/collections/${collection}/records?page=${page}&perPage=200&${query || ''}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`PocketBase ${collection} fetch failed: HTTP ${code} ${response.getContentText()}`);
    }

    const body = JSON.parse(response.getContentText());
    all.push.apply(all, body.items || []);
    totalPages = body.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return all;
}

function fetchPartySummaryRowsFromPocketBase_() {
  const customers = fetchPocketBaseList_('customers', 'sort=name');
  const bills = fetchPocketBaseList_('bills', 'sort=date,bill_no');
  const billItems = fetchPocketBaseList_('bill_items', 'sort=created');
  const payments = fetchPocketBaseList_('payments', 'sort=date');

  const billById = {};
  bills.forEach(bill => billById[bill.id] = bill);

  const customersRows = customers.map(customer => [
    customer.name || '',
    Number(customer.opening_balance || 0),
  ]);

  const billRows = billItems.map(item => {
    const bill = billById[item.bill] || {};
    return [
      Number(bill.book_no || 0),
      Number(bill.bill_no || 0),
      String(bill.date || '').slice(0, 10),
      bill.customer_name || '',
      Number(bill.mkt || 0),
      item.item_name || '',
      Number(item.qty || 0),
      Number(item.rate || 0),
      Number(item.amount || 0),
      Number(bill.transport || 0),
      Number(item.bags || 0),
      Number(bill.gst_rate || 0),
      Number(bill.gst_amount || 0),
      bill.lr_no || '',
    ];
  });

  const paymentRows = payments.map(payment => [
    String(payment.date || '').slice(0, 10),
    payment.customer_name || '',
    Number(payment.amount || 0),
    payment.mode || '',
    payment.note || '',
  ]);

  return {
    Bill_Items: billRows,
    Payments: paymentRows,
    Customers: customersRows,
  };
}

/**
 * Adapter for the current v5 code.
 * In code.gs, replace:
 *   const billing = SpreadsheetApp.openById(BILLING_SHEET_ID);
 *   const billRows = readRows_(billing, 'Bill_Items');
 *   const payRows = readRows_(billing, 'Payments');
 *   const custRows = readRows_(billing, 'Customers');
 *
 * With:
 *   const pbRows = fetchPartySummaryRowsFromPocketBase_();
 *   const billRows = pbRows.Bill_Items;
 *   const payRows = pbRows.Payments;
 *   const custRows = pbRows.Customers;
 */
