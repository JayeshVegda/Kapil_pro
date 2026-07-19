# Cloud-Primary PocketBase with Local Standby and Offsite Backups

## Goal

Keep PocketBase Cloud as the only normal-operation writer while maintaining a
VPS PocketBase standby that is no more than one replication interval behind for
business records. Create complete recoverable archives every six hours in
Backblaze B2 and deliver one encrypted archive to Telegram each day.

## Normal-Operation Data Flow

1. The browser and brass-rate bot write only to PocketBase Cloud.
2. A VPS replication worker compares Cloud with the local standby every 60
   seconds.
3. The worker creates and updates local records in relationship dependency
   order, deletes local-only records in reverse dependency order, and verifies
   normalized record hashes and counts.
4. The local PocketBase remains bound to `127.0.0.1` and is not routed by Caddy.
5. Local changes are never sent to Cloud during normal operation.

## Replication Scope and Safety

- Base application collections are replicated through PocketBase's public
  superuser API.
- System and superuser collections are never modified by the minute worker.
- Auth collections, settings, schemas, password hashes, and uploaded files are
  refreshed by complete PocketBase snapshots rather than reconstructed from
  record-list responses.
- Auto-date fields and file metadata are excluded from normalized business-data
  comparisons because PocketBase manages their physical values.
- The worker refuses to continue when collection schemas differ.
- A deletion guard stops a cycle if the proposed deletions exceed 50 records, or
  if a batch of at least five deletions exceeds 20 percent of a non-empty target
  collection. A single valid deletion in a small collection remains replicable.
- A failed or partial cycle is retried from a fresh Cloud read; no local state is
  used as a source of truth.
- Replication status is written atomically with the last success time, lag,
  record totals, mutations, and error text. Docker health fails after two missed
  intervals.

## Full Backups

At 00:15, 06:15, 12:15, and 18:15 UTC:

1. Authenticate to PocketBase Cloud as the existing service superuser.
2. Ask PocketBase to create a complete backup archive.
3. Download it with a short-lived superuser file token.
4. Validate ZIP integrity, require the PocketBase database files, calculate
   SHA-256, and reject unexpected size regressions.
5. Upload the validated archive to the encrypted `b2crypt` Backblaze remote
   under a timestamped path.
6. Upload and restore the archive into the local standby during the six-hour
   refresh window, then allow the minute worker to catch up.
7. Retain only the two newest job-created archives inside PocketBase Cloud after
   Backblaze upload succeeds. Built-in automatic backups remain independently
   managed.

The 00:15 UTC run also encrypts the archive using the configured backup
encryption password and sends it as a Telegram document with timestamp, size,
record total, and SHA-256 in the caption.

Backblaze retention remains independent from PocketBase Cloud. Existing nightly
Restic snapshots continue to protect the local standby data directory and the
deployment files. Six-hour Backblaze PocketBase archives use a rolling 30-day
retention window.

## Failover

Failover is manual to prevent a network partition from creating two primaries:

1. Confirm Cloud is unavailable and stop the Cloud-to-local replication worker.
2. Record the local standby's last successful replication time.
3. Change Caddy `/pb` and the brass bot to the local PocketBase.
4. Start local write mode, verify authentication and collection counts, then
   reopen the application.

When Cloud returns, local changes are not merged record by record. Enter a short
maintenance window, take a complete local backup, restore that archive to Cloud,
verify parity, switch clients back to Cloud, and restart one-way replication.

## Monitoring

- Healthy: last successful cycle is under 120 seconds old and zero collections
  are mismatched.
- Warning: one failed cycle, backup size changes by more than 50 percent, or
  local full-snapshot refresh is older than seven hours.
- Critical: two missed replication intervals, schema mismatch, deletion guard,
  backup upload failure, restore verification failure, or Cloud/local health
  failure.
- Backup success and all warning/critical states are sent to the configured
  Telegram chat.

## Test Seams

1. `buildReconciliationPlan(source, target, schema)` returns deterministic
   creates, updates, and deletes without contacting PocketBase.
2. `runReplicationCycle(sourceClient, targetClient)` produces a verified target
   through the public PocketBase client boundary.
3. The backup command validates a real PocketBase ZIP and derives deterministic
   Backblaze and Telegram metadata.
4. A live acceptance check compares every replicated collection between Cloud
   and the local standby after the worker starts.

Tests cover create, update, delete, dependency ordering, no-op cycles,
auto-managed field normalization, schema mismatch, deletion guard, archive
validation, and stale-health detection.

## Acceptance Criteria

- Browser and brass bot continue using PocketBase Cloud.
- Local PocketBase runs on loopback and is not exposed by Caddy.
- A Cloud create, update, and delete is reflected locally within 120 seconds.
- All replicated collections pass normalized hash and count comparison.
- A complete Cloud backup is validated and stored in Backblaze.
- The daily encrypted Telegram backup is delivered successfully.
- Local standby is restored from the complete archive and catches up afterward.
- Replica and backup failures produce actionable Telegram alerts.
