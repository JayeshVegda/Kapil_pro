import { describe, expect, it } from 'vitest'
import {
  bundleToLedgerInput,
  bundleToSettlementInput,
  type SupplierBundle,
} from '@/data/suppliers'
import { buildSupplierLedger } from './supplier-ledger'
import { computeSupplierSettlement } from './supplier-settlement'

function makeBundle(overrides: Partial<SupplierBundle> = {}): SupplierBundle {
  return {
    supplier: {
      id: 'sup1',
      companyName: 'Test Supplier',
      contactName: 'Rajesh',
      phone: '9876543210',
      gstNo: '',
      city: 'Jamnagar',
      notes: '',
      openingKachaPaise: 0,
      openingGstPaise: 0,
      openingBalanceDate: '2026-04-01',
      active: true,
      created: '2026-04-01 00:00:00.000Z',
    },
    bills: [],
    lines: [],
    adjustments: [],
    bardan: [],
    payments: [],
    allocations: [],
    ...overrides,
  }
}

describe('Supplier Ledger and Settlement Reconciliation', () => {
  it('reconciles basic bills and payments: ledger closing == settlement net position', () => {
    const bundle = makeBundle({
      supplier: {
        id: 'sup1',
        companyName: 'Maruti Metals',
        contactName: '',
        phone: '',
        gstNo: '',
        city: 'Jamnagar',
        notes: '',
        openingKachaPaise: 10_00_000,
        openingGstPaise: 0,
        openingBalanceDate: '2026-04-01',
        active: true,
        created: '2026-04-01 00:00:00.000Z',
      },
      bills: [
        {
          id: 'b1',
          supplierId: 'sup1',
          inNo: 'IN-001',
          supplierBillNo: '',
          date: '2026-04-05',
          pool: 'kacha',
          taxMode: 'none',
          gstRateBp: 0,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-05 10:00:00.000Z',
        },
      ],
      lines: [
        {
          id: 'l1',
          billId: 'b1',
          itemId: 'i1',
          itemName: 'Brass Scrap',
          weightG: 100_000,
          rateMilli: 800_000,
          amountPaise: 80_00_000,
          created: '2026-04-05 10:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'p1',
          supplierId: 'sup1',
          date: '2026-04-10',
          pool: 'kacha',
          kind: 'payment',
          amountPaise: 50_00_000,
          mode: 'RTGS',
          reference: 'REF123',
          payeeName: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-10 12:00:00.000Z',
        },
      ],
    })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const ledger = buildSupplierLedger(bundleToLedgerInput(bundle))

    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
    expect(ledger.closingPaise).toBe(10_00_000 + 80_00_000 - 50_00_000)
  })

  it('reconciles bardan deduct and adjustments', () => {
    const bundle = makeBundle({
      bills: [
        {
          id: 'b1',
          supplierId: 'sup1',
          inNo: 'IN-002',
          supplierBillNo: '',
          date: '2026-04-06',
          pool: 'kacha',
          taxMode: 'none',
          gstRateBp: 0,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-06 10:00:00.000Z',
        },
      ],
      lines: [
        {
          id: 'l1',
          billId: 'b1',
          itemId: 'i1',
          itemName: 'Brass Scrap',
          weightG: 200_000,
          rateMilli: 750_000,
          amountPaise: 150_00_000,
          created: '2026-04-06 10:00:00.000Z',
        },
      ],
      adjustments: [
        {
          id: 'a1',
          billId: 'b1',
          type: 'labour',
          amountPaise: 5_000,
          created: '2026-04-06 10:01:00.000Z',
        },
        {
          id: 'a2',
          billId: 'b1',
          type: 'quality_cut',
          amountPaise: 10_000,
          created: '2026-04-06 10:02:00.000Z',
        },
      ],
      bardan: [
        {
          id: 'bd1',
          billId: 'b1',
          bardanG: 2_000,
          rateLineId: 'l1',
          rateMilli: 750_000,
          method: 'deduct',
          creditPaise: 15_000,
          cashAmountPaise: 0,
          date: '2026-04-06',
          note: '2 bags deducted',
          created: '2026-04-06 10:03:00.000Z',
        },
      ],
    })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const ledger = buildSupplierLedger(bundleToLedgerInput(bundle))

    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
    expect(ledger.closingPaise).toBe(150_00_000 + 5_000 - 10_000 - 15_000)
  })

  it('reconciles GST bill with tax mode gst and RCM mode', () => {
    const bundle = makeBundle({
      bills: [
        {
          id: 'b_gst',
          supplierId: 'sup1',
          inNo: 'IN-GST-1',
          supplierBillNo: 'SUP-99',
          date: '2026-04-08',
          pool: 'gst',
          taxMode: 'gst',
          gstRateBp: 1800,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-08 10:00:00.000Z',
        },
        {
          id: 'b_rcm',
          supplierId: 'sup1',
          inNo: 'IN-RCM-1',
          supplierBillNo: 'SUP-100',
          date: '2026-04-09',
          pool: 'gst',
          taxMode: 'rcm',
          gstRateBp: 1800,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-09 10:00:00.000Z',
        },
      ],
      lines: [
        {
          id: 'l_gst',
          billId: 'b_gst',
          itemId: 'i1',
          itemName: 'Brass Rods',
          weightG: 100_000,
          rateMilli: 1_000_000,
          amountPaise: 100_00_000, // GST bill net = 100L + 18% = 118L
          created: '2026-04-08 10:00:00.000Z',
        },
        {
          id: 'l_rcm',
          billId: 'b_rcm',
          itemId: 'i1',
          itemName: 'Scrap under RCM',
          weightG: 50_000,
          rateMilli: 800_000,
          amountPaise: 40_00_000, // RCM bill payable to supplier = base only (40L)
          created: '2026-04-09 10:00:00.000Z',
        },
      ],
    })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const ledger = buildSupplierLedger(bundleToLedgerInput(bundle))

    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
    expect(ledger.closingPaise).toBe(118_00_000 + 40_00_000)
  })

  it('reconciles manual payment allocations (pins), refund_received, and bardan_advance', () => {
    const bundle = makeBundle({
      bills: [
        {
          id: 'b1',
          supplierId: 'sup1',
          inNo: 'IN-101',
          supplierBillNo: '',
          date: '2026-04-01',
          pool: 'kacha',
          taxMode: 'none',
          gstRateBp: 0,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-01 10:00:00.000Z',
        },
        {
          id: 'b2',
          supplierId: 'sup1',
          inNo: 'IN-102',
          supplierBillNo: '',
          date: '2026-04-02',
          pool: 'kacha',
          taxMode: 'none',
          gstRateBp: 0,
          groupId: '',
          vehicleNo: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-02 10:00:00.000Z',
        },
      ],
      lines: [
        {
          id: 'l1',
          billId: 'b1',
          itemId: 'i1',
          itemName: 'Item 1',
          weightG: 50_000,
          rateMilli: 1_000_000,
          amountPaise: 50_00_000,
          created: '2026-04-01 10:00:00.000Z',
        },
        {
          id: 'l2',
          billId: 'b2',
          itemId: 'i1',
          itemName: 'Item 2',
          weightG: 80_000,
          rateMilli: 1_000_000,
          amountPaise: 80_00_000,
          created: '2026-04-02 10:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'p_pin',
          supplierId: 'sup1',
          date: '2026-04-04',
          pool: 'kacha',
          kind: 'payment',
          amountPaise: 60_00_000,
          mode: 'Bank',
          reference: 'PIN-1',
          payeeName: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-04 10:00:00.000Z',
        },
        {
          id: 'p_ba',
          supplierId: 'sup1',
          date: '2026-04-03',
          pool: 'kacha',
          kind: 'bardan_advance',
          amountPaise: 10_00_000,
          mode: '',
          reference: '',
          payeeName: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-03 10:00:00.000Z',
        },
        {
          id: 'p_refund',
          supplierId: 'sup1',
          date: '2026-04-05',
          pool: 'kacha',
          kind: 'refund_received',
          amountPaise: 15_00_000,
          mode: 'Cash',
          reference: 'REFUND',
          payeeName: '',
          privateNote: '',
          photos: [],
          cancelled: false,
          cancelReason: '',
          created: '2026-04-05 10:00:00.000Z',
        },
      ],
      allocations: [
        {
          id: 'pin1',
          paymentId: 'p_pin',
          billId: 'b2',
          amountPaise: 40_00_000,
          created: '2026-04-04 10:01:00.000Z',
        },
      ],
    })

    const settlement = computeSupplierSettlement(bundleToSettlementInput(bundle))
    const ledger = buildSupplierLedger(bundleToLedgerInput(bundle))

    expect(ledger.closingPaise).toBe(settlement.combined.netPositionPaise)
    expect(settlement.combined.outstandingPaise - settlement.combined.advancePaise).toBe(ledger.closingPaise)
  })
})
