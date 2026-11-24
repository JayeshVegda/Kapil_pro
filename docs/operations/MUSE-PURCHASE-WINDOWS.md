# Muse Purchase assistant — Windows

This is the shared private Muse gateway for Kapil Sales, Purchase, and Casting drafts (when enabled). The old Sales connector, PocketBase proxy, and PaymentDesk routes are unchanged. The gateway cannot post transactions, void records, or reach arbitrary collections.

If the Purchase connector is already installed, use `windows\update-muse-connector.ps1` from elevated PowerShell. It checks the build, backs up and applies pending migrations, and restarts only the existing connector task after Kapil is healthy. Your private URL, API key, and encrypted writer login stay the same. Give Muse the [Sales playbook](../architecture/MUSE-SALES-PLAYBOOK.md) and keep the old Sales connection until the new one passes a comparison.

## Install once

1. In elevated Windows PowerShell as the Kapil Windows user, run `windows\update-muse-purchase-database.ps1`. It stops the `KapilPocketBase` and `KapilCaddy` Windows services, takes an offline backup, restarts both services, and verifies migrations `1794640016` through `1794640020`. It skips the restart if updates are already applied. Do not use the older manual launcher while those services are installed.
2. In the same PowerShell, run `windows\install-muse-purchase.ps1`. Enter the **existing normal Muse PocketBase password** once at the hidden Windows prompt; never the admin password. The installer verifies the role on loopback, then saves the writer login encrypted to this Windows user. For private read and preview only, use `-ReadOnly` on first setup.
3. The installer prints one new **Purchase API key** and the private HTTPS address. Enter the key into the Muse connector's secure setup, with header **X-API-Key** (or Bearer auth). Set the base URL to the printed `https://…ts.net:8443`. Do not send the key by chat, put it in a URL, or store it in Git. If Tailscale asks for HTTPS consent, approve in its web UI and rerun setup. Use [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), never Funnel. The tailnet's access rules should allow only your devices and the Muse VM to use this port.
4. Ask Muse to call **GET /v1/health** and **GET /v1/modules**, then preview a Purchase bill. To test staging, verify the proposal in **AI Drafts** and reject any fictional entry rather than confirming it. Verify Sales and enabled Casting separately before relying on them.

The task **Kapil Muse Purchase** starts at your Windows logon, uses bundled Node with no new installs, and keeps the API listener on loopback port 4796. The PC must be awake and on Tailscale. Use `-RotateApiKey` if the key is lost or exposed; replace the old key in Muse. Use `-UpdateWriterLogin` after rotating the normal Muse PocketBase password. `-SkipTailscale` starts only the local service. Stop the scheduled task to disable it; turn off this specific Tailscale Serve port if removing the connector permanently.

## Instructions for Muse

Give Muse the [complete Purchase playbook and API reference](../architecture/MUSE-PURCHASE-PLAYBOOK.md) for terminology, full request examples, bardan logic and error handling.

Use the same key for all three gateway modules. Don't request the PocketBase password or use the key on `/pb` or `/muse`. Only explicit customer/supplier creation can bypass draft review. All transactions must be staged. In **AI Drafts** the owner can preview and confirm to post, preview and load to edit manually, or preview and reject with a reason. Use one stable source ID per action and check status before retrying an uncertain write.

Create masters with `POST /v1/sales/customer` or `POST /v1/purchase/supplier` using `{"sourceId":"message-id:party","name":"Company name"}`. For Casting, read `GET /v1/casting/materials`, use `POST /v1/casting/preview/session` then `POST /v1/casting/drafts/session` with the [Casting v1 payload](../architecture/MUSE-DRAFT-SCHEMA.md), and check `GET /v1/casting/drafts/status?sourceId=…`.

| Operation | Request |
| --- | --- |
| Confirm connector credentials | `GET /v1/health` |
| Total dues or one supplier | `GET /v1/dues[?supplier=…]` |
| Latest actual payment | `GET /v1/recent-payment[?supplier=…]` |
| Supplier and item matching | `GET /v1/supplier?supplier=…`, `GET /v1/item?name=…` |
| Slips by supplier, or exact inward number | `GET /v1/slips?supplier=…&pending=true&page=1` or `GET /v1/slips?inNo=IN-…`; add `invoice=…` to filter on that supplier’s exact invoice reference |
| Preview any proposal without saving | `POST /v1/preview/{bill,payment,bardan,new-supplier-bill}` |
| Stage an owner-review proposal | `POST /v1/drafts/{bill,payment,bardan,new-supplier-bill}` |
| Verify a staged proposal or check its status | `GET /v1/drafts/status?type=bill&sourceId=…` (use `payment` or `action` for other types) |

The balance, payment, and slip lookups accept an optional `asOf=YYYY-MM-DD` and default to today in India. Balances come from the app's settlement code. Amount fields ending in `Paise` are integer paise; divide by 100 to display rupees. Keep payable and advance separate, by Kacha and GST, and include `dueNotOnSlipsPaise` when reconciling the pending-list total with the supplier balance.

POST body: `{"sourceId":"unique-stable-message-id","originalMessage":"exact user message","payload":{...}}`. The source ID accepts letters, numbers, colon, underscore, period, slash and hyphen. Same message + same payload reuses the existing draft. A changed proposal with the same ID is reported as a conflict rather than creating a duplicate.

- **Bill:** use the [Purchase Bill v2 payload](../architecture/MUSE-DRAFT-SCHEMA.md). Specify `pool`; for GST pool specify charged GST or RCM. Use exact supplier and item names returned by lookup when an alias is ambiguous.
- **Payment:** use [Purchase Payment v1](../architecture/MUSE-DRAFT-SCHEMA.md) with explicit pool, type and payment mode. Do not send `bill_pins`. The preview shows due and advance before/after. If the user says “deposit” and direction isn't clear, ask whether money was paid out or received.
- **Bardan:** send `{"billId":"<slip id>","lineId":"<slip line id>","bagCount":16,"weightG":3080,"method":"deduct"}`. The connector uses the saved line rate. You may use `inNo` instead of `billId`; `lineId` can be omitted only for a one-line slip. Use `in_kind` for a physical settlement without deduction. Ask which slip if there are several candidates.
- **New supplier + first bill:** use the bill payload with new `supplier_name`, no `supplier_id`, and ordinary item lines. The first bill proposal accepts date, pool/tax, supplier invoice number and lines, not on-bill payment or additional adjustments. Kapil checks the name again and creates the supplier and first bill together on confirmation, or saves neither.
