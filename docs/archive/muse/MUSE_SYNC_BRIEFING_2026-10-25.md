# SYNC BRIEFING — send this to Muse (25 Oct 2026)

Copy everything below the line to Muse. It updates his 24 Oct knowledge with
everything that changed since, resolves his open items with evidence, and confirms
the working workflow. After the system-prompt and onboarding message, this closes
the gap between what he remembers and what is true today.

---

Muse — Jay here. Your last full verification was 24 Oct. A lot was fixed on 25 Oct
and some of what you "know" is now wrong. Read this fully, then re-verify on the
live system yourself and send me your readiness report. Your user id is confirmed:
`ctfyi6ji1gvboks`, role `muse`.

## 1. Your open items — all resolved

**The leftover Adesh draft (`mqw0omvsi1jcqm1`) — nothing was lost.** That draft was
ALREADY converted. The real bill exists: `bills` id `wwuo0lpp0hop6z8`, book/bill
**201/250**, Adesh Bhai, dated 12 Oct 2026, mkt 920, LR "Shiv", items Tapper Plug
100 kg @ 1075 = ₹1,07,500 and Spindle (8.5GM) 400 kg @ 1065 = ₹4,26,000 — exactly
what you had staged. What you saw as "1 draft left pending" was a leftover husk
from the conversion cleanup; it was removed on 25 Oct along with other test junk.
Read bill 201/250 yourself to confirm.

**"No all drafts found" on 24 Oct — root cause found and fixed.** During the
integration churn, API rules on several collections were accidentally locked
behind login, so page queries silently returned empty (no error). Fixed on 25 Oct
by a proper migration. The drafts inbox now works and polls every 4 seconds.
Current drafts: 0 — that is the correct state, not a bug.

**`bill_jpg` — DONE and proven, your renderer is now only a fallback.** The field
exists on `bills`, and the app renders + uploads the official JPG automatically on
every bill save and every bill edit. Proof: bill 201/250 already carries
`bill_jpg: bill_201_250_12rebqa9eu.jpg`, publicly downloadable:
`GET http://kapil-products:4174/pb/api/files/bills/<bill_id>/<filename>`
(526 KB JPEG verified through the proxy). Your flow after I save a bill:
read the bill record → take `bill_jpg` filename → download the file → send it to
me on WhatsApp. Keep your Python renderer only for emergencies.

**`brass_rates` — readable again.** It was blocked for you on 24 Oct by the same
rules accident. It is open again — fetch today's `vilaity` yourself at session
start, as the rulebook says. `casting_*` and `stock_*` remain blocked to you, on
purpose; ignore them.

## 2. Corrections to your saved knowledge

1. **RATE RULE CHANGED 24 Oct: the ₹30 GST discount is GONE.** Official formula for
   every GST mode: `final rate = margin + market`. The copy of
   `MUSE_BUSINESS_LOGIC_AND_RULES.md` you saved still contains the ₹30 rule — that
   copy is OUTDATED, replace it. Your Mode A / Mode B from 23 Oct stay valid:
   A) I state the market → `rate = stated market + paper_rate`.
   B) I don't state it → `rate = B2B vilaity + 20 premium + paper_rate` (D.E.:
   paper_rate 90). When the last bill carried the premium, the app's own
   auto-suggest (rate 0) converges to the same number — so if you are ever unsure,
   send `rate: 0` and let the app suggest, or state the rate explicitly and show
   me the maths before staging.
2. **Anonymous access is open by design now.** The business collections
   (`bills`, `bill_items`, `bill_drafts*`, `customers`, `items`, `payments`,
   `brass_rates`) are public read AND write — the system is localhost/Tailscale-only
   by design. Your old rulebook heuristic "empty list = expired token" is RETIRED:
   an empty result now usually means empty. Still authenticate every session and
   send your token — it puts `created_by = ctfyi6ji1gvboks` on your drafts, which
   is how your work is identified.
3. **Base URL and the doors.** `http://kapil-products:4174/pb/api` (or
   `http://100.75.200.72:4174/pb/api`). Direct port 8090 is localhost-only —
   refused from Tailscale BY DESIGN since 25 Oct; Caddy on :4174 is the only door.
   Also new: ANY hostname on port 4174 now serves the app (the empty-200 vhost
   mismatch you hit on 24 Oct is fixed with a catch-all), so even if my Tailscale
   IP or MagicDNS name ever changes, you will get real responses, not empty 200s.
4. **Your 23 Oct "API Rulebook" needs these edits** (update your saved copy):
   base URL → the Tailscale Caddy URL, not `127.0.0.1:8090`; delete the superuser
   login recipe (you confirmed you no longer use it — keep it that way); the
   `kapil.zayu.dev` demo section is history; batch API works (we use it for every
   bill save); and "the API enforces almost nothing" is now half-true — draft
   numbering, status and relation integrity are still your responsibility, so keep
   those disciplines. Update your connector note (`custom.kapil-billing`) to the
   new base URL + muse user; it still points at the old demo.
5. **Counting drift:** you verified 240 bills on 24 Oct; the books now hold 241
   (bill 201/250 plus normal entries, minus 25 Oct junk cleanup). Don't assume
   counts match between sessions — always read fresh.

## 3. Your working workflow — confirmed, with two small upgrades

**Photo flow:** bill photo → you OCR → parse into the structured record → show me
the full maths → ONLY on my yes → stage in ONE atomic `/api/batch` call
(header in `bill_drafts` with your own 15-char id, one `bill_draft_items` row per
line with the `draft` relation, any advance in `bill_draft_payments`) → after I
approve and save in the app, the JPG appears on the bill → you download it and
WhatsApp it to me. I forward it to the party in 2 taps.

**Dictation flow ("X party X katte…"):** read that party's last bill → derive the
paper rate (margin) → apply Mode A or B with today's vilaity → show me the full
structured record + maths → on my yes → stage the same atomic way.

Upgrades:
- **Numbers:** leave `book_no: 0, bill_no: 0` unless I dictate a diary number. If I
  dictate one ("bill 060"), your formula is right: book = floor((N−1)/50)×50+1 →
  book 51, bill 60 — check that `(book_no, bill_no)` is unused first, then set it.
- **After staging:** one confirmation message with the draft id, then stop — the
  inbox polls by itself. When the draft is `approved` with `converted_bill` set,
  that's your cue that the bill exists and the JPG is ready to fetch.

Unchanged rules that still stand: never post a live bill without my yes; never add
transport or GST unless I state them; never delete anything without me confirming
that exact record; payments default Bank, Cash only when I say; katte = 50 kg via
the item's `bag_weight`; relational line items are mandatory — a JSON items array
alone was never enough.

## 4. What changed on my side today (so you don't rediscover it)

Rules migration restored public access to `brass_rates` + stock; PocketBase now
binds localhost only (Caddy is the door); the Caddy catch-all; drafts inbox +
New Bill banner both load drafts with their items AND advance payments; party/item
matching in the app is now exact-or-alias only (no fuzzy guesses — unmatched stays
unmatched, which is what I want); bill JPG generation now uses the exact same
balance maths as the on-screen preview; a pile of one-off fix scripts and the old
Telegram bot were removed from the machine. None of this changes your API surface
beyond what's written above.

## 5. Pending decisions (I will answer, don't assume)

1. Should you AUTO-send me the bill JPG on WhatsApp as soon as you see a draft
   converted (`status: approved` + `converted_bill`), or only when I ask
   ("bill photo 201/250")? I'm leaning auto-send — tell me if you see a problem.
2. A learning endpoint is coming: it will show you each of your drafts next to the
   final bill I saved, with every difference. You'll read it yourself and stop
   repeating my corrections. Watch for it.
3. I will rotate your password soon and send it once in chat; store it in your
   Secure Vault, use it transiently, never write it into files or memory notes.

## 6. Your first reply — do this now

Re-run your session bootstrap against the live system (auth → customers + items
with aliases → latest `brass_rates`), read bill 201/250 to confirm section 1, then
reply with:

```
1. RE-SYNC: auth OK/FAILED · host used: <url> · parties: <N> · items: <N> ·
   today's vilaity: <₹X, date> · bill 201/250 verified: YES/NO
2. RULE CHANGES CONFIRMED: no −30 GST discount · brass_rates readable ·
   bill_jpg live · anonymous-open design · new base URL
3. QUESTIONS: <numbered list of remaining doubts — or "none">
4. READY: type "Drafts only, atomic batch, rate 0 when unsure, JPG after save."
```

---
# END OF BRIEFING

### Note to Jay (not part of the message)
Send this AFTER (or with) the onboarding message. Section 1 resolves every open
item from his report with record ids he can verify himself, section 2 retires the
stale rules (₹30 discount, empty-list heuristic, superuser/demo URLs), and section
3 locks in your photo → draft → JPG-on-WhatsApp loop. His reply gives you his
re-sync report and any last doubts — bring that back here and I'll close them.
