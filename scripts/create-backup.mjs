import PocketBase from 'pocketbase';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = 'C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a';
const backupDir = path.join(root, 'runtime/backups');
const pbBackupDir = path.join(root, 'runtime/data/backups');

fs.mkdirSync(backupDir, { recursive: true });

const stamp = [
  new Date().getFullYear(),
  String(new Date().getMonth() + 1).padStart(2, '0'),
  String(new Date().getDate()).padStart(2, '0'),
  '_',
  String(new Date().getHours()).padStart(2, '0'),
  String(new Date().getMinutes()).padStart(2, '0'),
  String(new Date().getSeconds()).padStart(2, '0')
].join('');
const zipName = `kapil_backup_${stamp}.zip`;
const destZip = path.join(backupDir, zipName);

console.log('Initiating PocketBase consistent snapshot backup:', zipName);

const pb = new PocketBase('http://127.0.0.1:8090');
// Superuser credentials live in the gitignored runtime/state dir (same pattern as
// muse-credentials.json). Rotate the password there, never in code.
const credPath = path.join(root, 'runtime/state/pb-admin-credentials.json');
if (!fs.existsSync(credPath)) {
  throw new Error(`Missing ${credPath} — create it with {"email": "...", "password": "..."}`);
}
const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
await pb.collection('_superusers').authWithPassword(creds.email, creds.password);

await pb.backups.create(zipName);
console.log('PocketBase generated atomic backup in data/backups');

const srcZip = path.join(pbBackupDir, zipName);
if (!fs.existsSync(srcZip)) {
  throw new Error(`Backup file not found at ${srcZip}`);
}

// Move to runtime/backups
fs.renameSync(srcZip, destZip);
console.log('Moved backup to', destZip);

// Compute SHA-256
const buffer = fs.readFileSync(destZip);
const hash = crypto.createHash('sha256').update(buffer).digest('hex');
fs.writeFileSync(`${destZip}.sha256.txt`, `${hash}  ${zipName}\n`);
console.log(`Backup verified: SHA-256 ${hash} (Size: ${buffer.length} bytes)`);

// Retention policy: Keep 4 recent, 8 weekly, 6 monthly.
// Matches both backup naming schemes: this script's kapil_backup_* and the
// windows/backup-kapil.ps1 kapil-local-* archives.
const files = fs.readdirSync(backupDir)
  .filter(f => (f.startsWith('kapil_backup_') || f.startsWith('kapil-local-')) && f.endsWith('.zip'))
  .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
  .sort((a, b) => b.time - a.time);

const keep = new Set();
// 4 recent
files.slice(0, 4).forEach(f => keep.add(f.name));

// Weekly & monthly grouping
const weekly = new Map();
const monthly = new Map();
for (const f of files) {
  const d = new Date(f.time);
  const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const wKey = `${d.getFullYear()}-W${Math.floor(d.getDate() / 7)}`;
  if (!weekly.has(wKey) && weekly.size < 8) {
    weekly.set(wKey, f.name);
    keep.add(f.name);
  }
  if (!monthly.has(mKey) && monthly.size < 6) {
    monthly.set(mKey, f.name);
    keep.add(f.name);
  }
}

for (const f of files) {
  if (!keep.has(f.name)) {
    console.log('Pruning expired backup:', f.name);
    try { fs.unlinkSync(path.join(backupDir, f.name)); } catch {}
    try { fs.unlinkSync(path.join(backupDir, `${f.name}.sha256.txt`)); } catch {}
  }
}

console.log('Backups retention enforced successfully. Total retained:', keep.size);
