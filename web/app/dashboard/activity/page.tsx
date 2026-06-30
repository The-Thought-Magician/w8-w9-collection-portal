'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface ActivityRow {
  id: string
  user_id: string | null
  payee_id: string | null
  action: string | null
  entity_type: string | null
  entity_id: string | null
  detail: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

function actionTone(action: string | null | undefined): BadgeTone {
  const a = (action || '').toLowerCase()
  if (a.includes('delete') || a.includes('revoke') || a.includes('block') || a.includes('fail')) return 'red'
  if (a.includes('create') || a.includes('submit') || a.includes('resolve') || a.includes('add')) return 'green'
  if (a.includes('update') || a.includes('assign') || a.includes('remind') || a.includes('edit')) return 'yellow'
  if (a.includes('validate') || a.includes('check') || a.includes('view') || a.includes('open')) return 'blue'
  return 'slate'
}

function entityIcon(entityType: string | null | undefined): string {
  switch ((entityType || '').toLowerCase()) {
    case 'payee':
      return '🧾'
    case 'form':
      return '📄'
    case 'validation':
      return '✔'
    case 'campaign':
      return '📣'
    case 'exception':
      return '⚠'
    case 'link':
      return '🔗'
    case 'import':
      return '📥'
    default:
      return '•'
  }
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
}

function dayKey(value: string | null | undefined): string {
  if (!value) return 'Unknown date'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [payeeFilter, setPayeeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = payeeFilter.trim() ? { payee_id: payeeFilter.trim() } : undefined
      const data = await api.listActivity(q)
      setRows(Array.isArray(data) ? (data as ActivityRow[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [payeeFilter])

  useEffect(() => {
    void load()
  }, [load])

  const entityTypes = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.entity_type) set.add(r.entity_type)
    return [...set].sort()
  }, [rows])

  const actionTypes = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.action) set.add(r.action)
    return [...set].sort()
  }, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (entityFilter !== 'all' && (r.entity_type || '') !== entityFilter) return false
      if (actionFilter !== 'all' && (r.action || '') !== actionFilter) return false
      if (!term) return true
      return (
        (r.action || '').toLowerCase().includes(term) ||
        (r.detail || '').toLowerCase().includes(term) ||
        (r.entity_type || '').toLowerCase().includes(term) ||
        (r.entity_id || '').toLowerCase().includes(term) ||
        (r.payee_id || '').toLowerCase().includes(term)
      )
    })
  }, [rows, search, entityFilter, actionFilter])

  // Group filtered rows by calendar day (rows arrive newest-first from backend).
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>()
    for (const r of filtered) {
      const k = dayKey(r.created_at)
      const arr = map.get(k)
      if (arr) arr.push(r)
      else map.set(k, [r])
    }
    return [...map.entries()]
  }, [filtered])

  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return rows.filter((r) => {
      if (!r.created_at) return false
      const d = new Date(r.created_at)
      return !Number.isNaN(d.getTime()) && d.toDateString() === today
    }).length
  }, [rows])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Activity & Audit Trail</h1>
          <p className="mt-1 text-sm text-slate-400">
            Append-only record of every change across payees, forms, validations, and campaigns.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : 'Refresh'}
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total events" value={rows.length} />
        <Stat label="Today" value={todayCount} tone={todayCount ? 'green' : 'default'} />
        <Stat label="Entity types" value={entityTypes.length} />
        <Stat label="Action types" value={actionTypes.length} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action, detail, entity…"
              className="w-60 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All actions</option>
              {actionTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={payeeFilter}
              onChange={(e) => setPayeeFilter(e.target.value)}
              placeholder="Scope to payee id"
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            {payeeFilter && (
              <Button variant="ghost" onClick={() => setPayeeFilter('')}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <FullPageSpinner label="Loading activity…" />
          ) : error ? (
            <EmptyState
              title="Could not load activity"
              description={error}
              action={<Button onClick={() => void load()}>Retry</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description={
                rows.length === 0
                  ? 'As you create payees, submit forms, and run campaigns, every action is logged here.'
                  : 'No events match the current filters.'
              }
            />
          ) : (
            <div className="space-y-8">
              {groups.map(([day, events]) => (
                <div key={day}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</h3>
                    <span className="text-xs text-slate-600">{events.length} events</span>
                  </div>
                  <ol className="relative space-y-4 border-l border-slate-800 pl-6">
                    {events.map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[1.6rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[10px]">
                          {entityIcon(e.entity_type)}
                        </span>
                        <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={actionTone(e.action)}>{e.action || 'event'}</Badge>
                            {e.entity_type && (
                              <span className="text-xs text-slate-400">
                                {e.entity_type}
                                {e.entity_id ? (
                                  <span className="ml-1 font-mono text-slate-500">{e.entity_id.slice(0, 8)}</span>
                                ) : null}
                              </span>
                            )}
                            <span className="ml-auto text-xs text-slate-500" title={fmtDateTime(e.created_at)}>
                              {relativeTime(e.created_at)}
                            </span>
                          </div>
                          {e.detail && <p className="mt-2 text-sm text-slate-300">{e.detail}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span title={fmtDateTime(e.created_at)}>{fmtDateTime(e.created_at)}</span>
                            {e.payee_id && (
                              <span className="font-mono">payee {e.payee_id.slice(0, 8)}</span>
                            )}
                          </div>
                          {e.metadata && Object.keys(e.metadata).length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                                Metadata
                              </summary>
                              <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-800 bg-slate-900 p-2 text-xs text-slate-400">
                                {JSON.stringify(e.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
