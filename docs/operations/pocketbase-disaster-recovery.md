# PocketBase Disaster Recovery Runbook

## Production Roles

- Primary: PocketBase Cloud at
  `https://7ddi60xr8g6ktz3.ba7w.pocketbasecloud.com`.
- Standby: `kapil-billing-pb`, bound to VPS loopback port `8090`.
- Replication: `kapil-billing-pb-replica`, Cloud to local every 60 seconds.
- Backups: complete Cloud archive to encrypted Backblaze every six hours;
  encrypted Telegram document at 00:15 UTC.

The local standby is never a normal-operation writer. Never point users at both
databases simultaneously.

## Routine Status

```bash
docker inspect kapil-billing-pb kapil-billing-pb-replica \
  --format '{{.Name}} running={{.State.Running}} health={{.State.Health.Status}}'

jq . /opt/stacks/sites/kapil/replica_state/status.json
jq . /opt/stacks/sites/kapil/replica_state/backup-status.json

/opt/stacks/sites/kapil/scripts/b2-backup-access.sh list
```

Healthy replication has `ok: true`, `mismatches: 0`, and a `completedAt` value
less than two minutes old. Healthy backup status has `ok: true`,
`localRestored: true`, and a timestamp less than seven hours old.

## Cloud Unavailable: Fail Over to Local

1. Confirm the direct Cloud health URL fails from more than one network.
2. Stop replication before accepting any local write:

   ```bash
   docker stop kapil-billing-pb-replica
   ```

3. Record the latest replica status and confirm local health:

   ```bash
   jq . /opt/stacks/sites/kapil/replica_state/status.json
   curl --fail http://127.0.0.1:8090/api/health
   ```

4. Change the `kapil.zayu.dev` `/pb` Caddy upstream from the Cloud HTTPS URL to
   `kapil-billing-pb:8090`, remove the Cloud-only TLS transport block, validate,
   and reload Caddy.
5. Change the brass bot `PB_URL` to `http://kapil-pb:8090` and recreate only the
   bot.
6. Verify login, customers, bills, payments, and a harmless create/delete before
   reopening the application.

Automatic failover is intentionally disabled because a network partition could
otherwise create two writable primaries.

## Standby Damaged: Recover from Backblaze

List archives:

```bash
/opt/stacks/sites/kapil/scripts/b2-backup-access.sh list
```

Download the newest archive:

```bash
/opt/stacks/sites/kapil/scripts/b2-backup-access.sh download \
  2026/07/dr_kapil_YYYYMMDDtHHMMSSz.zip \
  /tmp/kapil-pocketbase-restore.zip
```

Upload and restore that ZIP from the local PocketBase superuser dashboard, then
run a one-shot reconciliation before enabling traffic:

```bash
cd /opt/stacks/sites/kapil
SOURCE_PB_URL=https://7ddi60xr8g6ktz3.ba7w.pocketbasecloud.com \
TARGET_PB_URL=http://127.0.0.1:8090 \
REPLICA_STATE_FILE=/opt/stacks/sites/kapil/replica_state/status.json \
doppler run --project kapil-billing --config prd -- \
node scripts/pb-replica.mjs --once
```

## Recover a Telegram Archive

Telegram documents are encrypted with AES-256-CBC and PBKDF2. After retrieving
the configured backup encryption password into the environment:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:KAPIL_TELEGRAM_BACKUP_PASSWORD \
  -in dr_kapil_YYYYMMDDtHHMMSSz.zip.enc \
  -out dr_kapil_YYYYMMDDtHHMMSSz.zip

unzip -t dr_kapil_YYYYMMDDtHHMMSSz.zip
sha256sum dr_kapil_YYYYMMDDtHHMMSSz.zip
```

Compare the SHA-256 result with the Telegram caption before restoring.

## Return from Local to Cloud

Do not restart Cloud-to-local replication while local contains newer writes.

1. Enter maintenance mode and stop all browser and bot writes.
2. Create and validate a complete local PocketBase backup.
3. Upload and restore that complete archive to PocketBase Cloud.
4. Compare all collection counts and canonical hashes.
5. Change Caddy and the bot back to Cloud.
6. Run `pb-replica.mjs --once`.
7. Start `kapil-billing-pb-replica` and exit maintenance mode.

## Scheduled Jobs

The installed schedule is `/etc/cron.d/kapil-pocketbase-dr`:

- `00:15 UTC`: Backblaze, local refresh, and Telegram.
- `06:15 UTC`: Backblaze and local refresh.
- `12:15 UTC`: Backblaze and local refresh.
- `18:15 UTC`: Backblaze and local refresh.

Logs are written to
`/opt/stacks/sites/kapil/replica_state/backup-cron.log`.
