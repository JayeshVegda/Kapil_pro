# Kapil Pro Telegram Bots

Production uses the brass-rate notifier. The older interactive companion bot is
kept in this folder for reference and local use, but it is not the deployed
`kapil-bot` container.

## Production Brass Notifier

The deployed bot container runs:

```bash
npm run brass:daemon
```

It checks `https://rss.zayu.dev/telegram/channel/brassb2b` during the morning
window, stores the latest bulletin in PocketBase, and sends two Telegram
messages:

- Brass Rates Update
- Price Change Analysis

Default window: `10:20` to `10:50` Asia/Kolkata.
The daemon requires the RSS bulletin date to match today's date in that timezone,
so it will wait instead of sending yesterday's stale bulletin.

Required production secrets come from Doppler `kapil-billing/prd`:

```bash
BRASS_RSS_URL=
BRASS_TELEGRAM_BOT_TOKEN=
BRASS_TELEGRAM_CHAT_ID=
PB_ADMIN_EMAIL=
PB_ADMIN_PASSWORD=
```

Run one manual check without sending duplicate messages:

```bash
doppler run --project kapil-billing --config prd -- npm run brass:test
```

Run the same check with production's "today only" guard:

```bash
doppler run --project kapil-billing --config prd -- npm run brass:test:today
```

Force a send only when you intentionally want to resend the latest bulletin:

```bash
doppler run --project kapil-billing --config prd -- npm run brass:watch -- --force
```

## Legacy Interactive Bot

The old command bot can still be built and started locally:

Allowed writes:

- `p <party> <amount> [cash|bank] [date] ["note"]`
- `s [item] <qty> [date] ["note"]`

Read-only:

- `stock [item/customer]`
- `rate [date]`
- `day [date]`
- `bill [book/bill | party | date]`

```bash
npm run bot:build
npm run bot:start
```
