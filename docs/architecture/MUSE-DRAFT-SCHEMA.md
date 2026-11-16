# Muse draft API contract

**Audience:** Muse integration. This copy contains draft APIs only. The owner reviews drafts in `/drafts`; no draft field triggers direct save.

| Environment | PocketBase API base | State |
| :--- | :--- | :--- |
| Arch DEV, local | `http://127.0.0.1:8090/api/` | Development and testing |
| Arch DEV, Tailscale/Caddy | `http://100.66.74.78:4174/pb/api/` | Development and testing |
| Windows PROD, local Caddy | `http://127.0.0.1:4174/pb/api/` | Later production deployment; not the current Arch runtime |

Authenticate as a normal `users` collection agent with `POST /api/collections/users/auth-with-password`; send the returned bearer token for record calls. Credentials are supplied separately. Never use an administrator identity. Use a unique `source_message_id` for each proposed Purchase/Casting record; `(created_by, source_message_id)` is unique. The server derives `created_by` from authentication.

## Access and lifecycle

- Muse may read `customers`, `items`, `brass_rates`, `suppliers`, `purchase_items`, and `casting_materials` to match names. Match only within the module; exact name or alias, never fuzzy or cross-module.
- Muse creates and edits its **own pending** drafts. The operator approves by saving a live record in the editor. Muse cannot set `status` to `approved` or set `converted_*`.
- Never write live bills, payments, sessions, stock, or master records. The current `stock_*` API permissions are too broad; this is a known issue, not permission to use them.
- `direct_save` is a stored boolean only on Purchase payment and Casting session drafts. It never bypasses owner review. Other draft collections do not have that field.
- All examples below are payloads inside a draft record. Each record also needs `schema_version`, `status: "pending_review"`, `source_message_id`, `raw_text`, and optionally `confidence` (0–1) and `notes`.

| Draft collection | Payload version | Converted field | `direct_save` |
| :--- | :--- | :--- | :--- |
| `bill_drafts` | Sales fields on record | `converted_bill` → `bills` | Not present |
| `payment_drafts` | Sales fields on record | `converted_payment` → `payments` | Not present |
| `purchase_bill_drafts` | 2 | `converted_bill` → `purchase_bills` | Not present |
| `purchase_payment_drafts` | 1 | `converted_payment` → `supplier_payments` | Stored only |
| `casting_session_drafts` | 1 | `converted_session` → `casting_sessions` | Stored only |

Sales bill details go in `bill_draft_items` and `bill_draft_payments`, linked by `draft`; these child tables have no `converted_*` or `direct_save` field. Sales payment drafts use `Cash` or `Bank`. Use a 15-character lowercase alphanumeric ID if supplying an ID, for example `drftsales000001`.

## Purchase bill v2

Decimal inputs are **strings**. The app converts them to integer `weight_g`, `rate_milli`, and `amount_paise` and assigns `in_no` only on save. `pool` defaults to `kacha`; GST-pool tax defaults to `gst`. Do not include premium versus vilaity.

```json
{
  "supplier_name": "Shreeji Metal Traders",
  "supplier_id": "k6zau2drgza3182",
  "date": "2026-11-15",
  "pool": "kacha",
  "tax_mode": "none",
  "supplier_bill_no": "SMT-225",
  "private_note": "Weighed at intake",
  "lines": [{
    "item_name": "Brass Scrap",
    "item_id": "4342rp64js3im3e",
    "weight_kg": "90.500",
    "rate_rs_per_kg": "395.000",
    "amount_rs": "35747.50",
    "receipt_memo": "Two bags received"
  }],
  "adjustments": [{ "type": "quality_cut", "amount_rs": "100.00", "note": "Moisture" }],
  "bardan": [{ "weight_kg": "2.000", "rate_line_index": 0, "rate_rs_per_kg": "395.000", "method": "deduct", "credit_rs": "790.00" }],
  "payment": { "amount_rs": "5000.00", "mode": "neft", "reference": "UTR12345" }
}
```

Optional fields include `gst_rate_bp`, `vehicle_no`, `stated_total_rs`, and line/bardan notes. Allowed tax modes: `none`, `gst`, `rcm`; allowed on-bill payment modes: `cash`, `upi`, `rtgs`, `neft`, `cheque`, `other`; adjustment types: `labour`, `transport`, `quality_cut`, `other`; bardan methods: `deduct`, `in_kind`, `cash_back`, `advance`. Keep `private_note` free of the reserved `[bags_at_receipt:...]` token: the editor strips that syntax and may discard literal note text. Owner must verify GST pool and tax selection.

## Purchase payment v1

```json
{
  "supplier_name": "Shreeji Metal Traders",
  "supplier_id": "k6zau2drgza3182",
  "date": "2026-11-15",
  "pool": "kacha",
  "kind": "payment",
  "amount_rs": "90000.00",
  "mode": "neft",
  "reference": "UTR98765",
  "payee": "Shreeji Metal Traders",
  "note": "On account",
  "bill_pins": ["billpin00000001"]
}
```

Only four draft kinds: `payment`, `paid_on_behalf`, `settle_off`, `refund_received`. `bardan_advance` is generated from bill entries and is not accepted here. `pool` defaults to `kacha`; `mode` has no default and the owner must select it if absent. `amount_rs` is a decimal string with at most two decimals. Pins must belong to the same pool.

## Casting session v1

```json
{
  "date": "2026-11-15",
  "note": "Morning furnace",
  "coal_kg": "25.000",
  "coal_rate_rs": "11.500",
  "worker_salary_rs": "2500.00",
  "batches": [{
    "inputs": [{ "material_name": "Brass Scrap Extra Clean", "material_id": "h77xx6e633bpk2x", "qty_kg": "410.000", "rate_rs_per_kg": "725.000" }],
    "wire_out_kg": "398.000",
    "mel_kg": "12.000"
  }]
}
```

Preserve batch order. Use Casting material names or aliases only. Unmatched materials require owner selection. Costs, yield and wastage are computed in the app; never stage a live session directly.
