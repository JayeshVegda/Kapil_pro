# Muse AI Relational Staging Integration Guide

Welcome Muse! This document contains the complete specification for integrating with the **Kapil Products Billing System** using the **clean relational schema** that mirrors `bills` and `bill_items`.

---

## 1. Relational Architecture (Exact Mirror of Bills)

The draft system mirrors the production billing structure with dedicated tables:
- **`bill_drafts`**: Draft Header (party, date, book/bill no, transport, GST, notes, status).
- **`bill_draft_items`**: Individual Line Items (each row linked to `draft` via relation with cascade delete).
- **`bill_draft_payments`**: Quick Advances/Payments (each row linked to `draft` via relation).

---

## 2. API Endpoints & Authentication

### Base URL (over Tailscale)
```
http://kapil-products:4174/pb/api
```

### Authentication
```http
POST http://kapil-products:4174/pb/api/collections/users/auth-with-password
Content-Type: application/json

{
  "identity": "muse@kapil.cosearch.me",
  "password": "<see runtime/state/muse-credentials.json — never commit this password>"
}
```

Use `Authorization: Bearer YOUR_JWT_TOKEN` for all subsequent requests.

---

## 3. Staging a Bill: 2 Simple HTTP Calls

### Step 1: Create the Draft Header (`bill_drafts`)
```http
POST http://kapil-products:4174/pb/api/collections/bill_drafts/records
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "customer_name": "Adesh Brass",
  "book_no": 69,
  "bill_no": 250,
  "date": "2026-10-24",
  "mkt": 505,
  "transport": 350,
  "gst_mode": "percent18",
  "gst_rate": 18,
  "lr_no": "LR-88219",
  "status": "pending_review",
  "confidence": 0.98,
  "notes": "Adesh Bhai 250 bill with 6 katte spindle and transport",
  "raw_text": "Adesh Bhai ko 6 katte spindle 8.5 bheje, bill no 250, transport 350"
}
```

*Response returns the created draft record ID, e.g. `"id": "x8k2l1m9p0q3r4s"`.*

---

### Step 2: Create Line Items in `bill_draft_items` (One per Item Row)
```http
POST http://kapil-products:4174/pb/api/collections/bill_draft_items/records
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "draft": "x8k2l1m9p0q3r4s",
  "item_name": "Spindle (8.5 Gm)",
  "qty": 300,
  "bags": 6,
  "rate": 510,
  "amount": 153000
}
```

*(Repeat for any additional item rows).*

---

### Step 3 (Optional): Create Quick Payment in `bill_draft_payments`
```http
POST http://kapil-products:4174/pb/api/collections/bill_draft_payments/records
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "draft": "x8k2l1m9p0q3r4s",
  "customer_name": "Adesh Brass",
  "date": "2026-10-24",
  "amount": 25000,
  "mode": "Bank",
  "note": "Advance payment via NEFT"
}
```

---

## 4. Alternative: Single PocketBase Batch Request

You can also send everything in a single atomic transaction using `POST /api/batch`:

```http
POST http://kapil-products:4174/pb/api/batch
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "batch": [
    {
      "method": "POST",
      "url": "/api/collections/bill_drafts/records",
      "body": {
        "id": "adesh250draft01",
        "customer_name": "Adesh Brass",
        "book_no": 69,
        "bill_no": 250,
        "date": "2026-10-24",
        "mkt": 505,
        "transport": 350,
        "gst_mode": "percent18",
        "status": "pending_review",
        "notes": "Adesh Bhai bill 250"
      }
    },
    {
      "method": "POST",
      "url": "/api/collections/bill_draft_items/records",
      "body": {
        "draft": "adesh250draft01",
        "item_name": "Spindle (8.5 Gm)",
        "qty": 300,
        "bags": 6,
        "rate": 510,
        "amount": 153000
      }
    }
  ]
}
```

---

## 5. What Happens Next?
1. In **PocketBase Admin Dashboard (`http://127.0.0.1:8090/_/`)**, you see:
   - `bill_drafts` contains the draft header with clickable relations.
   - `bill_draft_items` contains each individual item row linked to the draft.
2. In **Jay's Billing App (`http://127.0.0.1:4174/drafts`)**, Jay sees the staged bill with all items, bag counts, and rates.
3. Jay clicks **"Review & Load in Bill"** → clicks **"Save Bill"** → PocketBase links `converted_bill` to the official bill in `bills`!
