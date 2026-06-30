'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ExpiryRecord {
  id: string
  form_id: string | null
  payee_id: string | null
  valid_through: string | null
  days_remaining: number | null
  bucket: string | null
  computed_at: string | null
}

interface Buckets {
  valid: number
  expiring_soon: number
  expired: number
  no_expiry: number
}

type BucketKey = keyof Buckets

const BUCKET_META: Record<BucketKey, { label: string; tone: BadgeTone; bar: string; dot: string }> = {
  valid: { label: 'Valid', tone: 'green', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  expiring_soon: { label: 'Expiring soon', tone: 'yellow', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  expired: { label: 'Expired', tone: 'red', bar: 'bg-red-500', dot: 'bg-red-500' },
  no_expiry: { label: 'No expiry', tone: 'slate', bar: 'bg-slate-600', dot: 'bg-slate-600' },
}

const BUCKET_ORDER: BucketKey[] = ['expired', 'expiring_soon', 'valid', 'no_expiry']

function bucketMeta(bucket: string | null | undefined) {
  const key = (bucket || '') as BucketKey
  return BUCKET_META[key] ?? BUCKET_META.no_expiry
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString()
}

function daysTone(days: number | null | undefined, bucket: string | null | undefined): BadgeTone {
  const b = (bucket || '').toLowerCase()
  if (b === 'expired') return 'red'
  if (b === 'expiring_soon') return 'yellow'
  if (b === 'no_expiry') return 'slate'
  if (typeof days === 'number') {
    if (days < 0) return 'red'
    if (days <= 30) return 'yellow'
  }
  return 'green'
}

export default function ExpiryPage() {
  const [records, setRecords] = useState<ExpiryRecord[]>([])
  const [buckets, setBuckets] = useState<Buckets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [bucketFilter, setBucketFilter] = useState<BucketKey | 'all'>('all')
  const [search, setSearch] = useState('')

  const [recomputing, setRecomputing] = useState(false)
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = bucketFilter === 'all' ? undefined : { bucket: bucketFilter }
      const [recs, bkt] = await Promise.all([api.listExpiry(q), api.getExpiryBuckets()])
      setRecords(Array.isArray(recs) ? recs : [])
      setBuckets(bkt as Buckets)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load expiry data')
    } finally {
      setLoading(false)
    }
  }, [bucketFilter])

  useEffect(() => {
    void load()
  }, [load])

  const recompute = useCallback(async () => {
    setRecomputing(true)
    setRecomputeMsg(null)
    try {
      const res = (await api.recomputeExpiry()) as { updated?: number }
      setRecomputeMsg(`Recomputed expiry and readiness for ${res?.updated ?? 0} record(s).`)
      await load()
    } catch (e) {
      setRecomputeMsg(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }, [load])

  const total = useMemo(() => {
    if (!buckets) return 0
    return buckets.valid + buckets.expiring_soon + buckets.expired + buckets.no_expiry
  }, [buckets])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return records
    return records.filter(
      (r) =>
        (r.payee_id || '').toLowerCase().includes(term) ||
        (r.form_id || '').toLowerCase().includes(term) ||
        (r.bucket || '').toLowerCase().includes(term),
    )
  }, [records, search])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Expiry Clock</h1>
          <p className="mt-1 text-sm text-slate-400">
            W-8 forms expire on the last day of the third year. Track validity windows and recompute the roster.
          </p>
        </div>
        <Button variant="primary" onClick={() => void recompute()} disabled={recomputing}>
          {recomputing ? <Spinner label="Recomputing…" /> : 'Recompute expiry'}
        </Button>
      </header>

      {recomputeMsg && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">
          {recomputeMsg}
        </div>
      )}

      {/* Bucket stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {BUCKET_ORDER.map((key) => {
          const meta = BUCKET_META[key]
          const count = buckets ? buckets[key] : 0
          const isActive = bucketFilter === key
          return (
            <button
              key={key}
              onClick={() => setBucketFilter(isActive ? 'all' : key)}
              className={`rounded-xl border px-5 py-4 text-left transition-colors ${
                isActive ? 'border-emerald-500/60 bg-slate-800' : 'border-slate-800 bg-slate-900 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                {meta.label}
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums text-white">{count}</div>
            </button>
          )
        })}
      </div>

      {/* Stacked distribution bar */}
      {buckets && total > 0 && (
        <Card>
          <CardBody>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Roster distribution</span>
              <span>{total} forms</span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
              {BUCKET_ORDER.map((key) => {
                const count = buckets[key]
                if (!count) return null
                return (
                  <div
                    key={key}
                    className={BUCKET_META[key].bar}
                    style={{ width: `${(count / total) * 100}%` }}
                    title={`${BUCKET_META[key].label}: ${count}`}
                  />
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
              {BUCKET_ORDER.map((key) => (
                <span key={key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${BUCKET_META[key].dot}`} />
                  {BUCKET_META[key].label} {buckets[key]}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              {bucketFilter === 'all' ? 'All forms' : BUCKET_META[bucketFilter].label}
            </h2>
            {bucketFilter !== 'all' && (
              <Button variant="ghost" onClick={() => setBucketFilter('all')}>
                Clear filter
              </Button>
            )}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payee, form, bucket…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <FullPageSpinner label="Loading expiry records…" />
          ) : error ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Could not load expiry data"
                description={error}
                action={<Button onClick={() => void load()}>Retry</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No expiry records"
                description={
                  records.length === 0
                    ? 'Submit forms and run a recompute to populate the expiry clock.'
                    : 'No records match the current filter.'
                }
                action={records.length === 0 ? <Button onClick={() => void recompute()}>Recompute now</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Bucket</TH>
                  <TH>Payee</TH>
                  <TH>Form</TH>
                  <TH>Valid through</TH>
                  <TH className="text-right">Days remaining</TH>
                  <TH>Computed</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <Badge tone={bucketMeta(r.bucket).tone}>{r.bucket ? bucketMeta(r.bucket).label : '—'}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{r.payee_id ? r.payee_id.slice(0, 8) : '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{r.form_id ? r.form_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-slate-300">{fmtDate(r.valid_through)}</TD>
                    <TD className="text-right">
                      {r.days_remaining == null ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <Badge tone={daysTone(r.days_remaining, r.bucket)}>
                          {r.days_remaining < 0 ? `${Math.abs(r.days_remaining)}d overdue` : `${r.days_remaining}d`}
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-xs text-slate-400">{fmtDate(r.computed_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
