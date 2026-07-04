/**
 * One-time / CI PocketBase admin migration for supplier-side buying.
 * Usage: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/ensure-buying-collections.mjs
 */
import PocketBase from 'pocketbase'

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090'
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD

const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
    console.error('Missing PocketBase admin credentials. Run with Doppler or set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD.')
    process.exit(1)
  }

  console.log(`Connecting to PocketBase: ${PB_URL}`)
  await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD)
  console.log(`Authenticated as ${PB_ADMIN_EMAIL}`)

  const suppliers = await ensureSuppliers()
  const purchaseBills = await ensurePurchaseBills(suppliers.id)
  await ensurePurchaseItems(purchaseBills.id)
  await ensurePurchaseDeductions(purchaseBills.id)
  const supplierPayments = await ensureSupplierPayments(suppliers.id)
  await ensureSupplierPaymentAllocations(supplierPayments.id, purchaseBills.id)
  console.log('Buying collections are ready.')
}

function mergeCustomFields(existingFields, desiredFields) {
  const systemFields = (existingFields ?? []).filter((field) => field?.system)
  return [...systemFields, ...desiredFields]
}

function textField(name, required) {
  return {
    name,
    type: 'text',
    required: Boolean(required),
    min: 0,
    max: 0,
    pattern: '',
    autogeneratePattern: '',
  }
}

function numberField(name, required) {
  return {
    name,
    type: 'number',
    required: Boolean(required),
    onlyInt: false,
    min: null,
    max: null,
  }
}

function boolField(name) {
  return { name, type: 'bool', required: false }
}

function relationField(name, collectionId, required = true) {
  return {
    name,
    type: 'relation',
    required: Boolean(required),
    maxSelect: 1,
    collectionId,
    cascadeDelete: false,
  }
}

async function upsertCollection(name, fields, indexes) {
  const existing = await pb.collections.getOne(name).catch(() => null)
  const apiRule = '@request.auth.id != ""'
  if (!existing) {
    const created = await pb.collections.create({
      name,
      type: 'base',
      fields,
      indexes,
      listRule: apiRule,
      viewRule: apiRule,
      createRule: apiRule,
      updateRule: apiRule,
      deleteRule: apiRule,
    })
    console.log(`Created ${name}`)
    return created
  }

  const updated = await pb.collections.update(existing.id, {
    ...existing,
    fields: mergeCustomFields(existing.fields ?? [], fields),
    indexes,
    listRule: apiRule,
    viewRule: apiRule,
    createRule: apiRule,
    updateRule: apiRule,
    deleteRule: apiRule,
  })
  console.log(`Updated ${name} schema`)
  return updated
}

async function ensureSuppliers() {
  return upsertCollection(
    'suppliers',
    [
      textField('name', true),
      boolField('active'),
      textField('phone', false),
      textField('gstin', false),
      textField('address', false),
      textField('default_bill_mode', false),
      numberField('opening_payable', false),
      textField('opening_payable_date', false),
      textField('notes', false),
    ],
    ['CREATE UNIQUE INDEX idx_suppliers_name ON suppliers (name)', 'CREATE INDEX idx_suppliers_active ON suppliers (active)'],
  )
}

async function ensurePurchaseBills(supplierCollectionId) {
  return upsertCollection(
    'purchase_bills',
    [
      textField('date', true),
      relationField('supplier', supplierCollectionId, true),
      textField('supplier_name', true),
      textField('bill_mode', true),
      textField('supplier_bill_no', false),
      textField('internal_ref', false),
      numberField('material_total', false),
      numberField('deduction_total', false),
      numberField('taxable_value', false),
      numberField('gst_rate', false),
      numberField('gst_amount', false),
      numberField('grand_total', false),
      textField('paid_status', false),
      textField('supplier_gstin', false),
      textField('invoice_no', false),
      textField('invoice_date', false),
      textField('note', false),
    ],
    [
      'CREATE INDEX idx_purchase_bills_date ON purchase_bills (date)',
      'CREATE INDEX idx_purchase_bills_supplier ON purchase_bills (supplier)',
      'CREATE INDEX idx_purchase_bills_mode ON purchase_bills (bill_mode)',
    ],
  )
}

async function ensurePurchaseItems(purchaseCollectionId) {
  return upsertCollection(
    'purchase_items',
    [
      relationField('purchase_bill', purchaseCollectionId, true),
      textField('material_name', true),
      numberField('gross_kg', false),
      numberField('bag_count', false),
      numberField('bag_kg', false),
      numberField('net_kg', false),
      numberField('rate', false),
      textField('calculation_mode', false),
      numberField('gross_amount', false),
      numberField('bag_deduction_amount', false),
      numberField('line_amount', false),
    ],
    [
      'CREATE INDEX idx_purchase_items_bill ON purchase_items (purchase_bill)',
      'CREATE INDEX idx_purchase_items_material ON purchase_items (material_name)',
    ],
  )
}

async function ensurePurchaseDeductions(purchaseCollectionId) {
  return upsertCollection(
    'purchase_deductions',
    [
      relationField('purchase_bill', purchaseCollectionId, true),
      textField('kind', true),
      textField('material_name', false),
      textField('description', false),
      numberField('qty_kg', false),
      numberField('rate', false),
      numberField('amount', false),
      boolField('affects_stock'),
    ],
    [
      'CREATE INDEX idx_purchase_deductions_bill ON purchase_deductions (purchase_bill)',
      'CREATE INDEX idx_purchase_deductions_material ON purchase_deductions (material_name)',
    ],
  )
}

async function ensureSupplierPayments(supplierCollectionId) {
  return upsertCollection(
    'supplier_payments',
    [
      textField('date', true),
      relationField('supplier', supplierCollectionId, true),
      textField('supplier_name', true),
      numberField('amount', false),
      textField('mode', false),
      textField('bill_mode_scope', true),
      textField('note', false),
    ],
    [
      'CREATE INDEX idx_supplier_payments_date ON supplier_payments (date)',
      'CREATE INDEX idx_supplier_payments_supplier ON supplier_payments (supplier)',
      'CREATE INDEX idx_supplier_payments_scope ON supplier_payments (bill_mode_scope)',
    ],
  )
}

async function ensureSupplierPaymentAllocations(paymentCollectionId, purchaseCollectionId) {
  return upsertCollection(
    'supplier_payment_allocations',
    [
      relationField('supplier_payment', paymentCollectionId, true),
      relationField('purchase_bill', purchaseCollectionId, true),
      numberField('amount', false),
    ],
    [
      'CREATE INDEX idx_supplier_alloc_payment ON supplier_payment_allocations (supplier_payment)',
      'CREATE INDEX idx_supplier_alloc_bill ON supplier_payment_allocations (purchase_bill)',
    ],
  )
}
