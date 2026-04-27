# Keyboard-First Workflow (New Bill + New Payment)

This document explains the keyboard-first entry flow implemented for:

- `New Bill`
- `New Payment`

The goal is to keep normal forms intact, but make daily operations faster through popup command entry.

## Trigger

- Press `Alt + B` on `New Bill` page to open **Bill Command** popup.
- Press `Alt + B` on `New Payment` page to open **Payment Command** popup.

No persistent command block is shown in page layout.

## New Bill Command Rules

### Core flow

1. Party (required, fuzzy matched)
2. Item (optional, fuzzy matched)
   - default item: `Spindle (8.5.Gm)` if omitted
3. Quantity (required)
4. Optional tokens: `rate`, `gst`, `date`, `+t transport`

### Quantity interpretation

- Quantity `<= 50` -> treated as **bags** (`bags * 50 = kg`)
- Quantity `> 50` -> treated as **kg**

### Defaults

- GST default: **off** (`0%`)
- Date default: **today**
- Rate default: `item.default_rate + current_mkt_rate`

### Supported examples

- `sambhu 10`
- `sambhu spindle 10 gst +t 2000`
- `sambhu tapper 620 790 -1`

## New Payment Command Rules

### Core flow

1. Party (required, fuzzy matched)
2. Amount (required)
3. Optional tokens: `mode`, `date`, `"note"`

### Defaults

- Mode default: **Cash**
- Date default: **today**

### Supported examples

- `sambhu 50000`
- `sambhu 1.5l`
- `sambhu 1.5l bank -1`
- `p sambhu 50000` (prefixed style also accepted)

## Parsing Notes

- Fuzzy matching currently uses simple includes-based matching.
- Amount shortcuts supported in payment parser:
  - `l` for lakh (e.g. `1.5l`)
  - `c` for crore
  - commas are accepted
- Date tokens supported:
  - `today`, `0`
  - `-1`, `yday`, `yesterday`
  - `DD-MM-YYYY`

## Behavior After Apply

- Parsed values are applied into the normal form fields.
- User can still review/edit in form before final save.
- Existing validation and save flows remain unchanged.

## Intent

This design keeps the UI simple and mobile-safe while enabling very fast operator entry with minimal typing.

