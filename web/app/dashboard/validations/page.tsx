'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ValidationRow {
  id: string
  form_id: string | null
  payee_id: string | null
  verdict: string | null
  error_count: number | null
  warning_count: number | null
  summary: string | null
  created_at: string | null
}

interface ValidationCheck {
  id: string
  validation_id: string
  check_key: string | null
  severity: string | null
  message: string | null
  created_at: string | null
}

interface ValidationDetail {
  validation: ValidationRow
  checks: ValidationCheck[]
}

function verdictTone(verdict: string | null | undefined): BadgeTone {
  switch ((verdict || '').toLowerCase()) {
    case 'pass':
    case 'passed':
    case 'valid':
      return 'green'
    case 'warn':
    case 'warning':
      return 'yellow'
    case 'fail':
    case 'failed':
    case 'invalid':
      return 'red'
    default:
      return 'slate'
  }
}

function severityTone(severity: string | null | undefined): BadgeTone {
  switch ((severity || '').toLowerCase()) {
    case 'error':
    case 'critical':
      return 'red'
    case 'warning':
    case 'warn':
      return 'yellow'
    case 'info':
      return 'blue'
    default:
      return 'slate'
  }
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

export default function ValidationsPage() {
  const [rows, setRows] = useState<ValidationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formFilter, setFormFilter] = useState('')
  const [verdictFilter, setVerdictFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ValidationDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = formFilter.trim() ? { form_id: formFilter.trim() } : undefined
      const data = await api.listValidations(q)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load validation runs')
    } finally {
      setLoading(false)
    }
  }, [formFilter])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await api.getValidation(id)
      setDetail(data as ValidationDetail)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load validation detail')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    setSelectedId(null)
    setDetail(null)
    setDetailError(null)
  }, [])

  const rerun = useCallback(
    async (id: string) => {
      setRerunning(true)
      try {
        await api.rerunValidation(id)
        await load()
        // Refresh the drawer to the freshly-created run if it is open for this id.
        if (selectedId === id) await openDetail(id)
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Failed to re-run validation')
      } finally {
        setRerunning(false)
      }
    },
    [load, openDetail, selectedId],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (verdictFilter !== 'all' && (r.verdict || '').toLowerCase() !== verdictFilter) return false
      if (!term) return true
      return (
        (r.summary || '').toLowerCase().includes(term) ||
        (r.id || '').toLowerCase().includes(term) ||
        (r.form_id || '').toLowerCase().includes(term) ||
        (r.payee_id || '').toLowerCase().includes(term)
      )
    })
  }, [rows, verdictFilter, search])

  const stats = useMemo(() => {
    const total = rows.length
    let pass = 0
    let fail = 0
    let warn = 0
    let errors = 0
    let warnings = 0
    for (const r of rows) {
      const v = (r.verdict || '').toLowerCase()
      if (v === 'pass' || v === 'passed' || v === 'valid') pass += 1
      else if (v === 'fail' || v === 'failed' || v === 'invalid') fail += 1
      else if (v === 'warn' || v === 'warning') warn += 1
      errors += r.error_count || 0
      warnings += r.warning_count || 0
    }
    const passRate = total ? Math.round((pass / total) * 100) : 0
    return { total, pass, fail, warn, errors, warnings, passRate }
  }, [rows])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Validation Runs</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every W-8/W-9 validation engine pass, with per-check detail and re-run.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : 'Refresh'}
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total runs" value={stats.total} />
        <Stat label="Pass rate" value={`${stats.passRate}%`} tone="green" hint={`${stats.pass} passing`} />
        <Stat label="Open errors" value={stats.errors} tone={stats.errors ? 'red' : 'default'} />
        <Stat label="Open warnings" value={stats.warnings} tone={stats.warnings ? 'yellow' : 'default'} />
      </div>

      {/* Pass-rate bar (simple SVG-free bar) */}
      {stats.total > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Verdict distribution</span>
              <span>{stats.total} runs</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="bg-emerald-500"
                style={{ width: `${(stats.pass / stats.total) * 100}%` }}
                title={`Pass: ${stats.pass}`}
              />
              <div
                className="bg-amber-500"
                style={{ width: `${(stats.warn / stats.total) * 100}%` }}
                title={`Warn: ${stats.warn}`}
              />
              <div
                className="bg-red-500"
                style={{ width: `${(stats.fail / stats.total) * 100}%` }}
                title={`Fail: ${stats.fail}`}
              />
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pass {stats.pass}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Warn {stats.warn}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" /> Fail {stats.fail}
              </span>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search summary, form, payee…"
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All verdicts</option>
              <option value="pass">Pass</option>
              <option value="warn">Warn</option>
              <option value="fail">Fail</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={formFilter}
              onChange={(e) => setFormFilter(e.target.value)}
              placeholder="Filter by form id"
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {formFilter && (
              <Button variant="ghost" onClick={() => setFormFilter('')}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <FullPageSpinner label="Loading validation runs…" />
          ) : error ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Could not load validation runs"
                description={error}
                action={<Button onClick={() => void load()}>Retry</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No validation runs"
                description={
                  rows.length === 0
                    ? 'Validate a form from the Forms page to generate a run here.'
                    : 'No runs match the current filters.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Verdict</TH>
                  <TH>Summary</TH>
                  <TH>Form</TH>
                  <TH>Payee</TH>
                  <TH className="text-right">Errors</TH>
                  <TH className="text-right">Warnings</TH>
                  <TH>Run at</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id} className="cursor-pointer" onClick={() => void openDetail(r.id)}>
                    <TD>
                      <Badge tone={verdictTone(r.verdict)}>{r.verdict || 'unknown'}</Badge>
                    </TD>
                    <TD className="max-w-xs truncate text-slate-200">{r.summary || '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{r.form_id ? r.form_id.slice(0, 8) : '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{r.payee_id ? r.payee_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-right tabular-nums">
                      <span className={r.error_count ? 'text-red-400' : 'text-slate-500'}>{r.error_count ?? 0}</span>
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className={r.warning_count ? 'text-amber-400' : 'text-slate-500'}>
                        {r.warning_count ?? 0}
                      </span>
                    </TD>
                    <TD className="text-xs text-slate-400">{fmtDate(r.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" onClick={() => void openDetail(r.id)}>
                          View
                        </Button>
                        <Button variant="secondary" disabled={rerunning} onClick={() => void rerun(r.id)}>
                          Re-run
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={selectedId !== null}
        onClose={closeDetail}
        title="Validation detail"
        footer={
          <>
            <Button variant="ghost" onClick={closeDetail}>
              Close
            </Button>
            {selectedId && (
              <Button variant="primary" disabled={rerunning} onClick={() => void rerun(selectedId)}>
                {rerunning ? <Spinner label="Re-running…" /> : 'Re-run validation'}
              </Button>
            )}
          </>
        }
      >
        {detailLoading ? (
          <div className="py-8 text-center">
            <Spinner label="Loading detail…" />
          </div>
        ) : detailError ? (
          <EmptyState title="Could not load detail" description={detailError} />
        ) : detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={verdictTone(detail.validation.verdict)}>{detail.validation.verdict || 'unknown'}</Badge>
              <span className="text-xs text-slate-500">{fmtDate(detail.validation.created_at)}</span>
            </div>
            {detail.validation.summary && (
              <p className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                {detail.validation.summary}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                <div className="text-xs uppercase text-slate-500">Errors</div>
                <div className="text-lg font-bold text-red-400 tabular-nums">{detail.validation.error_count ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                <div className="text-xs uppercase text-slate-500">Warnings</div>
                <div className="text-lg font-bold text-amber-400 tabular-nums">
                  {detail.validation.warning_count ?? 0}
                </div>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-200">Checks ({detail.checks.length})</h3>
              {detail.checks.length === 0 ? (
                <p className="text-sm text-slate-500">No individual checks recorded for this run.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.checks.map((c) => (
                    <li key={c.id} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-400">{c.check_key || 'check'}</span>
                        <Badge tone={severityTone(c.severity)}>{c.severity || 'info'}</Badge>
                      </div>
                      {c.message && <p className="mt-1 text-sm text-slate-300">{c.message}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
