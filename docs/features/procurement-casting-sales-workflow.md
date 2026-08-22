# Procurement, Casting, and Sales Workflow

Date: 2026-05-31
Project: Kapil Test (`kapil-test-casting`)

## Purpose

This document captures the business workflow for the new isolated Kapil Test project before replacing the current placeholder Buying module. The goal is to build buying, casting, and improved GST/non-GST selling without disturbing the finalized Kapil Pro billing system.

The current Buying module is only a disabled UI shell. It should be replaced with a real procurement module rather than extended as-is.

## Business Areas

The system should manage three connected areas:

1. Buying scrap and raw material from suppliers.
2. Casting/manufacturing from purchased material.
3. Selling finished goods with existing billing, improved for GST and non-GST handling.

The existing sales billing, customer ledger, payments, dashboard, print bill, and PocketBase setup are the stable base. New procurement and casting should follow the same architecture:

- `src/routes`: screens and forms.
- `src/data`: PocketBase reads/writes.
- `src/domain`: pure calculations and allocation logic.
- PocketBase collections per business object.

## Bill Mode Context

This project is experimental and the GST/non-GST split is an internal business flag, not a compliance or tax-filing system.

Use these terms in the UI:

- `Kacha`: non-GST/internal purchase or sale.
- `GST`: pakka/GST-style purchase or sale.

The app should store GST-style fields only where they help business tracking and printing. It should not attempt ITC tracking, e-invoice generation, return filing, 180-day payment rules, or legal compliance checks.

## Buying Workflow

Buying happens in two modes:

1. Non-GST purchase, locally called kacha bill.
2. GST purchase, locally called pakka bill or GST bill.

The supplier may be the same business party. The ledger should stay combined, with filters for all, kacha only, and GST only.

Common materials:

- Zinc scrap
- Brass scrap
- Chol
- Pata / plate
- Other scrap materials as needed

### Purchase Calculation

A purchase has a supplier, date, bill mode, material rows, deductions, and payable total.

Typical example:

- Supplier: Bhavesh Metal
- Material: brass scrap
- Gross loaded weight: 569 kg, includes bag weight
- Rate: INR 890 per kg
- Bag deduction: 12 bags weighing 3.4 kg total
- Bag deduction amount: 3.4 kg * INR 890
- Final material weight or final amount depends on the selected calculation mode

Bag handling is optional for every purchase line. The app must support both calculation styles:

1. Deduct bag weight before amount:
   - Net material kg = gross kg - bag kg
   - Material amount = net material kg * rate

2. Deduct bag value after gross amount:
   - Gross amount = gross kg * rate
   - Bag deduction amount = bag kg * rate
   - Material amount = gross amount - bag deduction amount

These are mathematically same when rate is identical, but the print/explanation differs. The app should store the mode so the bill and ledger match the real-world note.

### Faulty Material / Return Deduction

Sometimes faulty material is sent back.

The app should support a deduction row:

- Type: faulty material return
- Quantity kg
- Rate per kg, default same as material rate but editable
- Amount = quantity * rate
- Optional note

The final payable is:

`material amount - bag deductions - faulty material deductions - other deductions + GST if GST bill`

Faulty material return should reduce both payable amount and stock for that material.

### Supplier Payments

Payments to suppliers are partial. The operator chooses whether the payment is for kacha bills or GST bills, then the app adjusts the oldest unpaid purchases in that selected mode first.

Example:

- Supplier has 4 unpaid kacha bills.
- Payment made: INR 4,00,000.
- Operator chooses kacha or GST payment scope.
- App applies payment to oldest outstanding purchases in that scope by business date, then created timestamp.
- If payment exceeds open purchases, remaining amount becomes supplier advance.

This mirrors the existing customer payment allocation logic, but direction is reversed:

- Purchase increases payable.
- Supplier payment reduces payable in the chosen bill mode.
- Return/credit note reduces payable.
- Opening payable starts supplier balance.
- Advance means we paid more than current payable.

## Buying Data Model Recommendation

Replace the current placeholder Buying module with these PocketBase collections:

### `suppliers`

Purpose: supplier master.

Fields:

- `name`
- `active`
- `phone`
- `gstin`
- `address`
- `default_bill_mode`: `kacha` or `gst`
- `opening_payable`
- `opening_payable_date`
- `notes`

### `purchase_bills`

Purpose: purchase header.

Fields:

- `date`
- `supplier`
- `supplier_name`
- `bill_mode`: `kacha` or `gst`
- `supplier_bill_no`
- `internal_ref`
- `material_total`
- `deduction_total`
- `taxable_value`
- `gst_rate`
- `gst_amount`
- `grand_total`
- `paid_status`: `pending`, `partial`, `paid`
- `note`
- GST-style fields when bill mode is `gst`: `supplier_gstin`, `invoice_no`, `invoice_date`

### `purchase_items`

Purpose: material rows.

Fields:

- `purchase_bill`
- `material_name`
- `gross_kg`
- `bag_count`
- `bag_kg`
- `net_kg`
- `rate`
- `calculation_mode`: `deduct_before_amount` or `deduct_after_amount`
- `gross_amount`
- `bag_deduction_amount`
- `line_amount`

### `purchase_deductions`

Purpose: faulty/return/other deductions.

Fields:

- `purchase_bill`
- `kind`: `faulty_return`, `rate_cut`, `bardan`, `other`
- `description`
- `qty_kg`
- `rate`
- `amount`
- `affects_stock`

### `supplier_payments`

Purpose: cash/bank payments to supplier.

Fields:

- `date`
- `supplier`
- `amount`
- `mode`: `cash`, `bank`, `upi`, `cheque`, `other`
- `note`
- `bill_mode_scope`: `kacha_only`, `gst_only`

### `supplier_payment_allocations`

Purpose: optional persisted allocation details.

Fields:

- `supplier_payment`
- `purchase_bill`
- `amount`

Persisting allocations is useful if the operator needs exact historical settlement. If we want the same simple model as current sales payments, allocation can be computed on read instead.

## Buying Screens

Recommended screens:

1. Buying dashboard
   - Payable today
   - Kacha payable
   - GST payable
   - Purchases this month by material
   - Top suppliers by payable

2. Suppliers
   - Add/edit supplier
   - GSTIN and default mode
   - Opening payable
   - Active/inactive

3. New purchase
   - Supplier, date, bill mode
   - Material rows with gross kg, bags, bag kg, rate
   - Calculation mode per row
   - Faulty return/deduction rows
   - GST section shown only for GST bill
   - Save with rollback if line insert fails

4. Supplier payment
   - Supplier, date, amount, mode
  - Operator chooses kacha or GST scope
  - Preview oldest-first allocation inside that scope
   - Save payment and refresh statuses

5. Supplier ledger
   - Opening payable
   - Purchases, deductions, payments
   - Running balance
  - Combined ledger with filters: all, kacha, GST

6. Purchase log
   - Combined timeline for purchases, supplier payments, returns, edits, deletes

7. Purchase print/export
   - Kacha bill print
  - GST-style purchase export
   - Supplier statement

## Casting Workflow

Current casting module already has working persistence:

- `casting_sessions`
- `casting_materials`
- `casting_inputs`

Current calculation:

- Each session has material inputs: material name, kg, rate.
- Total input cost = sum of `kg * rate`.
- Total input kg = sum of kg.
- Cost per kg = total input cost / total input kg.
- Session also stores unit/batches, wire out, wastage, chol recovered, and note.

This is logically useful but should be tied to buying/stock next.

Recommended casting model:

- Casting input material should support both modes:
  - Select material from purchased stock/batches when possible.
  - Manual kg/rate entry for adjustment or quick entry.
- Casting should record output:
  - Wire out kg
  - Wastage kg
  - Chol recovered kg
  - Optional finished item/grade
- Cost per kg should have two views:
  1. Input cost per input kg.
  2. Effective cost per sellable wire kg.

Suggested formulas:

- Input cost per kg = total input cost / total input kg.
- Yield percent = wire out / total input kg.
- Effective wire cost per kg = total input cost / wire out.
- Net loss kg = total input kg - wire out - chol recovered.

Open item: confirm whether chol recovered should reduce cost, be treated as byproduct stock, or only shown as recovery.

## Sales Workflow Improvements

Existing selling is mostly finalized and should remain the base.

Needed improvement:

- Sales bill must clearly support non-GST and GST bill mode.
- Customer master should store GSTIN and default bill mode.
- New bill screen should show GST fields only when GST mode is selected.
- Print should visibly mark GST bill, as already started with `MKT: x | BILL`.
- Reports should allow separate totals:
  - Non-GST sales
  - GST sales taxable value
  - GST amount
  - Total amount due
- Payments should let the operator choose kacha or GST scope when separate settlement is needed.

## Recommended Build Order

Recommended approach: build supplier-side buying first, then connect it to casting, then refine GST/non-GST sales reporting.

Reason:

- Buying is currently empty and has the highest missing business logic.
- Casting already works enough to keep using during development.
- Existing sales is stable, so changes there should be smaller and safer.

### Phase 1: Replace Buying Shell

- Remove current disabled placeholder Buying screens and replace them with live screens.
- Add PocketBase migration script for supplier/purchase/payment collections.
- Build supplier master.
- Build new purchase with kacha/GST mode and deduction math.
- Build supplier payment with operator-selected kacha/GST scope and oldest-first allocation preview.
- Build combined supplier ledger with all/kacha/GST filters.

### Phase 2: Tie Buying to Stock and Casting

- Material purchase increases raw material stock.
- Faulty return reduces raw material stock and payable amount.
- Casting can consume raw material stock or accept manual kg/rate input.
- Casting creates output stock for wire/chol/wastage if needed.

### Phase 3: Improve Sales GST/Non-GST Handling

- Add explicit bill mode to sales bills.
- Keep GST amount/rate editable.
- Add GST/non-GST filters in ledger/report/dashboard.
- Add purchase GST register and sales GST register exports.

## Confirmed Decisions

1. Supplier ledger is combined, with all/kacha/GST filters.
2. Supplier payment scope is chosen manually by the operator: kacha or GST.
3. Bag deduction is optional on every purchase.
4. Faulty material return reduces stock and payable amount.
5. GST mode is only an experimental/internal business flag. Do not build compliance logic.
6. Casting should support both stock-selected material inputs and manual kg/rate inputs.
7. Sales already has no-GST and 18 percent GST options. Keep existing customer payment behavior for now.
8. Chol recovered in casting is recorded as a visible recovery number for now; it does not reduce cost or create stock automatically in the first build.

## Remaining Open Questions

1. Confirm material names/spellings: `chol`, `pata`, `plate`, `zinc scrap`, `brass scrap`.
