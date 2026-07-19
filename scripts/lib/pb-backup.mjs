export function backupObjectPath(name) {
  const match = name.match(/_(\d{4})(\d{2})(\d{2})t\d{6}z\.zip$/)
  if (!match) throw new Error(`Backup name does not contain a UTC timestamp: ${name}`)
  return `${match[1]}/${match[2]}/${name}`
}

export function parseResticB2Bucket(repository) {
  const match = String(repository || '').match(/^b2:([^:]+)(?::.*)?$/)
  if (!match) throw new Error('RESTIC_REPOSITORY must be a native B2 repository')
  return match[1]
}

export function isPocketBaseArchiveEntries(entries) {
  const normalized = new Set(entries.map((entry) => entry.replace(/^\.?\//, '')))
  return normalized.has('data.db') && normalized.has('auxiliary.db')
}

export function shouldRejectBackupSize(sizeBytes, previousSizeBytes, minimumBytes = 100_000) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < minimumBytes) return true
  return previousSizeBytes > 0 && sizeBytes < previousSizeBytes * 0.5
}

export function telegramCaption({ createdAt, sizeBytes, sha256, recordTotal }) {
  const sizeMiB = (sizeBytes / 1024 / 1024).toFixed(2)
  return [
    '🔐 Kapil PocketBase backup',
    '',
    `Created: ${createdAt}`,
    `Size: ${sizeMiB} MiB`,
    `Records: ${recordTotal}`,
    `SHA-256: ${sha256}`,
    '',
    'Encrypted before Telegram upload.',
  ].join('\n')
}
