# Doppler Secrets

Kapil Pro uses Doppler as the source of truth for production secrets.

## Projects

- `kapil-billing/prd` - application runtime and build configuration.
- `vps/prd` - VPS infrastructure, backup, monitoring, and host-level automation.

Keep these scopes separate. App containers and app maintenance scripts should use
`kapil-billing/prd`; server backup and monitoring jobs should use `vps/prd`.

## VPS Usage

The VPS has the Doppler CLI installed and authenticated. From this repo, the
default Doppler setup points at `kapil-billing/prd`.

Run app commands through Doppler:

```bash
doppler run --project kapil-billing --config prd -- npm run build
doppler run --project kapil-billing --config prd -- npm run brass:test
doppler run --project kapil-billing --config prd -- npm run brass:test:today
doppler run --project kapil-billing --config prd -- docker compose up -d
doppler run --project kapil-billing --config prd -- node scripts/ensure-casting-collections.mjs
```

The low-RAM deploy script automatically re-runs itself through Doppler when
PocketBase admin credentials are not already present:

```bash
./scripts/deploy-low-ram.sh
```

To intentionally run without Doppler for local testing, set:

```bash
KAPIL_SKIP_DOPPLER=1 ./scripts/deploy-low-ram.sh
```

## Local `.env`

`.env` is only for non-secret local and browser build values. Any value prefixed
with `VITE_` is bundled into the browser and must be treated as public.

Do not store these in `.env`:

- `PB_ADMIN_PASSWORD`
- `PB_SUPERUSER_PASSWORD`
- `BRASS_TELEGRAM_BOT_TOKEN`
- `BRASS_TELEGRAM_CHAT_ID`
- `KAPIL_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- storage, backup, or service tokens

## Remote Access

External automation should use a Doppler service token scoped to exactly one
project/config. Prefer read-only service tokens unless the job must update
secrets. Do not use personal CLI tokens in production automation.

Set the token only in the remote runtime environment:

```bash
export DOPPLER_TOKEN="dp.st..."
doppler run -- npm run build
```

## Secret Checks

List secret names without printing values:

```bash
doppler secrets --project kapil-billing --config prd --json | jq -r 'keys[]' | sort
```

Fetching or printing secret values should be avoided during normal development
and code review.
