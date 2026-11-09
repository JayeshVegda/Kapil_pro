# Bill-Attached Payment Cutoff Design

## Problem

New Bill currently classifies same-day payments by creation timestamp. A quick payment is necessarily created just after its bill, so the next bill treats it as a new period credit even though it was already shown and applied on the preceding bill. Aryan Enterprice bill `101/126` demonstrates the bug: its attached ₹2,40,000 payment is displayed again while preparing the next bill.

## Required accounting behavior

Payments whose note identifies a bill using the existing `Quick payment with bill <book>/<bill>` format belong to that bill. When preparing a later bill:

- payments attached to the last or an earlier bill are included in previous balance;
- those payments are not repeated as period credits;
- independent payments after the last bill remain visible as period credits;
- quick payments entered on the current draft remain visible on that draft and reduce its final amount;
- unrelated same-day payments retain timestamp-based cutoff behavior.

Legacy attached payments are recognized from their stored note, so no data migration is required. Unknown or manually written notes are not guessed.

## Calculation boundary

A focused domain helper will identify the normalized bill reference in an attached-payment note and classify whether a payment belongs before or after a bill cutoff. New Bill will use this helper instead of relying only on payment creation time. Existing Print Bill behavior must remain consistent: a payment appears on its own bill, but not again on a later bill.

## Verification

Automated tests will cover:

- an attached payment created milliseconds after its bill;
- an independent same-day payment created after the bill;
- a payment attached to an earlier bill;
- malformed or unrelated notes;
- the Aryan `101/126` scenario, where ₹2,40,000 is folded into previous balance and omitted from previous credits.

The production build, full test suite, and live deployment asset will be verified before handoff.
