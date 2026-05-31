# Kapil Pro Telegram Bot

Quick-access Telegram companion for Kapil Pro.

## Scope

Allowed writes:

- `p <party> <amount> [cash|bank] [date] ["note"]` creates a payment and recalculates bill statuses.
- `s [item] <qty> [date] ["note"]` creates `stock_in` for the General bucket. Bare `s 2` means General Spindle, 2 bags, today.

Read-only:

- `stock [item/customer]`
- `rate [date]`
- `day [date]`
- `bill [book/bill | party | date]`
- bare party search, for example `sambhu`

Bills are never created or edited by this bot.

## Run

Set environment variables in the project `.env`:

```bash
KAPIL_BOT_TOKEN=
KAPIL_BOT_ALLOWED_USER_IDS=123456789
KAPIL_BOT_ALLOW_ALL_USERS=false
PB_URL=http://127.0.0.1:8090
PB_ADMIN_EMAIL=
PB_ADMIN_PASSWORD=
```

When the bot runs inside the production Docker network, use `PB_URL=http://kapil-pb:8090`.

Then:

```bash
npm run bot:build
npm run bot:start
```
