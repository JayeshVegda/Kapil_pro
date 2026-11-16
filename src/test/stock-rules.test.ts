import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

it('locks stock mutations to the operator while allowing authenticated reads', () => {
  const source = readFileSync('pb_migrations/1794640014_lock_stock_writes.js', 'utf8')
  const collections = new Map(['stock_in', 'stock_adjustments', 'stock_openings'].map((name) => [name, { name, listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' }]))
  runInNewContext(source, {
    migrate: (up: (app: unknown) => void) => up({
      findCollectionByNameOrId: (name: string) => collections.get(name),
      save: () => undefined,
    }),
  })
  for (const collection of collections.values()) {
    expect(collection.listRule).toContain('@request.auth.id')
    expect(collection.viewRule).toContain('@request.auth.id')
    for (const rule of [collection.createRule, collection.updateRule, collection.deleteRule]) {
      expect(rule).toContain('@request.auth.id')
      expect(rule).toContain('@request.auth.role != "muse"')
    }
  }
})
