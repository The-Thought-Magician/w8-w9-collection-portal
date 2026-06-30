'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Notification {
  id: string
  user_id: string | null
  kind: string | null
  title: string | null
  body: string | null
  link: string | null
  is_read: boolean | null
  created_at: string | null
}

function kindTone(kind: string | null | undefined): BadgeTone {
  const k = (kind || '').toLowerCase()
  if (k.includes('expir') || k.includes('block') || k.includes('error') || k.includes('alert') || k.includes('bnotice'))
    return 'red'
  if (k.includes('warn') || k.includes('reminder') || k.includes('soon') || k.includes('pending')) return 'yellow'
  if (k.includes('submit') || k.includes('complete') || k.includes('ready') || k.includes('success')) return 'green'
  if (k.includes('info') || k.includes('campaign') || k.includes('link')) return 'blue'
  return 'slate'
}

function kindIcon(kind: string | null | undefined): string {
  const k = (kind || '').toLowerCase()
  if (k.includes('expir')) return '⏰'
  if (k.includes('block')) return '🚫'
  if (k.includes('submit') || k.includes('complete')) return '✅'
  if (k.includes('reminder') || k.includes('campaign')) return '📣'
  if (k.includes('bnotice') || k.includes('alert') || k.includes('error')) return '⚠'
  if (k.includes('link')) return '🔗'
  return '🔔'
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString()
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

type ReadFilter = 'all' | 'unread' | 'read'

export default function NotificationsPage() {
  const [rows, setRows] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listNotifications()
      setRows(Array.isArray(data) ? (data as Notification[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const markOne = useCallback(async (id: string) => {
    setActionError(null)
    setMarkingId(id)
    // Optimistic update.
    setRows((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    try {
      await api.markNotificationRead(id)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark as read')
      // Revert on failure.
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: false } : n)))
    } finally {
      setMarkingId(null)
    }
  }, [])

  const markAll = useCallback(async () => {
    setActionError(null)
    setMarkingAll(true)
    const snapshot = rows
    setRows((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark all as read')
      setRows(snapshot)
    } finally {
      setMarkingAll(false)
    }
  }, [rows])

  const kinds = useMemo(() => {
    const set = new Set<string>()
    for (const n of rows) if (n.kind) set.add(n.kind)
    return [...set].sort()
  }, [rows])

  const unreadCount = useMemo(() => rows.filter((n) => !n.is_read).length, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((n) => {
      if (readFilter === 'unread' && n.is_read) return false
      if (readFilter === 'read' && !n.is_read) return false
      if (kindFilter !== 'all' && (n.kind || '') !== kindFilter) return false
      if (!term) return true
      return (
        (n.title || '').toLowerCase().includes(term) ||
        (n.body || '').toLowerCase().includes(term) ||
        (n.kind || '').toLowerCase().includes(term)
      )
    })
  }, [rows, readFilter, kindFilter, search])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Expiry alerts, campaign progress, and compliance events for your roster.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : 'Refresh'}
          </Button>
          <Button variant="primary" onClick={() => void markAll()} disabled={markingAll || unreadCount === 0}>
            {markingAll ? <Spinner label="Marking…" /> : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total" value={rows.length} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'yellow' : 'green'} />
        <Stat label="Read" value={rows.length - unreadCount} />
        <Stat label="Kinds" value={kinds.length} />
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
            {(['all', 'unread', 'read'] as ReadFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setReadFilter(f)}
                className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  readFilter === f ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {f}
                {f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {loading ? (
            <FullPageSpinner label="Loading notifications…" />
          ) : error ? (
            <EmptyState
              title="Could not load notifications"
              description={error}
              action={<Button onClick={() => void load()}>Retry</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={rows.length === 0 ? 'No notifications yet' : 'Nothing matches'}
              description={
                rows.length === 0
                  ? "You're all caught up. Expiry, campaign, and compliance alerts will appear here."
                  : 'No notifications match the current filters.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`flex gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    n.is_read
                      ? 'border-slate-800 bg-slate-950'
                      : 'border-emerald-500/30 bg-emerald-500/[0.04]'
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-sm">
                    {kindIcon(n.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-label="unread" />}
                      <span className={`text-sm font-semibold ${n.is_read ? 'text-slate-300' : 'text-white'}`}>
                        {n.title || 'Notification'}
                      </span>
                      {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                      <span className="ml-auto text-xs text-slate-500" title={fmtDateTime(n.created_at)}>
                        {relativeTime(n.created_at)}
                      </span>
                    </div>
                    {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {n.link && (
                        <Link
                          href={n.link}
                          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline"
                        >
                          View →
                        </Link>
                      )}
                      <span className="text-xs text-slate-600">{fmtDateTime(n.created_at)}</span>
                      {!n.is_read && (
                        <button
                          onClick={() => void markOne(n.id)}
                          disabled={markingId === n.id}
                          className="text-xs font-medium text-slate-400 hover:text-white disabled:opacity-50"
                        >
                          {markingId === n.id ? 'Marking…' : 'Mark read'}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
