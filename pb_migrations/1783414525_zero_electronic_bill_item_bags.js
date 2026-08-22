/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  app.db()
    .newQuery(`
      UPDATE bill_items
      SET bags = 0
      WHERE item IN (
        SELECT id
        FROM items
        WHERE lower(type) = 'electronic'
      )
      OR lower(trim(item_name)) IN (
        SELECT lower(trim(name))
        FROM items
        WHERE lower(type) = 'electronic'
      )
    `)
    .execute()
}, (app) => {
  app.db()
    .newQuery(`
      UPDATE bill_items
      SET bags = round(qty / 50)
      WHERE item IN (
        SELECT id
        FROM items
        WHERE lower(type) = 'electronic'
      )
      OR lower(trim(item_name)) IN (
        SELECT lower(trim(name))
        FROM items
        WHERE lower(type) = 'electronic'
      )
    `)
    .execute()
})
