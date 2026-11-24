# Muse — shared Kapil gateway, Sales module

Use the same private HTTPS base URL and secure `X-API-Key` connection you use for [Purchase](MUSE-PURCHASE-PLAYBOOK.md). Keep the old direct PocketBase Sales workflow available until the owner verifies one lookup and one genuine draft on this gateway. There is no Casting API. Do not send keys or passwords in chat.

## Reads

| Endpoint | Request and response |
| --- | --- |
| `GET /v1/modules` | Gateway capability discovery. Sales and Purchase are independent modules. Casting is disabled. |
| `GET /v1/sales/health` | Confirms the key and access to Sales data. `draftsConfigured` checks writer configuration, not migration completion. |
| `GET /v1/sales/customer?customer=sambhu` | Exact name, alias or ID. Returns canonical name, ID and active status. Do not guess between ambiguous masters or use Purchase supplier IDs. |
| `GET /v1/sales/customers?q=sambhu&page=1` | Searchable customer master list, 25 per page. Omit `q` for everybody. Active only unless `includeInactive=true`. Misspelled exact lookups can return suggested candidates; they are not automatic matches. |
| `GET /v1/sales/item?name=sp` | Exact Sales item, alias or ID. Returns ID, canonical name, type, unit, and bag weight. Do not use Purchase item IDs. |
| `GET /v1/sales/dues?customer=sambhu&asOf=2026-11-24` | Both query parameters are optional. Default date is today in India. `customers[]` reports billed, paid, net, receivable and advances. A single-customer query also reports the New Bill cutoff context in `billPreviewBalance`: previous balance date and amount, eligible credits and credits total. Current receivable can differ from that cutoff context if an existing bill was dated on the as-of day. |
| `GET /v1/sales/drafts/status?type=bill&sourceId=sale-101` | Check ownership-scoped draft status. `type` is `bill` or `payment`. Review and final posting happen in Kapil. |
| `GET /v1/sales/drafts` | Own pending Sales proposals, newest first, 25 per page. Optionally filter on `type=bill` or `payment`; pass `nextCursor` as `cursor` to continue. New-customer bills appear in type `bill` with action `new_customer_bill`. |

All Sales money is in **rupees**, unlike Purchase response amounts ending in `Paise`. Don't net customer receivables with supplier payables.

## Bill preview and staging

Use `POST /v1/sales/preview/bill` without writing, or `POST /v1/sales/drafts/bill` to stage a draft. Send JSON:

```json
{
  "sourceId": "sale-101",
  "originalMessage": "Example only: one bag Spindle for Sambhu",
  "payload": {
    "customer": "sambhu",
    "date": "2026-11-24",
    "gst_mode": "none",
    "confidence": 0.95,
    "items": [{ "item": "sp", "qty": 1, "unit": "bags" }]
  }
}
```

- Set the actual business date explicitly (use today's India date if the owner didn't give another date). Use numeric values, not numbered strings. Gas items require `bags` or `kg`; electronics require `piece`. The server converts bags using the saved item bag weight. Do not guess quantities.
- When the owner gives a market override, use `mkt`. Otherwise, use the saved Vilaity rate on that date or the closest earlier saved rate. If no valid market rate exists for a gas item, ask.
- Specify `rate` only for an explicit final rate, or `default_rate` only for an explicit gas differential. Otherwise the server uses the same rate suggestion as the app: last saved customer/item final rate relative to that bill's own market rate, or the item default if there is no usable history. Electronic items use a unit price. Use the returned rate source and history to explain the result.
- Optional header fields: `transport`, `lr_no`, `notes`, `book_no`, `bill_no`. Omit book/bill to let the owner workflow assign them. If setting `bill_no`, include its `book_no`; preview checks the range and whether the number is already used, but doesn't reserve it.
- GST uses `gst_mode: "none"`, `"percent18"`, or `"manual"`; send `gst_amount` only with manual. The current bill total is different from final due. Show **Previous Balance + current bill − Credits = final due**. If a result is negative, show the advance.
- Optional `payments` array: `{ "amount": 5000, "mode": "Cash" }`, with optional `note` or same-day `date`. Use a standalone payment proposal for another date. Never stage the same receipt twice.

Preview returns `previewToken`. When staging the same preview, add that token at the top level, beside `sourceId`. If price, balance, or other displayed values change, a `409 PREVIEW_CHANGED` returns a fresh preview and token **without staging**. Show the change before continuing.

## Standalone receipt

Use `POST /v1/sales/preview/payment`, then `POST /v1/sales/drafts/payment` when the owner asked to record it. Use the same envelope, with:

```json
{
  "sourceId": "receipt-201",
  "originalMessage": "Example only: received 5000 cash from Sambhu",
  "payload": {
    "customer": "sambhu",
    "date": "2026-11-24",
    "amount": 5000,
    "mode": "Cash",
    "note": "On account"
  }
}
```

Use `Cash` or `Bank`, optional `note` and `confidence`. Preview shows current due, proposed receipt and resulting due or advance. The draft does not mutate the ledger.

## New customer and first bill

Search the customer master first. On an explicit request to create a genuinely new customer, send **`POST /v1/sales/customer`**, body `{"sourceId":"msg-104:customer","name":"Demo One"}`. The returned `id` refers to the actual customer with zero opening balance. Then use the normal bill preview and stage routes with a different source ID. The customer stays even if the bill draft is rejected. The old combined `new-customer-bill` type remains supported for earlier proposals; prefer the two-step flow.

## Clear validation and safe retries

- The connector rejects unknown fields. **Use `mkt`, not `mkt_rate`. Omit `converted_bill` and `converted_payment`**, even if empty. Use confidence from 0 to 1 (e.g. `0.95`, never `95`).
- Use one stable source ID (letters, numbers, colon, underscore, period, slash or hyphen; max 160 characters) for one intended entry. Same ID and same input returns the existing draft, even if the market changed or the first response timed out. Same ID with changed input returns `409 SOURCE_ALREADY_USED`. Do not bypass that with a new ID.
- Successful draft responses include an ID, status, reuse flag, and `posted: false`. The initial save also returns the staged preview. If a write times out, check the status endpoint before retrying with the same ID. Final posting still requires the owner in AI Drafts or the Sales editor.
- If the gateway reports `SALES_DRAFT_STORAGE_UNAVAILABLE`, the owner needs to apply the Windows update that includes migration `1794640018`. Do not change the old Sales connector to get around it.
