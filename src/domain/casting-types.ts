/** Casting module — persisted PocketBase shapes and UI helpers. */

export type CastingSessionId = string

export type CastingInputRecord = {
  id: string
  sessionId: string
  batchId?: string
  batchNumber?: number
  materialId?: string
  materialName: string
  qty: number
  rate: number
  amount: number
}

export type CastingBatchRecord = {
  id: string
  sessionId: string
  batchNumber: number
  wireOut: number
  mel: number
  inputs: CastingInputRecord[]
}

export type CastingMaterialRecord = {
  id: string
  name: string
  code: string
  category: string
  isActive: boolean
}

export type CastingSessionRecord = {
  id: CastingSessionId
  /** YYYY-MM-DD */
  date: string
  coalKg: number
  coalRate: number
  workerSalary: number
  unit: number
  wireOut: number
  wastage: number
  cholIn: number
  costPerKg: number
  metalCostPerKg: number
  coalCostPerKg: number
  workerCostPerKg: number
  finalProductCostPerKg: number
  totalWireOut: number
  totalMel: number
  totalInputCost: number
  totalInputKg: number
  note: string
  createdAt: string
  updatedAt: string
}

export type CastingSessionWithInputs = CastingSessionRecord & {
  batches: CastingBatchRecord[]
  /** Flattened batch inputs, kept for older reports/edit helpers. */
  inputs: CastingInputRecord[]
}

/** Snapshot stored in local trash (soft delete), same 3h TTL pattern as transactions. */
export type CastingSessionTrashSnapshot = {
  id: string
  date: string
  coalKg: number
  coalRate: number
  workerSalary: number
  unit: number
  wireOut: number
  wastage: number
  cholIn: number
  costPerKg: number
  finalProductCostPerKg: number
  totalInputCost: number
  totalInputKg: number
  note: string
  inputs: Array<{ materialName: string; qty: number; rate: number; amount: number }>
}

export type CastingTrashEntry = {
  key: string
  deletedAt: number
  snapshot: CastingSessionTrashSnapshot
}
