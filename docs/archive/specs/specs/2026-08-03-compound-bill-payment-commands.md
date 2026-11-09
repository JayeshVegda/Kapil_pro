# Compound Bill Payment Commands

## Goal

Allow one Control-K bill command to create a bill draft with one or more separately dated payments for the same party.

## Command grammar

The bill remains the leading clause. Each `+ p`, `+ pay`, or `+ payment` starts an attached payment clause:

`b sambhu 5 + p 3l tmr + p 1l bank fri`

An attached payment accepts `amount [cash|bank] [date] ["note"]`. It inherits the bill customer, defaults to cash and today's date, and can use friendly dates such as `tmr`, `yday`, or a weekday. A payment date never changes the bill date.

Normal `+` item separators and `+t` transport modifiers retain their existing meaning.

## User experience

Control-K previews the bill total, each attached payment, payment total, and remaining amount due. Future-dated payments show an informational warning. Opening the draft populates the existing New Bill quick-payment rows, where every payment can be reviewed or edited before saving.

Payments are created as normal payment-log records when the bill is saved. There is no overdue automation: if the expected payment does not happen, the operator edits or removes the payment in the existing logs.

## Validation

Every payment clause requires a positive amount. Unknown mode/date tokens stop command submission with a focused error. Automated tests cover multiple payment clauses, friendly dates, payment modes, and backward compatibility with multi-item bill commands.
