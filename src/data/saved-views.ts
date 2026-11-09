import { pb } from '@/data/pocketbase'
import { runDataOperation } from '@/data/reliability'

/**
 * Saved list views (operational redesign Phase 2). A saved view is the owner's
 * named snapshot of URL filter params for one page scope. Views store the
 * filter configuration only — never data — and applying one writes the same
 * URL search params the page already validates, so re-using a view can never
 * drift past this module's sanitization.
 */

export type SavedViewScope = 'purchase-bills'

export type PurchaseBillsFilterConfig = {
  view?: 'bills' | 'payments'
  supplier?: string
  tab?: string
  pool?: string
  q?: string
  from?: string
  to?: string
  kind?: string
  payq?: string
}

export type PurchaseBillsSavedView = {
  id: string
  name: string
  config: PurchaseBillsFilterConfig
}

const SAVED_VIEWS_COLLECTION = 'saved_views'

type SavedViewRecord = Record<string, unknown> & { id: string }

const SCOPE_ALLOWED_KEYS: Record<SavedViewScope, ReadonlySet<string>> = {
  'purchase-bills': new Set([
    'view', 'supplier', 'tab', 'pool', 'q', 'from', 'to', 'kind', 'payq',
  ]),
}

const MAX_VALUE_LENGTH = 80

/** Keep only known filter keys with sane string values for the scope. */
function sanitizeConfig(scope: SavedViewScope, raw: unknown): Record<string, string> {
  const allowed = SCOPE_ALLOWED_KEYS[scope]
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of allowed) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_LENGTH) {
      out[key] = value
    }
  }
  return out
}

function toView(row: SavedViewRecord, scope: SavedViewScope): PurchaseBillsSavedView {
  let parsed: unknown
  try {
    parsed = JSON.parse(String(row.config ?? '{}'))
  } catch {
    parsed = {}
  }
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    config: sanitizeConfig(scope, parsed) as PurchaseBillsFilterConfig,
  }
}

export async function listSavedViews(scope: SavedViewScope): Promise<PurchaseBillsSavedView[]> {
  return runDataOperation('saved-views.list', async () => {
    const rows = await pb.collection(SAVED_VIEWS_COLLECTION).getFullList(200, {
      filter: `scope = "${scope}"`,
      sort: 'name',
    })
    return rows.map((row) => toView(row, scope))
  })
}

export async function createSavedView(
  scope: SavedViewScope,
  name: string,
  config: PurchaseBillsFilterConfig,
): Promise<PurchaseBillsSavedView> {
  return runDataOperation('saved-views.create', async () => {
    const cleanName = name.trim().slice(0, 60)
    if (!cleanName) throw new Error('A saved view needs a name.')
    const row = await pb.collection(SAVED_VIEWS_COLLECTION).create({
      name: cleanName,
      scope,
      config: JSON.stringify(sanitizeConfig(scope, config)),
      owner: pb.authStore.record?.id,
    })
    return toView(row, scope)
  })
}

export async function renameSavedView(
  scope: SavedViewScope,
  id: string,
  name: string,
): Promise<PurchaseBillsSavedView> {
  return runDataOperation('saved-views.rename', async () => {
    const cleanName = name.trim().slice(0, 60)
    if (!cleanName) throw new Error('A saved view needs a name.')
    const row = await pb.collection(SAVED_VIEWS_COLLECTION).update(id, { name: cleanName })
    return toView(row, scope)
  })
}

export async function deleteSavedView(_scope: SavedViewScope, id: string): Promise<void> {
  await runDataOperation('saved-views.delete', async () => {
    await pb.collection(SAVED_VIEWS_COLLECTION).delete(id)
  })
}
