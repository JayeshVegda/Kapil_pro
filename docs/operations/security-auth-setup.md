# Security and Auth Setup

## Current auth system

- App authentication uses PocketBase `users` email/password login.
- Frontend shows a password-only login screen; email comes from `VITE_LOGIN_EMAIL`.
- On successful login, PocketBase SDK stores auth in `pb.authStore` and app stores a 90-day local session marker in `localStorage`.
- On app load, if local session is missing/expired or PocketBase auth is invalid, the app shows the login screen again.

## How login works

1. User opens app.
2. App checks `localStorage` key `kapil_billing_auth_session_v1` and PocketBase auth validity.
3. If invalid or expired, login screen is rendered.
4. User enters password only.
5. App signs in with `pb.collection('users').authWithPassword(VITE_LOGIN_EMAIL, password)`.
6. PocketBase auth token is then attached automatically by SDK to subsequent PocketBase requests.

## Required environment variables

- `VITE_POCKETBASE_URL` (example: `https://kapil.cosearch.me/pb`)
- `VITE_MARKET_RATE_URL` (example: `https://kapil.cosearch.me/api/market-rate`)
- `VITE_LOGIN_EMAIL` (example: `jay@kapil.cosearch.me`)

No password is stored in frontend env files.

## PocketBase collection rules (business collections)

For these collections:

- `customers`
- `items`
- `bills`
- `bill_items`
- `payments`
- `misc_expenses`

Rules are set to:

- `listRule`: `@request.auth.id != ""`
- `viewRule`: `@request.auth.id != ""`
- `createRule`: `@request.auth.id != ""`
- `updateRule`: `@request.auth.id != ""`
- `deleteRule`: `@request.auth.id != ""`

Operational note: unauthenticated list requests can return empty result sets instead of HTTP 403. This is acceptable for now because no business data is returned.

## Network exposure and closed ports

Target hardened state:

- Public web traffic only on `80`/`443` via reverse proxy.
- PocketBase direct port `8090` blocked from internet.
- App container direct port `8088` blocked from internet.

Container ports should be loopback-bound:

- `kapil-billing-web`: `127.0.0.1:8088->80`
- `kapil-billing-pocketbase`: `127.0.0.1:8090->8090`

## First time setup

1. **Create PocketBase user**
   - Open PocketBase admin (`/pb/_/`) as superuser.
   - Create a `users` record for operator (e.g. Jay) with email + strong password.
2. **Set env values**
   - In production env file, set:
     - `VITE_POCKETBASE_URL`
     - `VITE_MARKET_RATE_URL`
     - `VITE_LOGIN_EMAIL` to that user email.
3. **Apply collection rules**
   - Set all business collection rules to `@request.auth.id != ""`.
4. **Deploy app**
   - Build and deploy containers.
   - Ensure app and PocketBase containers are loopback-bound (not `0.0.0.0`).
5. **First login**
   - Open app URL.
   - Confirm login screen appears.
   - Enter user password and verify dashboard data loads.

## Remaining hardening (future)

- Move from single shared login user to per-user accounts + role policy.
- Add server-side API/auth gateway for explicit 401/403 semantics.
- Add rate limiting and brute-force controls at proxy layer.
- Remove any fallback admin credentials from utility scripts and use secret management.
