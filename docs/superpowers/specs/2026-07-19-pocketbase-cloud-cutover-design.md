# PocketBase Cloud Production Cutover

## Goal

Make the migrated PocketBase Cloud instance the single production database for
Kapil Pro without changing the browser-facing application URL, while preserving
the VPS database as a stopped rollback copy.

## Current State

- The frontend uses the same-origin `/pb` API path.
- Caddy proxies `/pb` to the VPS PocketBase container.
- The brass-rate bot writes directly to the VPS PocketBase container.
- PocketBase Cloud contains the migrated schema and records, except for one
  brass-rate record that exists only on the VPS.

## Design

1. Copy the missing brass-rate record to PocketBase Cloud and compare every
   application collection by record ID and canonical record content.
2. Keep the frontend configuration unchanged and change Caddy's `/pb` upstream
   to the PocketBase Cloud HTTPS endpoint. This avoids a frontend rebuild and
   preserves same-origin browser requests.
3. Change the bot's `PB_URL` and superuser credentials through Doppler so the
   bot writes directly to PocketBase Cloud.
4. Reload Caddy and recreate the bot, then verify the public site, proxied health
   endpoint, authentication endpoint behavior, and bot logs.
5. Create a final VPS backup and stop the VPS PocketBase container. Keep its
   database, migrations, and backups unchanged for rollback.
6. Enable PocketBase Cloud rate limiting, correct application metadata, rotate
   the exposed cloud superuser password into Doppler, and verify daily backups.

## Failure Handling and Rollback

- Do not delete or overwrite the VPS data directory.
- If cloud verification fails, restore Caddy's local upstream, restore the
  bot's local URL and credentials from the existing VPS configuration, and
  restart the VPS PocketBase container.
- Stop the local writer only after cloud parity and proxied API health checks
  pass.

## Acceptance Criteria

- `https://kapil.zayu.dev/pb/api/health` reaches PocketBase Cloud successfully.
- The frontend remains available at `https://kapil.zayu.dev`.
- All application collections match after synchronization.
- The brass-rate bot starts without authentication or network errors and uses
  the cloud URL.
- The VPS PocketBase is stopped, its final backup exists, and its data remains
  available for rollback.
- Cloud rate limiting and daily backups are enabled.
