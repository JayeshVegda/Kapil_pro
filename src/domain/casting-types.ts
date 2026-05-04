/** Casting module — persisted PocketBase shapes and UI helpers. */

export type CastingSessionId = string

export type CastingInputRecord = {
  id: string
  sessionId: string
  materialName: string
  qty: number
  rate: number
  amount: number
}

export type CastingSessionRecord = {
  id: CastingSessionId
  /** YYYY-MM-DD */
  date: string
  unit: number
  wireOut: number
  wastage: number
  cholIn: number
  costPerKg: number
  totalInputCost: number
  totalInputKg: number
  note: string
  createdAt: string
  updatedAt: string
}

export type CastingSessionWithInputs = CastingSessionRecord & {
  inputs: CastingInputRecord[]
}

/** Snapshot stored in local trash (soft delete), same 3h TTL pattern as transactions. */
export type CastingSessionTrashSnapshot = {
  id: string
  date: string
  unit: number
  wireOut: number
  wastage: number
  cholIn: number
  costPerKg: number
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
