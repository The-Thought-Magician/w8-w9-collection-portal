'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type ReadinessDist = Record<string, number>

interface Metrics {
  total_payees?: number
  forms_on_file?: number
  readiness_distribution?: ReadinessDist
  validation_pass_rate?: number
  blocked_cents?: number
}

interface LedgerReason {
  reason?: string
  payees?: number
  cents?: number
  [k: string]: unknown
}

interface Ledger {
  total_blocked_payees?: number
  total_blocked_cents?: number
  by_reason?: LedgerReason[]
  distribution?: ReadinessDist
}

interface TrendPoint {
  date?: string
  period?: string
  label?: string
  count?: number
  value?: number
  [k: string]: unknown
}

interface Trends {
  submissions?: TrendPoint[]
  expirations?: TrendPoint[]
}

interface SeedStatus {
  seeded?: boolean
}

const READINESS_META: Record<string, { label: string; tone: 'green' | 'yellow' | 'red'; hex: string }> = {
  green: { label: 'Ready', tone: 'green', hex: '#34d399' },
  yellow: { label: 'At risk', tone: 'yellow', hex: '#fbbf24' },
  red: { label: 'Blocked', tone: 'red', hex: '#f87171' },
}

function fmtUsd(cents?: number): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pointLabel(p: TrendPoint): string {
  const raw = p.date ?? p.period ?? p.label ?? ''
  if (!raw) return ''
  // Render YYYY-MM-DD or YYYY-MM compactly.
  const m = String(raw).match(/(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (m) return m[3] ? `${m[2]}/${m[3]}` : `${m[2]}/${m[1].slice(2)}`
  return String(raw)
}

function pointValue(p: TrendPoint): number {
  return Number(p.count ?? p.value ?? 0)
}

function TrendBars({ title, points, color }: { title: string; points: TrendPoint[]; color: string }) {
  if (!points || points.length === 0) {
    return (
      <div>
        <div className="mb-3 text-sm font-medium text-slate-300">{title}</div>
        <div className="flex h-32 items-center justify-center text-xs text-slate-600">No data yet</div>
      </div>
    )
  }
  const max = Math.max(1, ...points.map(pointValue))
  return (
    <div>
      <div className="mb-3 text-sm font-medium text-slate-300">{title}</div>
      <div className="flex h-32 items-end gap-1.5">
        {points.map((p, i) => {
          const v = pointValue(p)
          const h = Math.max(2, Math.round((v / max) * 100))
          return (
            <div key={i} className="group flex flex-1 flex-col items-center justify-end" title={`${pointLabel(p)}: ${v}`}>
              <div
                className="w-full rounded-t transition-all"
                style={{ height: `${h}%`, backgroundColor: color, opacity: 0.85 }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-600">
        <span>{pointLabel(points[0])}</span>
        {points.length > 1 && <span>{pointLabel(points[points.length - 1])}</span>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [trends, setTrends] = useState<Trends | null>(null)
  const [seedStatus, setSeedStatus] = useState<SeedStatus | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, l, t, s] = await Promise.all([
        api.getMetrics(),
        api.getReadinessLedger(),
        api.getTrends(),
        api.getSeedStatus(),
      ])
      setMetrics(m)
      setLedger(l)
      setTrends(t)
      setSeedStatus(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSeed() {
    setSeeding(true)
    setSeedMsg(null)
    try {
      const res = await api.seedSample()
      const created = (res && (res.created as number)) ?? 0
      setSeedMsg(`Seeded ${created} sample payees.`)
      await load()
    } catch (e) {
      setSeedMsg(e instanceof Error ? e.message : 'Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading dashboard..." />

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState
          title="Could not load the dashboard"
          description={error}
          icon={<span>⚠️</span>}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
      </div>
    )
  }

  const dist: ReadinessDist = metrics?.readiness_distribution ?? ledger?.distribution ?? {}
  const distEntries = Object.entries(dist)
  const distTotal = distEntries.reduce((a, [, v]) => a + Number(v || 0), 0)
  const seeded = seedStatus?.seeded ?? (metrics?.total_payees ?? 0) > 0
  const passRate = metrics?.validation_pass_rate
  const blockedCents = ledger?.total_blocked_cents ?? metrics?.blocked_cents

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Readiness across your payee book, blocked dollars, and submission trends.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={handleSeed} disabled={seeding} variant={seeded ? 'secondary' : 'primary'}>
            {seeding ? <Spinner label="Seeding..." /> : seeded ? 'Re-seed sample roster' : 'Seed sample roster'}
          </Button>
          {seedMsg && <span className="text-xs text-emerald-400">{seedMsg}</span>}
        </div>
      </header>

      {!seeded && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-emerald-200">No payees yet</div>
              <p className="mt-1 text-sm text-slate-400">
                Seed a realistic sample roster to explore validation, expiry, and the readiness ledger.
              </p>
            </div>
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? <Spinner label="Seeding..." /> : 'Seed sample roster'}
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total payees" value={(metrics?.total_payees ?? 0).toLocaleString()} />
        <Stat label="Forms on file" value={(metrics?.forms_on_file ?? 0).toLocaleString()} tone="green" />
        <Stat
          label="Blocked dollars"
          value={fmtUsd(blockedCents)}
          tone={(blockedCents ?? 0) > 0 ? 'red' : 'green'}
          hint={`${(ledger?.total_blocked_payees ?? 0).toLocaleString()} payees blocked`}
        />
        <Stat
          label="Validation pass rate"
          value={passRate == null ? '—' : `${Math.round(passRate <= 1 ? passRate * 100 : passRate)}%`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Readiness distribution</h2>
          </CardHeader>
          <CardBody>
            {distTotal === 0 ? (
              <p className="text-sm text-slate-500">No readiness states computed yet.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
                  {distEntries.map(([state, count]) => {
                    const meta = READINESS_META[state] ?? { hex: '#64748b' }
                    const pct = (Number(count) / distTotal) * 100
                    return (
                      <div
                        key={state}
                        style={{ width: `${pct}%`, backgroundColor: meta.hex }}
                        title={`${state}: ${count}`}
                      />
                    )
                  })}
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {distEntries.map(([state, count]) => {
                    const meta = READINESS_META[state] ?? { label: state, tone: 'slate' as const, hex: '#64748b' }
                    return (
                      <div key={state} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm text-slate-300">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.hex }} />
                          {(READINESS_META[state]?.label) ?? state}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-white">{Number(count).toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Blocked dollars by reason</h2>
          </CardHeader>
          <CardBody>
            {!ledger?.by_reason || ledger.by_reason.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing blocked. Every payee is payment ready.</p>
            ) : (
              <ul className="space-y-2">
                {ledger.by_reason.map((r, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-slate-300">
                      <Badge tone="red">{r.payees ?? 0}</Badge>
                      {r.reason ?? 'Unspecified'}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-red-300">{fmtUsd(r.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Trends</h2>
          <Link href="/dashboard/reports" className="text-xs text-emerald-400 hover:text-emerald-300">
            View reports →
          </Link>
        </CardHeader>
        <CardBody>
          <div className="grid gap-8 sm:grid-cols-2">
            <TrendBars title="Submissions" points={trends?.submissions ?? []} color="#34d399" />
            <TrendBars title="Expirations" points={trends?.expirations ?? []} color="#fbbf24" />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/dashboard/payees" className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 transition-colors hover:border-emerald-500/40">
          <div className="text-sm font-semibold text-white">Manage payees</div>
          <p className="mt-1 text-xs text-slate-500">Add vendors, filter the roster, track readiness.</p>
        </Link>
        <Link href="/dashboard/readiness" className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 transition-colors hover:border-emerald-500/40">
          <div className="text-sm font-semibold text-white">Readiness ledger</div>
          <p className="mt-1 text-xs text-slate-500">See exactly which payments are blocked and why.</p>
        </Link>
        <Link href="/dashboard/campaigns" className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 transition-colors hover:border-emerald-500/40">
          <div className="text-sm font-semibold text-white">Recertification campaigns</div>
          <p className="mt-1 text-xs text-slate-500">Chase expiring and missing forms in bulk.</p>
        </Link>
      </div>
    </div>
  )
}
