# Kapil Products – Complete Billing Business Logic & Rules Guide

This document is the official **rulebook and logic specification** for **Muse AI** and the **Kapil Products Billing System**.

---

## 1. Core Industry & Product Knowledge

Kapil Products manufactures and trades:
1. **Gas Billing Items (`type: "gas"`):**
   - Brass precision parts, spindles, gas fittings, kharedi.
   - Sold strictly **by weight in kilograms (`kg`)**.
   - Rates fluctuate daily based on the **Jamnagar Brass Market Scrap Rate (`mkt`)**.
2. **Electronic Billing Items (`type: "electronic"`):**
   - Electronic parts, accessories, hardware components.
   - Sold **per piece (`pcs`)**.
   - Flat unit price — **NOT** tied to daily brass market rate.

---

## 2. Bag Weight & Katte Calculation (Gas Items)

- Brass gas items are packed in gunny bags called **katte** (or bags).
- **Standard Bag Weight = 50 kg** (unless item master specifies otherwise).

### Conversions:
$$\text{Total Qty (kg)} = \text{Bags (katte)} \times 50$$
$$\text{Bags (katte)} = \text{Round}\left(\frac{\text{Total Qty (kg)}}{50}\right)$$

### Examples:
- Dictated: *"6 katte spindle"* → `bags: 6`, `qty: 300` (300 kg).
- Dictated: *"250 kg spindle"* → `qty: 250`, `bags: 5` (5 katte).
- Dictated: *"1 katte 40 kg"* → `bags: 1`, `qty: 40`.

---

## 3. Market Rate (`mkt`) & Margin Logic

Gas billing rates are **dynamic** and calculated using:
1. **Daily Market Rate (`mkt`):** The Jamnagar brass scrap rate for the day (e.g. ₹505, ₹510).
2. **Item/Customer Margin (`defaultRate`):** The profit/manufacturing margin above or below the market rate (e.g. +₹5, +₹10, -₹2).
3. **No Rate Discount for GST:** Rate per kg is strictly based on Margin + Market. There is **NO** discount/deduction for GST on the item rate.

---

### Formula 1: Final Billing Rate (Per Kg)

$$\text{Final Rate} = \text{Margin Rate} + \text{Market Rate}$$

---

### Examples of Rate Calculation:

#### Example A: Market = ₹505, Spindle Margin = +₹5 (Any GST Mode)
$$\text{Rate} = 5 + 505 = \mathbf{₹510/\text{kg}}$$

*(If GST 18% is selected, the item rate remains ₹510/kg; the 18% tax is calculated and added to the bill grand total separately).*

---

### Formula 2: Deriving Customer Margin from Last Bill

When checking what margin a customer was charged on an earlier bill:
$$\text{Customer Margin} = \text{Billed Rate} - \text{Past Market Rate}$$

#### Example:
A customer was billed at ₹508 when market was ₹500:
$$\text{Margin} = 508 - 500 = +\mathbf{₹8/\text{kg}}$$
Next time, if market goes up to ₹515:
$$\text{New Rate} = 8 + 515 = \mathbf{₹523/\text{kg}}$$

---

## 4. GST Modes & Calculation

| Mode | `gst_mode` | GST Rate | How GST Amount is Computed |
| :--- | :--- | :--- | :--- |
| **Without GST** | `"none"` | 0% | `gst_amount = 0` |
| **With 18% GST** | `"percent18"` | 18% | `gst_amount = 18% of itemsTotal` (Transport excluded!) |
| **Manual GST** | `"manual"` | Custom | Explicit rupee amount (e.g. ₹1250) |

> [!IMPORTANT]
> **Transport is NOT taxed under the 18% GST item calculation.**
> GST 18% is calculated strictly on `itemsTotal`.

---

## 5. Bill Total Formulas

1. **Items Line Total:**
   $$\text{Line Amount} = \text{Quantity (kg/pcs)} \times \text{Rate}$$
2. **Items Subtotal (`itemsTotal`):**
   $$\text{itemsTotal} = \sum (\text{Line Amounts})$$
3. **GST Amount (`gstAmount`):**
   - If `percent18`: $\text{roundPaise}\left(\frac{\text{itemsTotal} \times 18}{100}\right)$
   - If `manual`: fixed override amount
   - If `none`: 0
4. **Grand Total (`grandTotal`):**
   $$\text{grandTotal} = \text{itemsTotal} + \text{gstAmount} + \text{transport}$$
5. **Payable After Adjustments (`Amount Due`):**
   $$\text{Payable} = \text{grandTotal} + \text{Previous Balance} - \text{Credits} - \text{Quick Advance Payments}$$

---

## 6. Physical Bill Books (Pads) Numbering System

Kapil Products uses physical printed bill pads.
- Each pad has **50 bills (`BILL_BOOK_SIZE = 50`)**.
- The **Book Number** is the first bill number in that pad:
  - **Book 1:** Bills 1 to 50
  - **Book 51:** Bills 51 to 100
  - **Book 101:** Bills 101 to 150
  - **Book 151:** Bills 151 to 200
  - **Book 201:** Bills 201 to 250
  - **Book 251:** Bills 251 to 300
  - **Book 69:** Common/Temporary general book used when a party's pad is finished or unassigned.

### Formula:
$$\text{Book No} = \left\lfloor\frac{\text{Bill No} - 1}{50}\right\rfloor \times 50 + 1$$
- Bill #250 belongs to **Book 201** (range 201–250).
- Bill #251 belongs to **Book 251** (range 251–300).

---

## 7. Golden Rules for Muse When Creating Drafts

1. **When Rate is explicitly dictated:**
   Use that exact rate (e.g. *"510 ke bhav se"* → `rate: 510`).
2. **When Rate is NOT dictated:**
   You can pass `rate: 0` (or omit rate). The Kapil Products billing system will **automatically lookup the customer's previous margin and today's market rate** to suggest the perfect rate!
3. **When Bags (Katte) are dictated:**
   Always convert katte to kg (`qty = katte * 50`) AND store `bags: katte`.
4. **When Transport / Tempo charges are mentioned:**
   Store in `transport` field (e.g. *"tempo 300"* → `transport: 300`).
5. **When Advance / Payment is mentioned:**
   Create a record in `bill_draft_payments` (e.g. *"25000 RTGS aya"* → `amount: 25000`, `mode: "Bank"`).
6. **When LR / Bilti number is mentioned:**
   Store in `lr_no` field (e.g. *"Bilti 8892"* → `lr_no: "8892"`).
7. **Always link `draft` relation:**
   In `bill_draft_items`, always set `"draft": draft_id` so the line items link directly to the draft header.
