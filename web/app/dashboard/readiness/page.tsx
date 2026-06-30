'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ReasonRow {
  reason: string
  count: number
  blocked_cents?: number
}

interface DistributionRow {
  state: string
  count: number
}

interface Ledger {
  total_blocked_payees: number
  total_blocked_cents: number
  by_reason: ReasonRow[]
  distribution: DistributionRow[]
}

interface EligibilityResult {
  allowed: boolean
  reasons: string[]
}

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const STATE_TONE: Record<string, BadgeTone> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
}

const STATE_BAR: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
}

function prettyReason(r: string): string {
  return r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ReadinessPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [payeeId, setPayeeId] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<EligibilityResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await api.getReadinessLedger()
      setLedger({
        total_blocked_payees: data?.total_blocked_payees ?? 0,
        total_blocked_cents: data?.total_blocked_cents ?? 0,
        by_reason: Array.isArray(data?.by_reason) ? data.by_reason : [],
        distribution: Array.isArray(data?.distribution) ? data.distribution : [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load readiness ledger')
      setLedger({ total_blocked_payees: 0, total_blocked_cents: 0, by_reason: [], distribution: [] })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  async function recompute() {
    setRecomputing(true)
    try {
      const res = await api.recomputeReadiness()
      setToast(`Recomputed readiness for ${res?.updated ?? 0} payee${res?.updated === 1 ? '' : 's'}`)
      await load()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to recompute')
    } finally {
      setRecomputing(false)
    }
  }

  async function check(e: React.FormEvent) {
    e.preventDefault()
    if (!payeeId.trim()) {
      setCheckError('Enter a payee ID')
      return
    }
    setChecking(true)
    setCheckError(null)
    setCheckResult(null)
    try {
      const res = await api.checkPaymentEligibility({ payee_id: payeeId.trim() })
      setCheckResult({
        allowed: Boolean(res?.allowed),
        reasons: Array.isArray(res?.reasons) ? res.reasons : [],
      })
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Failed to check eligibility')
    } finally {
      setChecking(false)
    }
  }

  const distTotal = useMemo(
    () => (ledger?.distribution ?? []).reduce((s, d) => s + d.count, 0),
    [ledger],
  )

  const sortedDist = useMemo(() => {
    const order = ['green', 'yellow', 'red']
    return [...(ledger?.distribution ?? [])].sort(
      (a, b) => order.indexOf(a.state) - order.indexOf(b.state),
    )
  }, [ledger])

  const maxReasonCount = useMemo(
    () => Math.max(1, ...(ledger?.by_reason ?? []).map((r) => r.count)),
    [ledger],
  )

  if (ledger === null) return <FullPageSpinner label="Loading readiness ledger..." />

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-500/40 bg-slate-900 px-4 py-2 text-sm text-emerald-200 shadow-lg shadow-black/40">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Payment-Block Readiness Ledger</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Every payee carries a readiness state. Payees in a blocked state must not be paid until their tax
            documentation is current. This ledger aggregates blocked dollars by reason.
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Spinner label="Recomputing..." /> : '↻ Recompute readiness'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Blocked payees"
          value={ledger.total_blocked_payees.toLocaleString()}
          tone={ledger.total_blocked_payees > 0 ? 'red' : 'green'}
        />
        <Stat label="Blocked dollars" value={fmtUsd(ledger.total_blocked_cents)} tone="red" />
        <Stat
          label="Block reasons"
          value={ledger.by_reason.length}
          hint="Distinct reasons holding payments"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Readiness distribution</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {distTotal === 0 ? (
              <EmptyState title="No payees scored yet" description="Recompute readiness to populate this chart." icon="📊" />
            ) : (
              <>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
                  {sortedDist.map((d) => {
                    const pct = (d.count / distTotal) * 100
                    if (pct <= 0) return null
                    return (
                      <div
                        key={d.state}
                        className={STATE_BAR[d.state] ?? 'bg-slate-500'}
                        style={{ width: `${pct}%` }}
                        title={`${d.state}: ${d.count}`}
                      />
                    )
                  })}
                </div>
                <div className="space-y-2">
                  {sortedDist.map((d) => {
                    const pct = Math.round((d.count / distTotal) * 100)
                    return (
                      <div key={d.state} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${STATE_BAR[d.state] ?? 'bg-slate-500'}`} />
                          <Badge tone={STATE_TONE[d.state] ?? 'slate'}>{d.state}</Badge>
                        </span>
                        <span className="tabular-nums text-slate-400">
                          {d.count} · {pct}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Payment eligibility check</h2>
          </CardHeader>
          <CardBody>
            <form onSubmit={check} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Payee ID
                </label>
                <div className="flex gap-2">
                  <input
                    value={payeeId}
                    onChange={(e) => setPayeeId(e.target.value)}
                    placeholder="Paste a payee ID"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                  />
                  <Button type="submit" disabled={checking}>
                    {checking ? <Spinner /> : 'Check'}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Run a pre-payment gate check before releasing funds to a vendor.
                </p>
              </div>
            </form>

            {checkError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {checkError}
              </div>
            )}

            {checkResult && (
              <div
                className={`mt-3 rounded-lg border px-4 py-3 ${
                  checkResult.allowed
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-red-500/40 bg-red-500/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge tone={checkResult.allowed ? 'green' : 'red'}>
                    {checkResult.allowed ? 'Payment allowed' : 'Payment blocked'}
                  </Badge>
                </div>
                {checkResult.reasons.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-300">
                    {checkResult.reasons.map((r, i) => (
                      <li key={i}>{prettyReason(r)}</li>
                    ))}
                  </ul>
                )}
                {checkResult.allowed && checkResult.reasons.length === 0 && (
                  <p className="mt-2 text-sm text-slate-400">No blocks on file. This payee is clear to pay.</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Blocked dollars by reason</h2>
        </CardHeader>
        <CardBody className="p-0">
          {ledger.by_reason.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No blocked payees"
                description="Every payee is currently clear to pay, or no readiness has been computed yet."
                icon="✅"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH>Payees</TH>
                  <TH>Blocked dollars</TH>
                  <TH className="w-1/3">Share</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.by_reason.map((r) => {
                  const pct = Math.round((r.count / maxReasonCount) * 100)
                  return (
                    <TR key={r.reason}>
                      <TD className="font-medium text-slate-100">{prettyReason(r.reason)}</TD>
                      <TD className="tabular-nums">{r.count}</TD>
                      <TD className="tabular-nums text-red-300">
                        {r.blocked_cents != null ? fmtUsd(r.blocked_cents) : '—'}
                      </TD>
                      <TD>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-red-500/80" style={{ width: `${pct}%` }} />
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
