# Control-K Summary and Customer Book Design

## Outcome

Control-K shows only the totals needed to verify a bill or payment. Selecting a party reuses that party's most recent book. A finished preferred book never advances automatically: the UI warns and temporarily selects book 69.

## Bill preview

Show party, selected book/next bill, item rows, item subtotal, GST when applicable, transport when applicable, bill total, previous balance, and amount due. Explicit command book/bill values override automatic selection.

## Payment preview

Show party, payment amount, mode/date, current party balance, and balance after payment.

## Book selection

Find the party's latest bill by business date, creation timestamp, then record ID. Reuse its book while that book has a next number. If it is full, show `Preferred book N is finished. Using temporary book 69.` and select the next available number in book 69. Do not advance to book N+1. Manual book input always wins.

If the party has no prior bill, keep the current New Bill book. If both preferred and temporary books are full, show a blocking warning instead of inventing another book.

## Tests

Unit tests cover bill totals, payment balances, normal preferred-book selection, and full-book fallback.
