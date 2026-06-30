'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Readiness {
  total_payees: number
  ready: number
  not_ready: number
  readiness_rate: number
  blocked_payees: number
  blocked_cents: number
  expiring_soon: number
  expired: number
  forms_on_file: number
  missing_forms: number
}

interface BreakdownBucket {
  key: string
  count: number
  ready: number
  blocked_cents: number
}

interface Breakdown {
  by_type: BreakdownBucket[]
  by_country: BreakdownBucket[]
}

function fmtUsd(cents: number | null | undefined): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

function rateTone(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 80) return 'green'
  if (rate >= 50) return 'yellow'
  return 'red'
}

/** Horizontal proportion bar for a breakdown row: ready (green) vs the rest (slate). */
function ReadyBar({ ready, count }: { ready: number; count: number }) {
  const readyPct = pct(ready, count)
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full bg-emerald-500" style={{ width: `${readyPct}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-slate-400">{readyPct}%</span>
    </div>
  )
}

type BreakdownView = 'by_type' | 'by_country'

export default function ReportsPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<BreakdownView>('by_type')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, b] = await Promise.all([api.get1099Readiness(), api.getReportBreakdown()])
      setReadiness(r as Readiness)
      setBreakdown({
        by_type: Array.isArray((b as Breakdown)?.by_type) ? (b as Breakdown).by_type : [],
        by_country: Array.isArray((b as Breakdown)?.by_country) ? (b as Breakdown).by_country : [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const list = breakdown ? breakdown[view] : []
    const term = search.trim().toLowerCase()
    const filtered = term ? list.filter((r) => (r.key || '').toLowerCase().includes(term)) : list
    return [...filtered].sort((a, z) => z.count - a.count)
  }, [breakdown, view, search])

  const breakdownTotals = useMemo(() => {
    const list = breakdown ? breakdown[view] : []
    return list.reduce(
      (acc, r) => {
        acc.count += r.count
        acc.ready += r.ready
        acc.blocked_cents += r.blocked_cents
        return acc
      },
      { count: 0, ready: 0, blocked_cents: 0 },
    )
  }, [breakdown, view])

  const maxCount = useMemo(() => rows.reduce((m, r) => Math.max(m, r.count), 0), [rows])

  if (loading) {
    return <FullPageSpinner label="Building 1099 readiness report…" />
  }

  if (error) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-white">1099 Readiness Report</h1>
        </header>
        <EmptyState
          title="Could not load reports"
          description={error}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
      </div>
    )
  }

  const r = readiness

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">1099 Readiness Report</h1>
          <p className="mt-1 text-sm text-slate-400">
            Year-end filing readiness across your payee roster, with blocked dollars and expiring documentation.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : 'Refresh'}
        </Button>
      </header>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total payees" value={r?.total_payees ?? 0} hint={`${r?.forms_on_file ?? 0} forms on file`} />
        <Stat
          label="Readiness rate"
          value={`${r?.readiness_rate ?? 0}%`}
          tone={rateTone(r?.readiness_rate ?? 0)}
          hint={`${r?.ready ?? 0} ready · ${r?.not_ready ?? 0} not ready`}
        />
        <Stat
          label="Blocked dollars"
          value={fmtUsd(r?.blocked_cents)}
          tone={(r?.blocked_cents ?? 0) > 0 ? 'red' : 'default'}
          hint={`${r?.blocked_payees ?? 0} payees blocked`}
        />
        <Stat
          label="Missing forms"
          value={r?.missing_forms ?? 0}
          tone={(r?.missing_forms ?? 0) > 0 ? 'yellow' : 'green'}
          hint="payees with no W-8/W-9"
        />
      </div>

      {/* Readiness composition bar */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Readiness composition</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          {(r?.total_payees ?? 0) === 0 ? (
            <EmptyState
              title="No payees yet"
              description="Add payees and submit their W-8/W-9 forms to populate this report."
            />
          ) : (
            <>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="bg-emerald-500"
                  style={{ width: `${pct(r?.ready ?? 0, r?.total_payees ?? 0)}%` }}
                  title={`Ready: ${r?.ready ?? 0}`}
                />
                <div
                  className="bg-red-500/80"
                  style={{ width: `${pct(r?.not_ready ?? 0, r?.total_payees ?? 0)}%` }}
                  title={`Not ready: ${r?.not_ready ?? 0}`}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Ready {r?.ready ?? 0}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500/80" /> Not ready {r?.not_ready ?? 0}
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Documentation lifecycle */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Valid documentation</div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-400">
                {Math.max(0, (r?.forms_on_file ?? 0) - (r?.expiring_soon ?? 0) - (r?.expired ?? 0))}
              </div>
              <div className="mt-1 text-xs text-slate-500">forms not expiring soon</div>
            </div>
            <Badge tone="green">On file {r?.forms_on_file ?? 0}</Badge>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Expiring soon</div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-amber-400">{r?.expiring_soon ?? 0}</div>
              <div className="mt-1 text-xs text-slate-500">forms approaching expiry</div>
            </div>
            <Badge tone="yellow">Recertify</Badge>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Expired</div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-red-400">{r?.expired ?? 0}</div>
              <div className="mt-1 text-xs text-slate-500">forms past valid-through</div>
            </div>
            <Badge tone="red">Action</Badge>
          </CardBody>
        </Card>
      </div>

      {/* Breakdown */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Breakdown</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              <button
                onClick={() => setView('by_type')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  view === 'by_type' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                By vendor type
              </button>
              <button
                onClick={() => setView('by_country')}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  view === 'by_country' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                By country
              </button>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No breakdown data"
                description={
                  (breakdown?.[view]?.length ?? 0) === 0
                    ? 'No payees recorded for this dimension yet.'
                    : 'No rows match your search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{view === 'by_type' ? 'Vendor type' : 'Country'}</TH>
                  <TH className="text-right">Payees</TH>
                  <TH>Volume</TH>
                  <TH className="text-right">Ready</TH>
                  <TH>Ready rate</TH>
                  <TH className="text-right">Blocked $</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.key}>
                    <TD className="font-medium text-slate-200">{row.key || 'unknown'}</TD>
                    <TD className="text-right tabular-nums">{row.count}</TD>
                    <TD>
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full bg-sky-500/70"
                          style={{ width: `${maxCount ? (row.count / maxCount) * 100 : 0}%` }}
                        />
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums text-emerald-400">{row.ready}</TD>
                    <TD>
                      <ReadyBar ready={row.ready} count={row.count} />
                    </TD>
                    <TD className="text-right tabular-nums">
                      <span className={row.blocked_cents ? 'text-red-400' : 'text-slate-500'}>
                        {fmtUsd(row.blocked_cents)}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3 text-xs text-slate-400">
            <span>
              {rows.length} {view === 'by_type' ? 'vendor types' : 'countries'}
            </span>
            <span className="flex flex-wrap gap-4">
              <span>
                Total payees <span className="tabular-nums text-slate-200">{breakdownTotals.count}</span>
              </span>
              <span>
                Ready <span className="tabular-nums text-emerald-400">{breakdownTotals.ready}</span>
              </span>
              <span>
                Blocked <span className="tabular-nums text-red-400">{fmtUsd(breakdownTotals.blocked_cents)}</span>
              </span>
            </span>
          </div>
        )}
      </Card>
    </div>
  )
}
