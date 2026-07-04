import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Command, Database, Lock, RefreshCw, RotateCcw, Save, Shield, Unlock, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { pb } from '@/data/pocketbase'
import { loadCurrentStock } from '@/data/stock'
import { loadDataHealthIssues } from '@/data/data-health'
import { loadItems } from '@/data/items'
import {
  defaultAdminControlSettings,
  getAdminControlSettings,
  isAdminControlUnlocked,
  lockAdminControl,
  normalizeAdminControlSettings,
  resetAdminControlSettings,
  saveAdminControlSettings,
  unlockAdminControl,
  type AdminControlSettings,
} from '@/lib/admin-control'
import { getLocalIsoDate } from '@/lib/date'
import { formatInrInteger } from '@/lib/inr-format'
import { parseContextCommand, type CommandRouteContext } from '@/lib/commands'

export const Route = createFileRoute('/control-room')({
  component: ControlRoomPage,
})

type PBRecord = Record<string, unknown> & { id: string }

const routeOptions = [
  { label: 'Dashboard', path: '/' },
  { label: 'New Bill', path: '/new-bill' },
  { label: 'New Payment', path: '/new-payment' },
  { label: 'Casting', path: '/casting/new-session' },
  { label: 'Logs', path: '/transactions' },
  { label: 'Ledger', path: '/ledger' },
  { label: 'Calendar', path: '/calendar' },
  { label: 'Exports', path: '/export-reports' },
  { label: 'Customers', path: '/customers' },
  { label: 'Items', path: '/items' },
  { label: 'Data Health', path: '/data-health' },
  { label: 'Backup', path: '/backup' },
  { label: 'Print Bill', path: '/print-bill' },
]

const inputClass =
  'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'

function ControlRoomPage() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<AdminControlSettings>(() => getAdminControlSettings())
  const [unlocked, setUnlocked] = useState(() => isAdminControlUnlocked())
  const [phraseInput, setPhraseInput] = useState('')
  const [statusText, setStatusText] = useState('')
  const [importText, setImportText] = useState('')
  const [commandInput, setCommandInput] = useState('b mukesh 1')
  const [commandContext, setCommandContext] = useState<CommandRouteContext>('neutral')

  const itemsQuery = useQuery({ queryKey: ['items-options'], queryFn: loadItems })
  const customersQuery = useQuery({
    queryKey: ['control-room-customers'],
    queryFn: async () => {
      const rows = await pb.collection('customers').getFullList({ sort: 'company_name,name' })
      return (rows as PBRecord[]).map((row) => ({
        id: row.id,
        name: String(row.company_name ?? row.name ?? ''),
        companyName: String(row.company_name ?? ''),
        customerName: String(row.name ?? ''),
      }))
    },
  })
  const systemQuery = useQuery({
    queryKey: ['control-room-system'],
    queryFn: loadSystemSnapshot,
  })

  const commandPreview = useMemo(() => {
    return parseContextCommand(commandInput, commandContext, {
      customers: customersQuery.data ?? [],
      items: itemsQuery.data ?? [],
      today: getLocalIsoDate(),
      mktRate: 0,
    })
  }, [commandContext, commandInput, customersQuery.data, itemsQuery.data])

  function updateSettings(next: AdminControlSettings, message = 'Control settings saved.') {
    const normalized = normalizeAdminControlSettings(next)
    setSettings(normalized)
    saveAdminControlSettings(normalized)
    setStatusText(message)
  }

  function updateAliases(kind: keyof AdminControlSettings['commandAliases'], value: string) {
    updateSettings({
      ...settings,
      commandAliases: {
        ...settings.commandAliases,
        [kind]: value.split(',').map((entry) => entry.trim()).filter(Boolean),
      },
    })
  }

  function updatePinnedRoutes(value: string) {
    const pinnedRoutes = value
      .split('\n')
      .map((line) => {
        const [labelRaw, pathRaw] = line.split('|')
        return { label: String(labelRaw ?? '').trim(), path: String(pathRaw ?? '').trim() }
      })
      .filter((row) => row.label && row.path)
    updateSettings({ ...settings, pinnedRoutes })
  }

  function unlock() {
    if (phraseInput.trim() !== settings.accessPhrase) {
      setStatusText('Access phrase did not match.')
      return
    }
    unlockAdminControl()
    setUnlocked(true)
    setPhraseInput('')
    setStatusText('Control room unlocked for this browser tab.')
  }

  function lock() {
    lockAdminControl()
    setUnlocked(false)
    setStatusText('Control room locked.')
  }

  async function refreshEverything() {
    await queryClient.invalidateQueries()
    setStatusText('All cached app data was asked to refresh.')
  }

  function importSettings() {
    try {
      const parsed = JSON.parse(importText)
      updateSettings(normalizeAdminControlSettings(parsed), 'Imported admin settings.')
      setImportText('')
    } catch {
      setStatusText('Import failed. Paste valid JSON settings.')
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-10">
        <section className="w-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-slate-900 text-white">
              <Lock size={18} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Control Room</h2>
              <p className="text-sm text-slate-500">Hidden admin workspace for app workflows and operations.</p>
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Access phrase</span>
            <input
              className={`${inputClass} mt-1`}
              type="password"
              value={phraseInput}
              onChange={(event) => setPhraseInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') unlock()
              }}
              placeholder="Enter admin phrase"
              autoFocus
            />
          </label>
          {statusText && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{statusText}</p>}
          <button type="button" className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800" onClick={unlock}>
            <Unlock size={15} /> Unlock
          </button>
        </section>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      {statusText && <p className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{statusText}</p>}

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Auth" value={pb.authStore.isValid ? 'Active' : 'Missing'} tone={pb.authStore.isValid ? 'green' : 'red'} />
        <Metric label="Customers" value={String(systemQuery.data?.counts.customers ?? '-')} />
        <Metric label="Bills" value={String(systemQuery.data?.counts.bills ?? '-')} />
        <Metric label="Health Issues" value={String(systemQuery.data?.counts.healthIssues ?? '-')} tone={(systemQuery.data?.counts.healthIssues ?? 0) > 0 ? 'amber' : 'green'} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Panel title="Command Workflow" icon={<Command size={16} />}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Ctrl+K command bar</span>
              <input
                type="checkbox"
                checked={settings.controlKEnabled}
                onChange={(event) => updateSettings({ ...settings, controlKEnabled: event.target.checked })}
              />
            </label>
            <Field label="Default bill item">
              <select className={inputClass} value={settings.defaultBillItemName} onChange={(event) => updateSettings({ ...settings, defaultBillItemName: event.target.value })}>
                {(itemsQuery.data ?? []).map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
                {itemsQuery.data?.length === 0 && <option value={settings.defaultBillItemName}>{settings.defaultBillItemName}</option>}
              </select>
            </Field>
            <Field label="Bill aliases">
              <input className={inputClass} value={settings.commandAliases.bill.join(', ')} onChange={(event) => updateAliases('bill', event.target.value)} />
            </Field>
            <Field label="Payment aliases">
              <input className={inputClass} value={settings.commandAliases.payment.join(', ')} onChange={(event) => updateAliases('payment', event.target.value)} />
            </Field>
            <Field label="Print aliases">
              <input className={inputClass} value={settings.commandAliases.print.join(', ')} onChange={(event) => updateAliases('print', event.target.value)} />
            </Field>
          </div>
          <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr]">
              <Field label="Test context">
                <select className={inputClass} value={commandContext} onChange={(event) => setCommandContext(event.target.value as CommandRouteContext)}>
                  <option value="neutral">Neutral</option>
                  <option value="bill">Bill</option>
                  <option value="payment">Payment</option>
                  <option value="print">Print</option>
                </select>
              </Field>
              <Field label="Test command">
                <input className={inputClass} value={commandInput} onChange={(event) => setCommandInput(event.target.value)} />
              </Field>
            </div>
            <pre className={`mt-3 max-h-64 overflow-auto rounded-md p-3 text-xs ${commandPreview.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
              {JSON.stringify(commandPreview, null, 2)}
            </pre>
          </div>
        </Panel>

        <Panel title="Operations" icon={<Shield size={16} />}>
          <div className="grid grid-cols-1 gap-2">
            <button type="button" className={buttonClass} onClick={refreshEverything}>
              <RefreshCw size={15} /> Refresh all app data
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                resetAdminControlSettings()
                setSettings(defaultAdminControlSettings)
                setStatusText('Admin settings reset to defaults.')
              }}
            >
              <RotateCcw size={15} /> Reset command settings
            </button>
            <button type="button" className={buttonClass} onClick={lock}>
              <Lock size={15} /> Lock control room
            </button>
          </div>
          <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-900">Current user</p>
            <p className="mt-1 break-all">{String(pb.authStore.model?.email ?? pb.authStore.model?.id ?? 'Unknown')}</p>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Pinned Admin Routes" icon={<Database size={16} />}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {settings.pinnedRoutes.map((route) => (
              <Link key={`${route.label}-${route.path}`} to={route.path} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                {route.label}
              </Link>
            ))}
          </div>
          <Field label="Pinned route config: one label|/path per line">
            <textarea className={`${inputClass} mt-2 h-36 py-2 font-mono text-xs`} value={settings.pinnedRoutes.map((route) => `${route.label}|${route.path}`).join('\n')} onChange={(event) => updatePinnedRoutes(event.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            {routeOptions.map((route) => (
              <button
                key={route.path}
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                onClick={() => updateSettings({ ...settings, pinnedRoutes: [...settings.pinnedRoutes, route] })}
              >
                + {route.label}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Settings Portability" icon={<Upload size={16} />}>
          <Field label="Export JSON">
            <textarea className={`${inputClass} h-36 py-2 font-mono text-xs`} readOnly value={JSON.stringify(settings, null, 2)} />
          </Field>
          <Field label="Import JSON">
            <textarea className={`${inputClass} h-28 py-2 font-mono text-xs`} value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste exported admin settings JSON" />
          </Field>
          <button type="button" className={buttonClass} onClick={importSettings}>
            <Save size={15} /> Import settings
          </button>
        </Panel>
      </section>

      <Panel title="System Snapshot" icon={<CheckCircle2 size={16} />}>
        {systemQuery.isLoading && <p className="text-sm text-slate-500">Loading system snapshot...</p>}
        {systemQuery.isError && <p className="text-sm text-red-600">Unable to load system snapshot.</p>}
        {systemQuery.data && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SnapshotBlock title="Collections" lines={[
              `Customers: ${systemQuery.data.counts.customers}`,
              `Items: ${systemQuery.data.counts.items}`,
              `Bills: ${systemQuery.data.counts.bills}`,
              `Payments: ${systemQuery.data.counts.payments}`,
            ]} />
            <SnapshotBlock title="Money" lines={[
              `Bill value: ${formatInrInteger(systemQuery.data.totals.billAmount)}`,
              `Payments: ${formatInrInteger(systemQuery.data.totals.paymentAmount)}`,
              `Net billed: ${formatInrInteger(systemQuery.data.totals.billAmount - systemQuery.data.totals.paymentAmount)}`,
            ]} />
            <SnapshotBlock title="Stock" lines={[
              `Buckets: ${systemQuery.data.counts.stockBuckets}`,
              `Negative buckets: ${systemQuery.data.counts.negativeStockBuckets}`,
              `Health issues: ${systemQuery.data.counts.healthIssues}`,
            ]} />
          </div>
        )}
      </Panel>
    </div>
  )
}

async function loadSystemSnapshot() {
  const [customers, items, bills, billItems, payments, stock, healthIssues] = await Promise.all([
    pb.collection('customers').getList(1, 1),
    pb.collection('items').getList(1, 1),
    pb.collection('bills').getFullList(),
    pb.collection('bill_items').getFullList(),
    pb.collection('payments').getFullList(),
    loadCurrentStock(),
    loadDataHealthIssues(),
  ])
  const billAmountById = new Map<string, number>()
  for (const item of billItems as PBRecord[]) {
    const billId = String(item.bill ?? '')
    billAmountById.set(billId, (billAmountById.get(billId) ?? 0) + num(item.amount))
  }
  const billAmount = (bills as PBRecord[]).reduce((sum, bill) => sum + (billAmountById.get(bill.id) ?? 0) + num(bill.transport) + num(bill.gst_amount), 0)
  const paymentAmount = (payments as PBRecord[]).reduce((sum, payment) => sum + num(payment.amount), 0)
  return {
    counts: {
      customers: customers.totalItems,
      items: items.totalItems,
      bills: bills.length,
      payments: payments.length,
      stockBuckets: stock.length,
      negativeStockBuckets: stock.filter((row) => row.currentStock < 0).length,
      healthIssues: healthIssues.length,
    },
    totals: { billAmount, paymentAmount },
  }
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const buttonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50'

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 text-slate-700">{icon}</span>
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'green' | 'red' | 'amber' }) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'red'
        ? 'border-red-200 bg-red-50 text-red-800'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-slate-200 bg-white text-slate-800'
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
    </div>
  )
}

function SnapshotBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</p>
      <div className="mt-2 space-y-1 font-mono text-xs text-slate-700">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}
