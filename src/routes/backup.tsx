import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, FileCheck2, Files } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildBackupSnapshot, snapshotToCsvFiles, validateBackupSnapshot } from '@/data/backup'
import { getLocalIsoDate } from '@/lib/date'

export const Route = createFileRoute('/backup')({
  component: BackupPage,
})

function BackupPage() {
  const today = useMemo(() => getLocalIsoDate(), [])
  const [validationText, setValidationText] = useState('No backup file selected.')
  const backupQuery = useQuery({
    queryKey: ['backup-snapshot'],
    queryFn: buildBackupSnapshot,
  })

  function downloadTextFile(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function exportJson() {
    const snapshot = backupQuery.data
    if (!snapshot) return
    const filename = `billing-backup-${today}.json`
    downloadTextFile(filename, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8')
  }

  function exportCsvBundle() {
    const snapshot = backupQuery.data
    if (!snapshot) return
    const files = snapshotToCsvFiles(snapshot)
    files.forEach((file) => downloadTextFile(file.filename, file.content, 'text/csv;charset=utf-8'))
  }

  async function validateFile(file: File | null) {
    if (!file) {
      setValidationText('No backup file selected.')
      return
    }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const result = validateBackupSnapshot(parsed)
      if (!result.ok) {
        setValidationText(`Invalid backup: ${result.message}`)
        return
      }
      setValidationText(
        `Schema v${result.schemaVersion || '-'} | Customers: ${result.counts.customers}, Items: ${result.counts.items}, Bills: ${result.counts.bills}, Bill Items: ${result.counts.billItems}, Payments: ${result.counts.payments} | Integrity -> Broken Bill Items: ${result.integrity.brokenBillItems}, Duplicate Item Names: ${result.integrity.duplicateItemNames}, Duplicate Bill Refs: ${result.integrity.duplicateBillRefs}`,
      )
    } catch (error) {
      setValidationText(`Invalid file: ${error instanceof Error ? error.message : 'Could not parse JSON'}`)
    }
  }

  return (
    <div className="w-full space-y-6 px-3 pb-10 pt-3 sm:px-4 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Backup Export</h3>
        <p className="mb-4 text-sm text-slate-600">Export complete snapshot for recovery, migration, or audit. JSON is full-fidelity backup. CSV bundle is spreadsheet-friendly backup.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={exportJson}
            disabled={!backupQuery.data}
          >
            <Download size={15} />
            Export JSON Backup
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={exportCsvBundle}
            disabled={!backupQuery.data}
          >
            <Files size={15} />
            Export CSV Bundle
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Backup Validation</h3>
        <p className="mb-3 text-sm text-slate-600">Validate backup file structure and quick integrity checks before restore or migration.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <FileCheck2 size={15} />
          <span>Select Backup JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null
              void validateFile(file)
              event.currentTarget.value = ''
            }}
          />
        </label>
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{validationText}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Snapshot Summary</h3>
        {backupQuery.isLoading && <p className="text-sm text-slate-500">Loading backup snapshot...</p>}
        {backupQuery.isError && <p className="text-sm text-red-600">Unable to prepare backup snapshot.</p>}
        {backupQuery.data && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="Customers" value={String(backupQuery.data.counts.customers)} />
            <Metric label="Items" value={String(backupQuery.data.counts.items)} />
            <Metric label="Bills" value={String(backupQuery.data.counts.bills)} />
            <Metric label="Bill Items" value={String(backupQuery.data.counts.billItems)} />
            <Metric label="Payments" value={String(backupQuery.data.counts.payments)} />
          </div>
        )}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold text-slate-900">{value}</p>
    </div>
  )
}
