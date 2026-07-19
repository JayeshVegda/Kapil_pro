import assert from 'node:assert/strict'
import test from 'node:test'

import {
  backupObjectPath,
  isPocketBaseArchiveEntries,
  parseResticB2Bucket,
  shouldRejectBackupSize,
  telegramCaption,
} from './pb-backup.mjs'

test('derives a timestamped Backblaze object path', () => {
  assert.equal(
    backupObjectPath('dr_kapil_20260719t120000z.zip'),
    '2026/07/dr_kapil_20260719t120000z.zip',
  )
})

test('extracts the B2 bucket from a Restic repository', () => {
  assert.equal(parseResticB2Bucket('b2:my-vps-backups:/restic'), 'my-vps-backups')
  assert.equal(parseResticB2Bucket('b2:my-vps-backups'), 'my-vps-backups')
  assert.throws(() => parseResticB2Bucket('s3:https://example.test/bucket'), /B2 repository/i)
})

test('requires PocketBase database files in a backup archive', () => {
  assert.equal(
    isPocketBaseArchiveEntries(['data.db', 'auxiliary.db', 'types.d.ts']),
    true,
  )
  assert.equal(isPocketBaseArchiveEntries(['readme.txt', 'types.d.ts']), false)
})

test('rejects tiny and unexpectedly regressed backup sizes', () => {
  assert.equal(shouldRejectBackupSize(90_000, 2_700_000), true)
  assert.equal(shouldRejectBackupSize(1_000_000, 2_700_000), true)
  assert.equal(shouldRejectBackupSize(2_600_000, 2_700_000), false)
  assert.equal(shouldRejectBackupSize(2_600_000, 0), false)
})

test('builds a Telegram caption containing recovery evidence', () => {
  const caption = telegramCaption({
    createdAt: '2026-07-19T12:00:00.000Z',
    sizeBytes: 2_698_571,
    sha256: 'abc123',
    recordTotal: 731,
  })

  assert.match(caption, /Kapil PocketBase backup/)
  assert.match(caption, /2\.57 MiB/)
  assert.match(caption, /731/)
  assert.match(caption, /abc123/)
})
