'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface RosterImport {
  id: string
  filename: string | null
  status: string | null
  total_rows: number | null
  new_count: number | null
  existing_count: number | null
  conflict_count: number | null
  created_at: string | null
}

interface ImportRow {
  id: string
  import_id: string
  row_index: number | null
  raw: Record<string, unknown> | null
  reconcile_status: string | null
  message: string | null
  matched_payee_id: string | null
  created_at?: string | null
}

interface PreviewResult {
  import: RosterImport
  rows: ImportRow[]
}

const SAMPLE_CSV = `vendor_name,legal_name,contact_email,country,vendor_type,expected_annual_spend
Acme Studios LLC,Acme Studios LLC,ap@acme.example,US,corporation,48000
Globex GmbH,Globex Gesellschaft,finance@globex.example,DE,corporation,120000
Jordan Rivera,Jordan Rivera,jordan@rivera.example,US,individual,9500`

function reconcileTone(status?: string | null): BadgeTone {
  switch ((status || '').toLowerCase()) {
    case 'new':
      return 'green'
    case 'existing':
    case 'matched':
      return 'blue'
    case 'conflict':
      return 'red'
    default:
      return 'slate'
  }
}

function statusTone(status?: string | null): BadgeTone {
  switch ((status || '').toLowerCase()) {
    case 'committed':
    case 'complete':
    case 'completed':
      return 'green'
    case 'preview':
    case 'pending':
      return 'yellow'
    case 'failed':
    case 'error':
      return 'red'
    default:
      return 'slate'
  }
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Tiny CSV parser: handles quoted fields, returns array of row objects keyed by header. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const splitLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out.map((v) => v.trim())
  }
  const headers = splitLine(lines[0])
  return lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
}

export default function ImportsPage() {
  const [imports, setImports] = useState<RosterImport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [filename, setFilename] = useState('')
  const [csvText, setCsvText] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [commitMessage, setCommitMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listImports()
      setImports(Array.isArray(data) ? data : data?.imports ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(() => {
    return imports.reduce(
      (acc, imp) => {
        acc.batches += 1
        acc.rows += imp.total_rows ?? 0
        acc.created += imp.new_count ?? 0
        acc.conflicts += imp.conflict_count ?? 0
        return acc
      },
      { batches: 0, rows: 0, created: 0, conflicts: 0 },
    )
  }, [imports])

  function openImport() {
    setFilename('')
    setCsvText('')
    setPreview(null)
    setPreviewError(null)
    setCommitMessage(null)
    setImportOpen(true)
  }

  async function runPreview() {
    setPreviewError(null)
    setCommitMessage(null)
    const rows = parseCsv(csvText)
    if (rows.length === 0) {
      setPreviewError('No data rows parsed. Check the CSV header and at least one data row.')
      return
    }
    setPreviewing(true)
    try {
      const result = await api.previewImport({
        filename: filename.trim() || 'roster.csv',
        rows,
      })
      const normalized: PreviewResult = {
        import: result?.import ?? result,
        rows: Array.isArray(result?.rows) ? result.rows : [],
      }
      setPreview(normalized)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  async function commit() {
    if (!preview?.import?.id) return
    setCommitting(true)
    setPreviewError(null)
    try {
      const res = await api.commitImport(preview.import.id)
      const created = typeof res?.created === 'number' ? res.created : preview.import.new_count ?? 0
      setCommitMessage(`Committed. ${created} new payee${created === 1 ? '' : 's'} created.`)
      setPreview(null)
      setCsvText('')
      await load()
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  const previewCounts = useMemo(() => {
    if (!preview) return { newC: 0, existing: 0, conflict: 0 }
    const imp = preview.import
    if (imp && (imp.new_count != null || imp.conflict_count != null)) {
      return {
        newC: imp.new_count ?? 0,
        existing: imp.existing_count ?? 0,
        conflict: imp.conflict_count ?? 0,
      }
    }
    return preview.rows.reduce(
      (acc, r) => {
        const s = (r.reconcile_status || '').toLowerCase()
        if (s === 'new') acc.newC += 1
        else if (s === 'conflict') acc.conflict += 1
        else acc.existing += 1
        return acc
      },
      { newC: 0, existing: 0, conflict: 0 },
    )
  }, [preview])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Roster Imports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Bulk-load vendor rosters, reconcile against existing payees, then commit new records.
          </p>
        </div>
        <Button onClick={openImport}>+ New Import</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Import Batches" value={totals.batches} />
        <Stat label="Rows Processed" value={totals.rows} />
        <Stat label="Payees Created" value={totals.created} tone="green" />
        <Stat label="Conflicts" value={totals.conflicts} tone={totals.conflicts > 0 ? 'yellow' : 'default'} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Import History</h2>
            <Button variant="ghost" onClick={load} disabled={loading}>
              {loading ? <Spinner /> : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <FullPageSpinner label="Loading imports..." />
          ) : error ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load imports"
                description={error}
                action={<Button variant="secondary" onClick={load}>Try again</Button>}
              />
            </div>
          ) : imports.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No imports yet"
                description="Upload a vendor roster CSV to reconcile and onboard payees in bulk."
                action={<Button onClick={openImport}>Start an import</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Filename</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">New</TH>
                  <TH className="text-right">Existing</TH>
                  <TH className="text-right">Conflicts</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {imports.map((imp) => (
                  <TR key={imp.id}>
                    <TD className="font-medium text-slate-100">{imp.filename || 'roster.csv'}</TD>
                    <TD>
                      <Badge tone={statusTone(imp.status)}>{imp.status || 'unknown'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{imp.total_rows ?? 0}</TD>
                    <TD className="text-right tabular-nums text-emerald-400">{imp.new_count ?? 0}</TD>
                    <TD className="text-right tabular-nums">{imp.existing_count ?? 0}</TD>
                    <TD className="text-right tabular-nums text-amber-400">{imp.conflict_count ?? 0}</TD>
                    <TD className="text-slate-400">{fmtDate(imp.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="New Roster Import"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Close
            </Button>
            {preview ? (
              <Button onClick={commit} disabled={committing}>
                {committing ? <Spinner label="Committing..." /> : `Commit ${previewCounts.newC} new`}
              </Button>
            ) : (
              <Button onClick={runPreview} disabled={previewing}>
                {previewing ? <Spinner label="Reconciling..." /> : 'Preview & Reconcile'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Filename
            </label>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="q3-vendor-roster.csv"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                CSV Data (header row required)
              </label>
              <button
                type="button"
                onClick={() => {
                  setCsvText(SAMPLE_CSV)
                  if (!filename) setFilename('sample-roster.csv')
                }}
                className="text-xs text-emerald-400 hover:text-emerald-300"
              >
                Load sample
              </button>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
              placeholder="vendor_name,legal_name,contact_email,country,vendor_type,expected_annual_spend"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {previewError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {previewError}
            </div>
          )}
          {commitMessage && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {commitMessage}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-emerald-300">{previewCounts.newC}</div>
                  <div className="text-xs text-emerald-400/80">New</div>
                </div>
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-sky-300">{previewCounts.existing}</div>
                  <div className="text-xs text-sky-400/80">Existing</div>
                </div>
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center">
                  <div className="text-lg font-bold text-red-300">{previewCounts.conflict}</div>
                  <div className="text-xs text-red-400/80">Conflicts</div>
                </div>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-900/95 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Vendor</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {preview.rows.map((r) => {
                      const raw = r.raw || {}
                      const vendor =
                        (raw['vendor_name'] as string) ||
                        (raw['legal_name'] as string) ||
                        `Row ${r.row_index ?? ''}`
                      return (
                        <tr key={r.id || r.row_index}>
                          <td className="px-3 py-2 tabular-nums text-slate-500">{(r.row_index ?? 0) + 1}</td>
                          <td className="px-3 py-2 text-slate-200">{vendor}</td>
                          <td className="px-3 py-2">
                            <Badge tone={reconcileTone(r.reconcile_status)}>
                              {r.reconcile_status || '—'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-slate-400">{r.message || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Committing creates the {previewCounts.newC} new payee{previewCounts.newC === 1 ? '' : 's'}.
                Existing matches and conflicts are left untouched.
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
