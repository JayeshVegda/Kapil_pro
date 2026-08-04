import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import PocketBase from 'pocketbase'
import JSZip from 'jszip'

const sourceUrl = required('PB_CLOUD_URL', process.env.PB_URL || 'https://7ddi60xr8g6ktz3.ba7w.pocketbasecloud.com').replace(/\/+$/, '')
const email = required('PB_ADMIN_EMAIL')
const password = required('PB_ADMIN_PASSWORD')
const destination = path.resolve(process.argv[2] || 'runtime/transfer')
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z').replace('T', 't')
const name = `kapil-windows-transfer_${stamp}.zip`
const archivePath = path.join(destination, name)

const pb = new PocketBase(sourceUrl)
pb.autoCancellation(false)
await pb.collection('_superusers').authWithPassword(email, password)
await fs.mkdir(destination, { recursive: true, mode: 0o700 })

try {
  await pb.backups.create(name)
  const token = await pb.files.getToken()
  const response = await fetch(pb.backups.getDownloadURL(token, name))
  if (!response.ok) throw new Error(`Backup download failed: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 100_000) throw new Error(`Backup is unexpectedly small: ${bytes.byteLength} bytes`)
  const zip = await JSZip.loadAsync(bytes)
  const entries = new Set(Object.keys(zip.files).map((entry) => entry.replace(/^\.\//, '')))
  if (!entries.has('data.db') || !entries.has('auxiliary.db')) throw new Error('Backup is missing PocketBase database files')
  await fs.writeFile(archivePath, bytes, { mode: 0o600 })
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const collections = (await pb.collections.getFullList()).filter((collection) => !collection.system)
  const counts = {}
  for (const collection of collections) {
    const page = await pb.collection(collection.name).getList(1, 1, { skipTotal: false, requestKey: null })
    counts[collection.name] = Number(page.totalItems || 0)
  }
  const manifest = { createdAt: new Date().toISOString(), sourceUrl, archive: name, sizeBytes: bytes.byteLength, sha256, recordTotal: Object.values(counts).reduce((sum, count) => sum + count, 0), counts }
  await fs.writeFile(`${archivePath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  await fs.writeFile(`${archivePath}.sha256.txt`, `${sha256}  ${name}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ event: 'windows_transfer_ready', archivePath, sizeBytes: bytes.byteLength, sha256, recordTotal: manifest.recordTotal }))
} finally {
  await pb.backups.delete(name).catch(() => undefined)
}

function required(name, fallback = '') {
  const value = process.env[name]?.trim() || fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}
