import { readdirSync, readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { expect, it } from 'vitest'

it('keeps every PocketBase migration valid JavaScript', () => {
  const files = readdirSync('pb_migrations').filter((name) => name.endsWith('.js'))
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    expect(() => new Script(readFileSync(`pb_migrations/${file}`, 'utf8'), { filename: file }), file).not.toThrow()
  }
})
