/// <reference path="../pb_data/types.d.ts" />
// Supplier Purchase module API rules: operator-only, muse excluded.
// Same posture as the muse_permissions migration: any authenticated user whose
// role is not "muse" — which in this app is the operator/admin login only.
// purchase_audit_log is append-only: update/delete stay closed (null = deny all
// non-superusers), so log rows can never be edited from the API.
migrate((app) => {
  const restrictedRule = '@request.auth.id != "" && @request.auth.role != "muse"'
  const fullRuleCollections = [
    "suppliers",
    "purchase_items",
    "purchase_bills",
    "purchase_bill_lines",
    "purchase_bill_adjustments",
    "purchase_bardan",
    "supplier_payments",
    "supplier_payment_allocations",
  ]
  for (const name of fullRuleCollections) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = restrictedRule
    col.viewRule = restrictedRule
    col.createRule = restrictedRule
    col.updateRule = restrictedRule
    col.deleteRule = restrictedRule
    app.save(col)
  }

  const audit = app.findCollectionByNameOrId("purchase_audit_log")
  audit.listRule = restrictedRule
  audit.viewRule = restrictedRule
  audit.createRule = restrictedRule
  audit.updateRule = null
  audit.deleteRule = null
  app.save(audit)
}, (app) => {
  const publicRule = ""
  const names = [
    "suppliers",
    "purchase_items",
    "purchase_bills",
    "purchase_bill_lines",
    "purchase_bill_adjustments",
    "purchase_bardan",
    "supplier_payments",
    "supplier_payment_allocations",
    "purchase_audit_log",
  ]
  for (const name of names) {
    try {
      const col = app.findCollectionByNameOrId(name)
      col.listRule = publicRule
      col.viewRule = publicRule
      col.createRule = publicRule
      col.updateRule = publicRule
      col.deleteRule = publicRule
      app.save(col)
    } catch {}
  }
})
