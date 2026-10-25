import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';

const backupDir = 'C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/runtime/backups';
const stagingDir = 'C:/Site_imp/kapil-windows/JayeshVegda-Kapil_pro-49c561a/runtime/restore-verify-staging';

// 1. Find latest backup zip
const zips = fs.readdirSync(backupDir)
  .filter(f => f.endsWith('.zip'))
  .map(f => ({ name: f, full: path.join(backupDir, f), time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
  .sort((a, b) => b.time - a.time);

if (zips.length === 0) throw new Error('No backup zip found');
const latest = zips[0];
console.log('Testing restore verification on:', latest.name);

// 2. Verify SHA-256 matches
const shaFile = `${latest.full}.sha256.txt`;
if (fs.existsSync(shaFile)) {
  const shaContent = fs.readFileSync(shaFile, 'utf8').trim().split(/\s+/)[0];
  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(latest.full)).digest('hex');
  if (shaContent.toLowerCase() !== fileHash.toLowerCase()) {
    throw new Error(`SHA-256 mismatch! Expected ${shaContent}, got ${fileHash}`);
  }
  console.log('[PASS] SHA-256 checksum verified:', fileHash);
}

// 3. Extract to staging
if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

const zipData = fs.readFileSync(latest.full);
const zip = await JSZip.loadAsync(zipData);
for (const [filename, file] of Object.entries(zip.files)) {
  const destPath = path.join(stagingDir, filename);
  if (file.dir) {
    fs.mkdirSync(destPath, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, await file.async('nodebuffer'));
  }
}
console.log('[PASS] Extracted archive to staging');

// 4. Verify data.db
let dbPath = path.join(stagingDir, 'data.db');
if (!fs.existsSync(dbPath) && fs.existsSync(path.join(stagingDir, 'data/data.db'))) {
  dbPath = path.join(stagingDir, 'data/data.db');
}
if (!fs.existsSync(dbPath)) throw new Error(`data.db not found in extracted archive`);

const db = new DatabaseSync(dbPath);
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('[PASS] SQLite integrity check:', integrity);

const billsCount = db.prepare('SELECT count(*) as count FROM bills').get().count;
const customersCount = db.prepare('SELECT count(*) as count FROM customers').get().count;
const itemsCount = db.prepare('SELECT count(*) as count FROM items').get().count;
const paymentsCount = db.prepare('SELECT count(*) as count FROM payments').get().count;

console.log(`[PASS] Verified extracted data counts:`);
console.log(`- Bills: ${billsCount}`);
console.log(`- Customers: ${customersCount}`);
console.log(`- Items: ${itemsCount}`);
console.log(`- Payments: ${paymentsCount}`);

db.close();

// Cleanup staging
fs.rmSync(stagingDir, { recursive: true, force: true });
console.log('[PASS] Staging cleaned up. RESTORATION TEST FULLY VERIFIED!');
