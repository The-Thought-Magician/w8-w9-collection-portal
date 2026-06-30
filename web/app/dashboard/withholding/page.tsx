'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface Determination {
  id: string
  payee_id: string
  form_id?: string | null
  income_type: string
  base_rate: number
  applied_rate: number
  treaty_applied: boolean
  estimated_withholding_cents: number
  rationale?: string | null
  created_at?: string
}

interface Exposure {
  total_exposure_cents: number
  count: number
}

interface Payee {
  id: string
  vendor_name?: string
  legal_name?: string
  is_us_person?: boolean
}

const INCOME_TYPES = [
  'services',
  'royalties',
  'interest',
  'dividends',
  'rents',
  'other',
]

function fmtCents(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtRate(r: number | null | undefined): string {
  if (r == null) return '—'
  // accept either fraction (0.3) or percent (30)
  const pct = r <= 1 ? r * 100 : r
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`
}

function ratePct(r: number | null | undefined): number {
  if (r == null) return 0
  return r <= 1 ? r * 100 : r
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function rateTone(pct: number): BadgeTone {
  if (pct >= 30) return 'red'
  if (pct >= 15) return 'yellow'
  if (pct > 0) return 'blue'
  return 'green'
}

export default function WithholdingPage() {
  const [rows, setRows] = useState<Determination[]>([])
  const [exposure, setExposure] = useState<Exposure | null>(null)
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [incomeFilter, setIncomeFilter] = useState('')
  const [treatyFilter, setTreatyFilter] = useState<'all' | 'treaty' | 'none'>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    payee_id: '',
    income_type: 'services',
    amount_dollars: '',
  })

  async function load() {
    setError(null)
    try {
      const [det, exp, py] = await Promise.all([
        api.listWithholding() as Promise<Determination[]>,
        api.getWithholdingExposure() as Promise<Exposure>,
        api.listPayees() as Promise<Payee[]>,
      ])
      setRows(Array.isArray(det) ? det : [])
      setExposure(exp ?? null)
      setPayees(Array.isArray(py) ? py : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load withholding data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const payeeName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of payees) m.set(p.id, p.vendor_name || p.legal_name || p.id)
    return m
  }, [payees])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (incomeFilter && r.income_type !== incomeFilter) return false
      if (treatyFilter === 'treaty' && !r.treaty_applied) return false
      if (treatyFilter === 'none' && r.treaty_applied) return false
      if (q) {
        const name = (payeeName.get(r.payee_id) || '').toLowerCase()
        if (!name.includes(q) && !r.income_type.toLowerCase().includes(q) && !(r.rationale || '').toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })
  }, [rows, search, incomeFilter, treatyFilter, payeeName])

  const totals = useMemo(() => {
    const treatyCount = rows.filter((r) => r.treaty_applied).length
    const sum = rows.reduce((acc, r) => acc + (r.estimated_withholding_cents || 0), 0)
    const avgApplied = rows.length
      ? rows.reduce((acc, r) => acc + ratePct(r.applied_rate), 0) / rows.length
      : 0
    return { treatyCount, sum, avgApplied }
  }, [rows])

  // distribution of applied rates into buckets for the SVG bar chart
  const distribution = useMemo(() => {
    const buckets = [
      { label: '0%', min: -0.01, max: 0.001, count: 0 },
      { label: '1-10%', min: 0.001, max: 10.001, count: 0 },
      { label: '11-20%', min: 10.001, max: 20.001, count: 0 },
      { label: '21-30%', min: 20.001, max: 30.001, count: 0 },
      { label: '30%+', min: 30.001, max: Infinity, count: 0 },
    ]
    for (const r of rows) {
      const p = ratePct(r.applied_rate)
      const b = buckets.find((x) => p > x.min && p <= x.max)
      if (b) b.count++
    }
    return buckets
  }, [rows])

  const maxBucket = Math.max(1, ...distribution.map((b) => b.count))

  function resetForm() {
    setForm({ payee_id: payees[0]?.id || '', income_type: 'services', amount_dollars: '' })
    setFormError(null)
  }

  async function handleDetermine(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.payee_id) {
      setFormError('Select a payee')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        payee_id: form.payee_id,
        income_type: form.income_type,
      }
      const amt = parseFloat(form.amount_dollars)
      if (!isNaN(amt) && amt > 0) body.amount_cents = Math.round(amt * 100)
      await api.determineWithholding(body)
      setModalOpen(false)
      setLoading(true)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Determination failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && rows.length === 0 && !error) {
    return <FullPageSpinner label="Loading withholding determinations..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Withholding</h1>
          <p className="mt-1 text-sm text-slate-400">
            Backup and chapter-3 withholding determinations and aggregate exposure across your payee book.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm()
            setModalOpen(true)
          }}
        >
          + Determine withholding
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}{' '}
          <button onClick={() => { setLoading(true); load() }} className="ml-2 underline hover:text-red-200">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Backup withholding exposure"
          value={fmtCents(exposure?.total_exposure_cents)}
          hint={`${exposure?.count ?? 0} at-risk payees`}
          tone="red"
        />
        <Stat label="Determinations" value={rows.length} hint="recorded" />
        <Stat
          label="Treaty reductions"
          value={totals.treatyCount}
          hint={`${rows.length ? Math.round((totals.treatyCount / rows.length) * 100) : 0}% of determinations`}
          tone="green"
        />
        <Stat label="Avg applied rate" value={`${totals.avgApplied.toFixed(1)}%`} hint="weighted across rows" tone="yellow" />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Applied-rate distribution</h2>
          <p className="mt-0.5 text-xs text-slate-500">Count of determinations grouped by the rate ultimately applied.</p>
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-500">No determinations to chart yet.</p>
          ) : (
            <div className="flex items-end gap-4">
              {distribution.map((b) => (
                <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-40 w-full items-end justify-center">
                    <div
                      className="w-full max-w-[64px] rounded-t-md bg-gradient-to-t from-emerald-700 to-emerald-400 transition-all"
                      style={{ height: `${(b.count / maxBucket) * 100}%`, minHeight: b.count ? '6px' : '0' }}
                      title={`${b.count} determinations`}
                    />
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-white">{b.count}</div>
                  <div className="text-xs text-slate-500">{b.label}</div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Determinations</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payee, income type, rationale..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
            <select
              value={incomeFilter}
              onChange={(e) => setIncomeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">All income types</option>
              {INCOME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={treatyFilter}
              onChange={(e) => setTreatyFilter(e.target.value as 'all' | 'treaty' | 'none')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="treaty">Treaty applied</option>
              <option value="none">No treaty</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rows.length === 0 ? 'No determinations yet' : 'No rows match your filters'}
                description={
                  rows.length === 0
                    ? 'Run a determination to compute the backup or treaty-reduced rate for a payee.'
                    : 'Try clearing the search or filters.'
                }
                action={
                  rows.length === 0 ? (
                    <Button onClick={() => { resetForm(); setModalOpen(true) }}>Determine withholding</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => { setSearch(''); setIncomeFilter(''); setTreatyFilter('all') }}>
                      Clear filters
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Income type</TH>
                  <TH>Base</TH>
                  <TH>Applied</TH>
                  <TH>Treaty</TH>
                  <TH className="text-right">Est. withholding</TH>
                  <TH>Rationale</TH>
                  <TH>Computed</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const ap = ratePct(r.applied_rate)
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium text-slate-100">{payeeName.get(r.payee_id) || r.payee_id}</TD>
                      <TD className="capitalize">{r.income_type}</TD>
                      <TD className="tabular-nums">{fmtRate(r.base_rate)}</TD>
                      <TD>
                        <Badge tone={rateTone(ap)}>{fmtRate(r.applied_rate)}</Badge>
                      </TD>
                      <TD>
                        {r.treaty_applied ? <Badge tone="green">Treaty</Badge> : <Badge tone="slate">—</Badge>}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-100">{fmtCents(r.estimated_withholding_cents)}</TD>
                      <TD className="max-w-xs text-xs text-slate-400">{r.rationale || '—'}</TD>
                      <TD className="whitespace-nowrap text-xs text-slate-500">{fmtDate(r.created_at)}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title="Determine withholding"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="determine-form" disabled={submitting}>
              {submitting ? <Spinner label="Computing..." /> : 'Compute'}
            </Button>
          </>
        }
      >
        <form id="determine-form" onSubmit={handleDetermine} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Payee</label>
            {payees.length === 0 ? (
              <p className="text-sm text-slate-500">No payees available. Add a payee first.</p>
            ) : (
              <select
                value={form.payee_id}
                onChange={(e) => setForm((f) => ({ ...f, payee_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
              >
                <option value="">Select a payee...</option>
                {payees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.vendor_name || p.legal_name || p.id}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Income type</label>
            <select
              value={form.income_type}
              onChange={(e) => setForm((f) => ({ ...f, income_type: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              {INCOME_TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Annual amount (USD, optional)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount_dollars}
              onChange={(e) => setForm((f) => ({ ...f, amount_dollars: e.target.value }))}
              placeholder="Defaults to expected annual spend"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              The engine applies treaty reductions and backup-withholding rules to derive the applied rate.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  )
}
