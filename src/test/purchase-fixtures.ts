import type {
  PurchaseBardanView,
  PurchaseBillView,
  PurchaseLineView,
  SupplierBundle,
  SupplierPaymentView,
  SupplierView,
} from '@/data/suppliers'

export function supplierFixture(overrides: Partial<SupplierView> = {}): SupplierView {
  return {
    id: 'supplier1', companyName: 'Test Metals', contactName: '', phone: '', gstNo: '', city: '', notes: '',
    openingKachaPaise: 0, openingGstPaise: 0, openingBalanceDate: '2026-10-01', active: true,
    created: '2026-10-01 08:00:00Z', ...overrides,
  }
}

export function billFixture(overrides: Partial<PurchaseBillView> = {}): PurchaseBillView {
  return {
    id: 'bill1', supplierId: 'supplier1', inNo: 'IN-001', supplierBillNo: '', date: '2026-10-02', pool: 'kacha',
    taxMode: 'none', gstRateBp: 0, groupId: '', vehicleNo: '', privateNote: '', photos: [], cancelled: false,
    cancelReason: '', created: '2026-10-02 10:00:00Z', ...overrides,
  }
}

export function lineFixture(overrides: Partial<PurchaseLineView> = {}): PurchaseLineView {
  return {
    id: 'line1', billId: 'bill1', itemId: '', itemName: 'Scrap', weightG: 100_000, rateMilli: 10_000,
    amountPaise: 100_000, created: '2026-10-02 10:00:00Z', ...overrides,
  }
}

export function paymentFixture(overrides: Partial<SupplierPaymentView> = {}): SupplierPaymentView {
  return {
    id: 'payment1', supplierId: 'supplier1', date: '2026-10-03', pool: 'kacha', kind: 'payment',
    amountPaise: 60_000, mode: 'cash', reference: '', payeeName: '', privateNote: '', photos: [],
    cancelled: false, cancelReason: '', created: '2026-10-03 10:00:00Z', ...overrides,
  }
}

export function bardanFixture(overrides: Partial<PurchaseBardanView> = {}): PurchaseBardanView {
  return {
    id: 'bardan1', billId: 'bill1', bardanG: 1000, rateLineId: 'line1', rateMilli: 100_000,
    method: 'deduct', creditPaise: 10_000, cashAmountPaise: 0, date: '2026-10-04', note: '',
    created: '2026-10-04 10:00:00Z', ...overrides,
  }
}

export function bundleFixture(overrides: Partial<SupplierBundle> = {}): SupplierBundle {
  return {
    supplier: supplierFixture(), bills: [billFixture()], lines: [lineFixture()], adjustments: [],
    bardan: [], payments: [], allocations: [], ...overrides,
  }
}
