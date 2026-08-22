import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8')

describe('Windows local-primary package', () => {
  it('binds both services to loopback and never to every network interface', () => {
    const caddy = read('windows/Caddyfile')
    const start = read('windows/start-kapil.ps1')
    expect(caddy).toContain('http://127.0.0.1:4174')
    expect(caddy).toContain('reverse_proxy 127.0.0.1:8090')
    expect(start).toContain("'127.0.0.1:8090'")
    expect(`${caddy}\n${start}`).not.toContain('0.0.0.0')
  })

  it('keeps all runtime data and Windows secrets outside Git', () => {
    const ignore = read('.gitignore')
    expect(ignore).toContain('runtime/**')
    expect(ignore).toContain('.env.*')
    expect(ignore).toContain('*.db')
    expect(ignore).toContain('*.zip')
  })

  it('requires a stopped database for backup and restore workflows', () => {
    expect(read('windows/backup-kapil.ps1')).toContain("'stop-kapil.ps1'")
    expect(read('windows/restore-kapil.ps1')).toContain("'stop-kapil.ps1'")
    expect(read('windows/restore-kapil.ps1')).toContain('data-before-restore-')
  })
})
