# Kapil Billing — Database Schema & Data Dictionary

> **Documented schema reference** for primary collections, relations, data models, and sample payloads. This is not an exhaustive PocketBase export.
> **Audience:** AI Coding Assistants, Integration Agents (Muse), and Backend Developers.
> **Database Engine:** PocketBase (backed by SQLite with WAL mode enabled).
> **Host Environment:** Arch Linux DEV (`feat/muse-integration`); Windows PROD is the later deployment target.
> **Companion Documents:** [CURRENT-STATE.md](CURRENT-STATE.md), [AGENTS.md](../../AGENTS.md).

---

## 1. Network Endpoints & Authentication

All external agents (including Muse AI) communicate with PocketBase over HTTP/JSON:

| Connection Context | Base URL | Auth Endpoint |
| :--- | :--- | :--- |
| **Arch DEV (local PocketBase)** | `http://127.0.0.1:8090/api/` | `POST /api/collections/users/auth-with-password` |
| **Arch DEV (Tailscale/Caddy)** | `http://100.66.74.78:4174/pb/api/` | `POST /pb/api/collections/users/auth-with-password` |
| **Windows PROD (planned, local Caddy)** | `http://127.0.0.1:4174/pb/api/` | `POST /pb/api/collections/users/auth-with-password` |

### How an Agent Authenticates
The URL below is an **Arch DEV** example. Windows PROD is a later deployment target.
```http
POST http://100.66.74.78:4174/pb/api/collections/users/auth-with-password
Content-Type: application/json

{
  "identity": "muse@kapil.cosearch.me",
  "password": "<provided out of band>"
}
```
*Returns a JSON response containing `"token"`. All subsequent requests must provide `Authorization: Bearer <token>`.*

---

## 2. Inviolable Architectural & Financial Rules

Any AI agent interacting with this database **MUST STRICTLY OBEY** these four rules:

### Rule 1: Strict Three-Module Isolation
Sales, Purchase, and Casting are completely separate operational data worlds.
- **Separate Items Tables:** `items` (Sales only), `purchase_items` (Purchase only), `casting_materials` (Casting only). Even if an item shares the identical string name (e.g. *"Brass Scrap"*), **NEVER** link them by foreign key, ID, or name heuristic.
- **Separate Party Tables:** `customers` (Sales outbound receivables) and `suppliers` (Purchase inward payables). **NEVER** net or combine balances across customers and suppliers into a single net figure.

### Rule 2: Dual Monetary Precision Standard
- **Sales Module:** Floating-point Indian Rupees (`rate`, `subtotal`, `grand_total`, `gst_amount`) with standard half-up rounding. Quantities in decimal kg.
- **Purchase Module:** High-precision integer Paise and Milli-rupees:
  - `weight_g`: integer grams ($1\text{ kg} = 1,000\text{ g}$).
  - `rate_milli`: integer milli-rupees per kg ($₹450.50/\text{kg} = 450,500\text{ milli-rupees}$).
  - `amount_paise`: integer paise ($₹1.00 = 100\text{ paise}$).
  - **NEVER convert purchase money or weights to floating-point numbers.**
- **Casting Module:** Decimal kg for metal/coal inputs and wire output; decimal Rupees for worker wages, coal rate, and loaded cost per kg.

### Rule 3: Purchase Dual Balance Pools (`kacha` vs `gst`)
- In the Purchase module, suppliers maintain two strictly isolated balance pools: `kacha` (unbilled/cash pool) and `gst` (tax-invoice pool).
- Payments and FIFO debt allocations **never cross pools**. A `kacha` payment can only settle `kacha` bills; a `gst` payment can only settle `gst` bills.

### Rule 4: Muse AI Staging Constraint
- External AI workers (Muse) write **ONLY** to draft collections (`bill_drafts`, `payment_drafts`, `purchase_bill_drafts`, `purchase_payment_drafts`, `casting_session_drafts`).
- External AI workers have **ZERO DIRECT WRITE ACCESS** to live financial tables (`bills`, `payments`, `purchase_bills`, `supplier_payments`, `casting_sessions`). All drafts must be approved by the human owner in `/drafts`.

---

## 3. Documented Collection Directory (35 collections)

This directory includes the 32 existing entries plus the three `stock_*` collections; it excludes PocketBase system collections and other legacy collections.

**Current Arch DEV stock access:** `1792914000_restore_public_rules_rates_stock.js` leaves list, view, create, update, and delete rules empty for all three `stock_*` collections. Anonymous GET returned HTTP 200 for each during this read-only check. This also permits Muse access by rule; Muse must not use it. Closing the rules requires an operator-app authentication plan because existing UI paths may rely on anonymous access.

| Module | Table Name | Type | Purpose | Primary Relations |
| :--- | :--- | :--- | :--- | :--- |
| **Sales** | `customers` | Base | Customer master records & opening balance | None |
| **Sales** | `items` | Base | Finished brass hardware item master | None |
| **Sales** | `bills` | Base | Outbound sales invoice headers | `customer` $\rightarrow$ `customers` |
| **Sales** | `bill_items` | Base | Individual line items on sales bills | `bill` $\rightarrow$ `bills`, `item` $\rightarrow$ `items` |
| **Sales** | `payments` | Base | Customer payment receipts | `customer` $\rightarrow$ `customers` |
| **Sales** | `brass_rates` | Base | Historical Jamnagar brass market rate benchmarks | None |
| **Sales (Drafts)**| `bill_drafts` | Base | AI-staged bill headers awaiting owner approval | `customer` $\rightarrow$ `customers`, `converted_bill` $\rightarrow$ `bills` |
| **Sales (Drafts)**| `bill_draft_items`| Base | AI-staged bill line items | `draft` $\rightarrow$ `bill_drafts`, `item` $\rightarrow$ `items` |
| **Sales (Drafts)**| `bill_draft_payments`| Base | AI-staged quick bill-borne advances | `draft` $\rightarrow$ `bill_drafts`, `customer` $\rightarrow$ `customers` |
| **Sales (Drafts)**| `payment_drafts`| Base | AI-staged standalone receipts | `customer` $\rightarrow$ `customers`, `converted_payment` $\rightarrow$ `payments` |
| **Purchase** | `suppliers` | Base | Scrap brass supplier master & dual pool balances | None |
| **Purchase** | `purchase_items`| Base | Inward scrap material master | None |
| **Purchase** | `purchase_bills`| Base | Inward scrap lot intake chitty headers | `supplier` $\rightarrow$ `suppliers` |
| **Purchase** | `purchase_bill_lines` | Base | Weight & rate lines on purchase bills | `bill` $\rightarrow$ `purchase_bills`, `item` $\rightarrow$ `purchase_items` |
| **Purchase** | `purchase_bill_adjustments` | Base | Price/rate adjustments on purchase bills | `bill` $\rightarrow$ `purchase_bills` |
| **Purchase** | `purchase_bardan` | Base | Gunny bag (bardan) weight & settlement entries | `bill` $\rightarrow$ `purchase_bills`, `rate_line` $\rightarrow$ `purchase_bill_lines` |
| **Purchase** | `supplier_payments` | Base | Outward payments made to scrap suppliers | `supplier` $\rightarrow$ `suppliers` |
| **Purchase** | `supplier_payment_allocations` | Base | Explicit pins between payments and purchase bills | `payment` $\rightarrow$ `supplier_payments`, `bill` $\rightarrow$ `purchase_bills` |
| **Purchase** | `purchase_audit_log` | Base | Immutable append-only audit trail for purchase writes | None |
| **Purchase (Drafts)**| `purchase_bill_drafts` | Base | AI-staged inward scrap purchase proposals | `converted_bill` $\rightarrow$ `purchase_bills` |
| **Purchase (Drafts)**| `purchase_payment_drafts` | Base | AI-staged supplier payout proposals | `converted_payment` $\rightarrow$ `supplier_payments` |
| **Casting** | `casting_materials` | Base | Foundry raw scrap materials for furnace charging | None |
| **Casting** | `casting_sessions` | Base | Daily foundry melting session headers | None |
| **Casting** | `casting_batches` | Base | Individual furnace heats/runs within a session | `session` $\rightarrow$ `casting_sessions` |
| **Casting** | `casting_batch_inputs` | Base | Raw metal inputs charged into a heat | `batch` $\rightarrow$ `casting_batches`, `material` $\rightarrow$ `casting_materials` |
| **Casting (Drafts)** | `casting_session_drafts` | Base | AI-staged foundry heat logs | `converted_session` $\rightarrow$ `casting_sessions` |
| **Core / Settings**| `app_settings` | Base | Global module toggles (`purchase_enabled`, `casting_enabled`) | None |
| **Core / Settings**| `users` | Auth | Operator (`operator`) and Muse AI (`muse`) credentials | None |
| **Core / Settings**| `saved_views` | Base | User-configured filters and column preferences | None |
| **Stock (legacy)** | `stock_in` | Base | Stock intake records; not linked automatically to Purchase drafts | None |
| **Stock (legacy)** | `stock_adjustments` | Base | Manual stock corrections | None |
| **Stock (legacy)** | `stock_openings` | Base | Opening stock records | None |

---

## 4. Module 1: Sales Billing Data Dictionary

### `customers`
Customer master directory representing buyers of finished brass hardware.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `name` (`text`, required): Contact person name.
  * `company_name` (`text`): Business firm / trade name.
  * `active` (`bool`, default `true`): Soft-delete flag (customers are never hard deleted).
  * `opening_balance` (`number`): Initial ledger receivable (+) or credit (-) in Rupees.
  * `opening_balance_date` (`date`): Date of opening balance.
  * `cust_type` (`select`: `gas` | `electronic`): Primary customer category.
  * `aliases` (`text`): Comma-separated voice dictation match strings.
* **Sample Record:**
```json
{
  "id": "uwt2t6db7lxy40h",
  "name": "Akash Patel",
  "company_name": "A.S Patel",
  "active": true,
  "opening_balance": 0,
  "opening_balance_date": "",
  "cust_type": "gas",
  "aliases": "akash, akash patel, as patel, a.s patel, a.s. patel",
  "created": "2026-04-27 00:00:00.000Z",
  "updated": "2026-07-03 13:42:38.714Z"
}
```

---

### `items`
Master catalog of finished brass hardware manufactured and sold.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `name` (`text`, required): Standard title case item name.
  * `default_rate` (`number`): Suggested sales rate in Rupees.
  * `type` (`text`: `gas` | `electronic`): Hardware type.
  * `unit` (`text`: `kg` | `pcs` | `bags`): Pricing unit.
  * `bag_weight` (`number`): Standard weight per gunny bag in kg (e.g. 50 kg).
  * `group` (`text`): Product category (e.g. `"Spindle"`).
  * `aliases` (`text`): Voice match strings.
  * `active` (`bool`, default `true`): Deactivation flag (hard-delete blocked if used in bills).
* **Sample Record:**
```json
{
  "id": "w8mkzbh342pwpwd",
  "name": "Spindle (8.5GM)",
  "default_rate": 110,
  "type": "gas",
  "unit": "kg",
  "bag_weight": 50,
  "group": "Spindle",
  "aliases": "spindle 8.5, sp 8.5, 8.5gm, 8.5 gm, spindle 8.5g, 8.5",
  "active": true,
  "created": "2026-04-27 00:00:00.000Z",
  "updated": "2026-07-03 13:42:38.714Z"
}
```

---

### `bills`
Outbound sales invoice headers. Each physical bill book holds exactly 50 bills (Book 1: 1–50, Book 51: 51–100).
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `book_no` (`number`, required): Physical book number (1, 51, 101...).
  * `bill_no` (`number`, required): Consecutive bill number.
  * `bill_ref` (`text`): Formatted sequence reference (e.g. `"51/77"`).
  * `date` (`date`, required): Business invoice date.
  * `customer` (`relation` $\rightarrow$ `customers`, required)
  * `customer_name` (`text`): Snapshot of customer company name at billing.
  * `mkt` (`number`): Applicable Vilaity brass market benchmark rate.
  * `transport` (`number`): Freight charges added to bill (Rupees).
  * `gst_rate` (`number`): GST percentage (`0` or `18`).
  * `gst_amount` (`number`): Total GST calculated in Rupees.
  * `lr_no` (`text`): Transport Lorry Receipt (LR) number.
  * `status` (`text`: `pending` | `partial` | `paid`): Computed payment status.
  * `bill_jpg` (`file`): Rendered bill invoice JPG snapshot.
* **Sample Record:**
```json
{
  "id": "p5og3wc8y7c9083",
  "book_no": 51,
  "bill_no": 77,
  "bill_ref": "51/77",
  "date": "2026-04-27 00:00:00.000Z",
  "customer": "uwt2t6db7lxy40h",
  "customer_name": "A.S Patel",
  "mkt": 505,
  "transport": 0,
  "gst_rate": 18,
  "gst_amount": 76320,
  "lr_no": "LR-4412",
  "status": "paid",
  "accounting_time": "18:00",
  "created": "2026-04-27 00:00:00.000Z",
  "updated": "2026-06-17 08:26:26.412Z"
}
```

---

### `bill_items`
Line items associated with a sales invoice.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `bill` (`relation` $\rightarrow$ `bills`, required)
  * `item` (`relation` $\rightarrow$ `items`): Link to item master.
  * `item_name` (`text`, required): Snapshot of item name.
  * `qty` (`number`, required): Quantity sold (kg or pcs).
  * `bags` (`number`): Number of bags.
  * `rate` (`number`, required): Price per unit in Rupees.
  * `amount` (`number`, required): Total row amount (`qty * rate`).
* **Sample Record:**
```json
{
  "id": "1arcozh14uyfmbt",
  "bill": "p5og3wc8y7c9083",
  "item": "w8mkzbh342pwpwd",
  "item_name": "Spindle (8.5GM)",
  "qty": 100,
  "bags": 2,
  "rate": 878,
  "amount": 87800
}
```

---

### `payments`
Customer payment receipts (inward cash or bank payments).
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `customer` (`relation` $\rightarrow$ `customers`, required)
  * `customer_name` (`text`): Snapshot of customer name.
  * `date` (`date`, required): Receipt date.
  * `amount` (`number`, required): Amount received in Rupees.
  * `mode` (`text`: `Cash` | `Bank`): Payment instrument.
  * `note` (`text`): Transaction note (e.g. `"Receipt via Muse 2026-10-24 - RTGS"`).
* **Sample Record:**
```json
{
  "id": "9tjhvy1c6lkrsim",
  "customer": "uwt2t6db7lxy40h",
  "customer_name": "A.S Patel",
  "date": "2026-04-23 00:00:00.000Z",
  "amount": 100000,
  "mode": "Bank",
  "note": "RTGS receipt from SBI account",
  "created": "2026-04-23 00:00:00.000Z",
  "updated": "2026-06-17 08:26:26.412Z"
}
```

---

### `brass_rates`
Daily benchmark market rates published by the Jamnagar brass commercial exchange.
* **Key Fields:** `date`, `vilaity` (official billing market benchmark), `honey_gulf`, `honey_europe`, `plant_pass`, `zinc_9995`, `delhi_honey`, `armature`, `mcx_copper`, `mcx_zinc`, `lme_3m`, `usd_inr`.
* **Sample Record:**
```json
{
  "id": "94m547m67d643d9",
  "date": "2026-10-24 00:00:00.000Z",
  "vilaity": 505,
  "honey_gulf": 490,
  "honey_europe": 485,
  "plant_pass": 520,
  "zinc_9995": 285,
  "source": "telegram",
  "note": "Market steady post-Diwali"
}
```

---

### `bill_drafts` & `payment_drafts` (Sales Draft Staging)
Staging tables where Muse AI posts parsed WhatsApp messages and scan dictations.
* **`bill_drafts` Fields:** `customer`, `customer_name`, `created_by`, `book_no`, `bill_no`, `date`, `mkt`, `transport`, `gst_mode`, `gst_rate`, `lr_no`, `status` (`pending_review` | `approved` | `rejected`), `notes`, `raw_text`, `confidence`, `bill_total`, `converted_bill` (relation to `bills`); `direct_save` is **not a field**.
* **`bill_draft_items` Fields:** `draft` (relation to `bill_drafts`), `item`, `item_name`, `qty`, `bags`, `rate`, `amount`.
* **`payment_drafts` Fields:** `customer`, `customer_name`, `date`, `amount`, `mode` (`Cash` | `Bank`), `note`, `raw_text`, `confidence`, `status`, `converted_payment` (relation to `payments`); `direct_save` is **not a field**.
* **Sample `bill_drafts` Record:**
```json
{
  "id": "drftsales000001",
  "customer_name": "A.S Patel",
  "date": "2026-10-24",
  "book_no": 51,
  "bill_no": 78,
  "mkt": 505,
  "transport": 250,
  "gst_mode": "percent18",
  "gst_rate": 18,
  "status": "pending_review",
  "confidence": 0.98,
  "notes": "A.S Patel 2 bags spindle",
  "raw_text": "Akash bhai ko 2 bag spindle 8.5 bheje bill 78 transport 250",
  "converted_bill": ""
}
```

---

## 5. Module 2: Purchase / Procurement Data Dictionary

### `suppliers`
Master catalog of scrap metal traders, ragpickers, and corporate vendors.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `company_name` (`text`, required): Trading name of supplier.
  * `aliases` (`text`, optional): Alternate names for exact or alias matching within Purchase only.
  * `contact_name` (`text`): Individual contact person.
  * `phone` (`text`): Phone / WhatsApp number.
  * `gst_no` (`text`): GSTIN (if registered for GST).
  * `city` (`text`): City / location (e.g. `"Rajkot"`, `"Jamnagar"`).
  * `notes` (`text`): Internal operational notes.
  * `opening_kacha_paise` (`number`, integer paise): Initial balance in Kacha pool.
  * `opening_gst_paise` (`number`, integer paise): Initial balance in GST pool.
  * `opening_balance_date` (`text`, YYYY-MM-DD): Cutoff date.
  * `active` (`bool`, default `true`): Deactivation flag.
* **Sample Record:**
```json
{
  "id": "k6zau2drgza3182",
  "company_name": "Shreeji Metal Traders",
  "aliases": "Shreeji Metals\nShreeji Traders",
  "contact_name": "Jignesh Patel",
  "phone": "+91 98250 12345",
  "gst_no": "24ABCDE1234F1Z5",
  "city": "Rajkot",
  "notes": "Main kacha supplier — weekly pickup.",
  "opening_kacha_paise": 15000000,
  "opening_gst_paise": 0,
  "opening_balance_date": "2026-04-01",
  "active": true
}
```

---

### `purchase_items`
Master catalog of scrap raw materials purchased for foundry melting.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `name` (`text`, required): Normalized Title Case scrap item name (e.g. `"Brass Scrap"`).
  * `aliases` (`text`): Voice dictation match strings.
  * `active` (`bool`, default `true`): Deactivation flag.
* **Sample Record:**
```json
{
  "id": "4342rp64js3im3e",
  "name": "Brass Scrap",
  "aliases": "scrap, peetal scrap, honey scrap",
  "active": true
}
```

---

### `purchase_bills`
Inward intake lot headers (referred to physically as *Chitty*).
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `supplier` (`relation` $\rightarrow$ `suppliers`, required)
  * `in_no` (`text`, required, unique): Financial Year inward reference (e.g. `"IN-2627-0001"`).
  * `supplier_bill_no` (`text`): Vendor's printed invoice or challan number.
  * `date` (`text`, YYYY-MM-DD, required): Intake date.
  * `pool` (`select`: `kacha` | `gst`, required): Dedicated balance pool.
  * `tax_mode` (`select`: `none` | `regular` | `rcm`, required): GST treatment mode.
  * `gst_rate_bp` (`number`, basis points): Tax rate ($18\% = 1800\text{ bp}$, $5\% = 500\text{ bp}$).
  * `vehicle_no` (`text`): Transport truck or tempo registration number.
  * `private_note` (`text`): Internal memos, benchmark premium vs vilaity notes.
  * `photos` (`file` array): Scans or photos of physical slips.
  * `cancelled` (`bool`, default `false`): Cancellation flag (sequence number stays burned).
  * `cancel_reason` (`text`): Explanation if cancelled.
* **Sample Record:**
```json
{
  "id": "3uf5wq4lsjhn3cv",
  "supplier": "k6zau2drgza3182",
  "in_no": "IN-2627-0001",
  "supplier_bill_no": "CH-8819",
  "date": "2026-08-12",
  "pool": "kacha",
  "tax_mode": "none",
  "gst_rate_bp": 0,
  "vehicle_no": "GJ-10-TX-4402",
  "private_note": "[bags_at_receipt:28.500]\nWeighbridge slip confirmed by godown supervisor.",
  "photos": [],
  "cancelled": false,
  "cancel_reason": ""
}
```

---

### `purchase_bill_lines`
Individual weight and rate line items on a purchase bill. All units are strict integers.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `bill` (`relation` $\rightarrow$ `purchase_bills`, required)
  * `item` (`relation` $\rightarrow$ `purchase_items`): Link to scrap item.
  * `item_name` (`text`, required): Name snapshot.
  * `weight_g` (`number`, integer grams, required): Weight ($850.5\text{ kg} = 850,500\text{ g}$).
  * `rate_milli` (`number`, integer milli-rupees, required): Rate ($₹712.00/\text{kg} = 712,000\text{ milli-rupees}$).
  * `amount_paise` (`number`, integer paise, required): Total line amount ($₹605,556.00 = 60,555,600\text{ paise}$).
* **Sample Record:**
```json
{
  "id": "cxdonkuymif1120",
  "bill": "3uf5wq4lsjhn3cv",
  "item": "4342rp64js3im3e",
  "item_name": "Brass Scrap",
  "weight_g": 850500,
  "rate_milli": 712000,
  "amount_paise": 60555600
}
```

---

### `purchase_bill_adjustments`
Rate and value adjustments applied to a purchase bill (e.g. moisture cut, dross deduction).
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `bill` (`relation` $\rightarrow$ `purchase_bills`, required)
  * `type` (`select`: `deduction` | `addition`, required)
  * `amount_paise` (`number`, integer paise, required)
  * `note` (`text`): Description of reason.
* **Sample Record:**
```json
{
  "id": "adj991827410291",
  "bill": "3uf5wq4lsjhn3cv",
  "type": "deduction",
  "amount_paise": 150000,
  "note": "Moisture & dust deduction (15 kg equivalent)"
}
```

---

### `purchase_bardan`
Settlement of gunny bags (bardan) used to transport scrap metal.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `bill` (`relation` $\rightarrow$ `purchase_bills`, required)
  * `bardan_g` (`number`, integer grams): Total bag tare weight ($28.5\text{ kg} = 28,500\text{ g}$).
  * `rate_line` (`relation` $\rightarrow$ `purchase_bill_lines`): Line whose rate is used for credit.
  * `rate_milli` (`number`, integer milli-rupees): Applied rate per kg.
  * `method` (`select`: `deduct` | `in_kind` | `cash_back` | `advance`, required):
    * `deduct`: Value credited against bill payable (`credit_paise = (bardan_g * rate_milli) / 10000`).
    * `in_kind`: Empty bags returned physically; zero monetary impact.
    * `cash_back`: Memo noting driver took cash for bags; zero impact on payable.
    * `advance`: Creates an advance credit inside the bill's pool.
  * `credit_paise` (`number`, integer paise)
  * `cash_amount_paise` (`number`, integer paise)
  * `note` (`text`): Operational memo.
* **Sample Record:**
```json
{
  "id": "bar019283847210",
  "bill": "3uf5wq4lsjhn3cv",
  "bardan_g": 28500,
  "rate_line": "cxdonkuymif1120",
  "rate_milli": 712000,
  "method": "deduct",
  "credit_paise": 2029200,
  "cash_amount_paise": 0,
  "date": "2026-08-12",
  "note": "28 bags credited at brass line rate"
}
```

---

### `supplier_payments`
Outward payments disbursed to scrap suppliers.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `supplier` (`relation` $\rightarrow$ `suppliers`, required)
  * `date` (`text`, YYYY-MM-DD, required): Payment date.
  * `pool` (`select`: `kacha` | `gst`, required): Must match bill pool.
  * `kind` (`select`, required):
    * `payment`: Standard bank or cash payment (reduces payable).
    * `paid_on_behalf`: Paid third-party driver/labor for vendor (reduces payable).
    * `settle_off`: Small-change write-off (reduces payable).
    * `refund_received`: Vendor refunded us cash/cheque (increases payable).
    * `bardan_advance`: Bag credit consumed by FIFO within pool.
  * `amount_paise` (`number`, integer paise, required)
  * `mode` (`select`: `cash` | `bank` | `other`, required)
  * `reference` (`text`): Cheque number, UTR, or NEFT reference.
  * `payee_name` (`text`): Person who received the cash/funds.
  * `private_note` (`text`): Confidential internal payment note.
* **Sample Record:**
```json
{
  "id": "vml4eqj0mioqnx6",
  "supplier": "k6zau2drgza3182",
  "date": "2026-09-18",
  "pool": "kacha",
  "kind": "payment",
  "amount_paise": 50000000,
  "mode": "bank",
  "reference": "AXISN09281729",
  "payee_name": "Jignesh Bhai",
  "private_note": "Part payment against August scrap bills",
  "cancelled": false
}
```

---

### `supplier_payment_allocations`
Explicit manual pins binding a supplier payment to specific purchase bills.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `payment` (`relation` $\rightarrow$ `supplier_payments`, required)
  * `bill` (`relation` $\rightarrow$ `purchase_bills`, required)
  * `amount_paise` (`number`, integer paise, required)
* **Sample Record:**
```json
{
  "id": "alloc8819203948",
  "payment": "vml4eqj0mioqnx6",
  "bill": "3uf5wq4lsjhn3cv",
  "amount_paise": 50000000
}
```

---

### `purchase_audit_log`
Append-only immutable audit trail automatically recorded on any purchase write.
* **Fields:** `id`, `collection` (`text`), `record_id` (`text`), `action` (`create` | `update` | `delete`), `before_json` (`text`), `after_json` (`text`), `actor` (`text`), `created` (`autodate`).

---

### `purchase_bill_drafts` & `purchase_payment_drafts` (JSON Drafts)
Versioned proposals. `created_by` is set from authentication, not trusted from the request body. `(created_by, source_message_id)` is unique within each collection. Only the owner converts a pending draft in an atomic save. `direct_save` has no active save behavior.

| Collection | Fields shared by both | Converted relation | `direct_save` |
| :--- | :--- | :--- | :--- |
| `purchase_bill_drafts` | `payload` (JSON), `schema_version` (integer), `status` (`pending_review` / `approved` / `rejected`), `created_by` (users relation), `source_message_id`, `raw_text`, `confidence`, `notes`, `created`, `updated` | `converted_bill` → `purchase_bills` | **Not present** |
| `purchase_payment_drafts` | Same shared fields | `converted_payment` → `supplier_payments` | Boolean, stored only |

**Purchase bill payload, `schema_version: 2` (human decimal strings):**
```json
{
  "supplier_name": "Shreeji Metal Traders",
  "supplier_id": "k6zau2drgza3182",
  "date": "2026-11-15",
  "pool": "kacha",
  "tax_mode": "none",
  "supplier_bill_no": "SMT-225",
  "vehicle_no": "GJ-10-TX-4402",
  "bags_at_receipt": "2.500",
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
The v2 parser converts strings to integer grams, milli-rupees, and paise. Omitted `pool` defaults to `kacha`; GST-pool `tax_mode` defaults to `gst`. Optional `bags_at_receipt` is a kg decimal string (up to three places) that populates the editor's bag-weight field. `vehicle_no`, `stated_total_rs`, `gst_rate_bp`, and notes may also be supplied. No `in_no` or market premium is accepted. Contradictory pool/tax modes and a reserved `[bags_at_receipt:...]` tag in `private_note` make the draft invalid.

**Purchase payment payload, `schema_version: 1`:**
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
Only four kinds are valid in drafts: `payment`, `paid_on_behalf`, `settle_off`, `refund_received`. Live `bardan_advance` is generated from bill entries and is not accepted in payment drafts. `pool` defaults to `kacha`; `mode` is optional and must be chosen by the owner before save.

**Private-note boundary:** Muse must send bag weight in `bags_at_receipt`, never inside `private_note`. The parser rejects the reserved tag, and the editor writes its internal bag metadata from the typed field.

---

## 6. Module 3: Casting & Melting Data Dictionary

### `casting_materials`
Master list of scrap brass, copper, and zinc materials charged into foundry melting pots.
* **Fields:** `id`, `name` (`text`, required), `code` (`text`), `category` (`text`), `is_active` (`bool`), `aliases` (`text`).
* **Sample Record:**
```json
{
  "id": "h77xx6e633bpk2x",
  "name": "Brass Scrap Extra Clean",
  "code": "BRS-CLN",
  "category": "Brass",
  "is_active": true,
  "aliases": "clean brass, extra clean"
}
```

---

### `casting_sessions`
Daily foundry shift / melting session headers tracking overall yield and unit cost.
* **Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `date` (`text`, YYYY-MM-DD, required): Melting date.
  * `unit` (`number`): Number of heats/batches run.
  * `coal_kg` (`number`): Hard coal consumed (kg).
  * `coal_rate` (`number`): Coal price per kg (Rupees).
  * `worker_salary` (`number`): Total foundry labor wage for the day (Rupees).
  * `total_input_kg` (`number`): Total metal charged across all heats (kg).
  * `total_wire_out` (`number`): Total wire / finished brass bars produced (kg).
  * `total_mel` (`number`): Melting loss / wastage (kg).
  * `cost_per_kg` (`number`): Loaded production cost per kg of wire output (Rupees).
  * `note` (`text`): Operational shift note.
* **Sample Record:**
```json
{
  "id": "l4216jhneh676r6",
  "date": "2026-06-07",
  "unit": 2,
  "coal_kg": 200,
  "coal_rate": 38,
  "worker_salary": 2400,
  "total_input_kg": 820,
  "total_wire_out": 795,
  "total_mel": 25,
  "cost_per_kg": 770.26,
  "note": "Morning heat run smooth. High yield."
}
```

---

### `casting_batches` & `casting_batch_inputs`
Detailed furnace heats and charged metal inputs:
* **`casting_batches` Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `session` (`relation` $\rightarrow$ `casting_sessions`, required)
  * `batch_number` (`number`, required): Sequential heat number within session (1, 2, 3...).
  * `wire_out` (`number`, kg, required): Usable brass output.
  * `mel` (`number`, kg, required): Melting loss.
* **`casting_batch_inputs` Fields:**
  * `id` (`text`, 15 chars, primary key)
  * `batch` (`relation` $\rightarrow$ `casting_batches`, required)
  * `material` (`relation` $\rightarrow$ `casting_materials`): Material link.
  * `material_name` (`text`, required): Material name snapshot.
  * `qty` (`number`, kg, required): Weight of metal charged into pot.
  * `rate` (`number`, Rupees/kg, required): Scrap cost per kg.
  * `amount` (`number`, Rupees, required): `qty * rate`.
* **Sample `casting_batches` Record:**
```json
{
  "id": "guczn9890gb9kp9",
  "session": "l4216jhneh676r6",
  "batch_number": 1,
  "wire_out": 398,
  "mel": 12
}
```
* **Sample `casting_batch_inputs` Record:**
```json
{
  "id": "yp7l40335pjg2z6",
  "batch": "guczn9890gb9kp9",
  "material": "h77xx6e633bpk2x",
  "material_name": "Brass Scrap Extra Clean",
  "qty": 410,
  "rate": 725,
  "amount": 297250
}
```


### `casting_session_drafts`
AI-staged foundry sessions. Fields: `payload` (JSON), `schema_version` (integer), `status` (`pending_review` / `approved` / `rejected`), `created_by` (users relation, auth-derived), `source_message_id` (unique per creator), `raw_text`, `confidence`, `notes`, `converted_session` (relation to `casting_sessions`), `direct_save` (boolean, stored only), `created`, `updated`.

**Casting session payload, `schema_version: 1`:**
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
All quantities and prices are decimal strings. Material matching is exact name or alias **inside Casting only**; unmatched names require owner resolution. `direct_save` never bypasses review.

---

## 7. Module 4: Settings & Core Data Dictionary

### `app_settings`
Singleton configuration record (`id: "globalsettings1"`) controlling which optional modules are enabled:
* **Fields:**
  * `id` (`text`: `"globalsettings1"`, system primary key)
  * `key` (`text`: `"global_settings"`, unique index)
  * `purchase_enabled` (`bool`): When `false`, all Purchase pages, navigation, and drafts are hidden.
  * `casting_enabled` (`bool`): When `false`, all Casting pages, navigation, and drafts are hidden.
* **Sample Record:**
```json
{
  "id": "globalsettings1",
  "key": "global_settings",
  "purchase_enabled": true,
  "casting_enabled": true
}
```

---

### `users`
PocketBase authentication collection for human operators and AI agents:
* **Fields:** `id`, `email`, `role` (`select`: `operator` | `muse`), `verified` (`bool`).
* **Operator Record:** `jay@kapil.cosearch.me` (`role: "operator"`).
* **Muse Agent Record:** `muse@kapil.cosearch.me` (`role: "muse"`).

---

## 8. PocketBase REST API Quick Reference (Arch DEV examples)

These URLs target **Arch DEV**, not Windows PROD. Windows PROD is the later deployment target and must use its own configured local endpoint.

### 1. Fetching Records
```http
GET http://100.66.74.78:4174/pb/api/collections/customers/records?page=1&perPage=50&filter=(active=true)&sort=name
Authorization: Bearer <token>
```

### 2. Expanding Relations in One Call
```http
GET http://100.66.74.78:4174/pb/api/collections/bills/records?expand=customer&sort=-date
Authorization: Bearer <token>
```
*The response will nest the linked customer inside `record.expand.customer`.*

### 3. Staging a Sales Bill Draft (Atomic Batch)
Muse AI can stage a draft header and all line items in a single atomic transaction using `POST /api/batch`:
```http
POST http://100.66.74.78:4174/pb/api/batch
Authorization: Bearer <token>
Content-Type: application/json

{
  "batch": [
    {
      "method": "POST",
      "url": "/api/collections/bill_drafts/records",
      "body": {
        "id": "drftadesh000001",
        "customer_name": "Adesh Brass",
        "book_no": 51,
        "bill_no": 79,
        "date": "2026-11-16",
        "mkt": 505,
        "transport": 350,
        "gst_mode": "percent18",
        "gst_rate": 18,
        "status": "pending_review",
        "raw_text": "Adesh Brass 300kg spindle bill 79"
      }
    },
    {
      "method": "POST",
      "url": "/api/collections/bill_draft_items/records",
      "body": {
        "draft": "drftadesh000001",
        "item_name": "Spindle (8.5GM)",
        "qty": 300,
        "bags": 6,
        "rate": 510,
        "amount": 153000
      }
    }
  ]
}
```
