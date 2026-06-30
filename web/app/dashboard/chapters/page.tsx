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

interface ChapterStatus {
  id: string
  user_id?: string
  form_id: string | null
  payee_id: string | null
  chapter3_status: string | null
  chapter4_status: string | null
  is_consistent: boolean | null
  message: string | null
  created_at: string | null
}

interface Payee {
  id: string
  vendor_name?: string | null
  legal_name?: string | null
}

interface ChapterSummary {
  by_chapter4?: Array<{ status: string; count: number }> | Record<string, number>
}

const CHAPTER3_OPTIONS = [
  'Corporation',
  'Individual',
  'Partnership',
  'Disregarded Entity',
  'Government',
  'Tax-Exempt Organization',
  'Foreign Government',
]

const CHAPTER4_OPTIONS = [
  'Participating FFI',
  'Reporting Model 1 FFI',
  'Reporting Model 2 FFI',
  'Nonparticipating FFI',
  'Active NFFE',
  'Passive NFFE',
  'Exempt Beneficial Owner',
  'U.S. Person',
]

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function chapter4Tone(status: string): BadgeTone {
  const s = status.toLowerCase()
  if (s.includes('nonparticipating')) return 'red'
  if (s.includes('passive')) return 'yellow'
  if (s.includes('u.s.') || s.includes('us person')) return 'blue'
  return 'green'
}

export default function ChaptersPage() {
  const [chapters, setChapters] = useState<ChapterStatus[]>([])
  const [summary, setSummary] = useState<ChapterSummary | null>(null)
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<'all' | 'consistent' | 'inconsistent'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    payee_id: '',
    form_id: '',
    chapter3_status: '',
    chapter4_status: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ch, sm, py] = await Promise.all([
        api.listChapters(),
        api.getChapterSummary().catch(() => ({ by_chapter4: [] })),
        api.listPayees().catch(() => []),
      ])
      setChapters(Array.isArray(ch) ? ch : ch?.chapters ?? [])
      setSummary(sm ?? null)
      setPayees(Array.isArray(py) ? py : py?.payees ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load chapter statuses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const summaryRows = useMemo(() => {
    const by = summary?.by_chapter4
    if (!by) return [] as Array<{ status: string; count: number }>
    if (Array.isArray(by)) {
      return by.map((r) => ({ status: r.status ?? 'Unknown', count: Number(r.count) || 0 }))
    }
    return Object.entries(by).map(([status, count]) => ({ status, count: Number(count) || 0 }))
  }, [summary])

  const maxCount = useMemo(
    () => summaryRows.reduce((m, r) => Math.max(m, r.count), 0) || 1,
    [summaryRows],
  )

  const stats = useMemo(() => {
    const consistent = chapters.filter((c) => c.is_consistent === true).length
    const inconsistent = chapters.length - consistent
    const payeesCovered = new Set(chapters.map((c) => c.payee_id).filter(Boolean)).size
    return { total: chapters.length, consistent, inconsistent, payeesCovered }
  }, [chapters])

  const filteredChapters = useMemo(() => {
    if (filter === 'all') return chapters
    return chapters.filter((c) =>
      filter === 'consistent' ? c.is_consistent === true : c.is_consistent !== true,
    )
  }, [chapters, filter])

  function openCreate() {
    setForm({ payee_id: '', form_id: '', chapter3_status: '', chapter4_status: '' })
    setFormError(null)
    setCreateOpen(true)
  }

  async function submit() {
    setFormError(null)
    if (!form.payee_id) {
      setFormError('Select a payee.')
      return
    }
    if (!form.chapter3_status || !form.chapter4_status) {
      setFormError('Both Chapter 3 and Chapter 4 statuses are required.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        payee_id: form.payee_id,
        chapter3_status: form.chapter3_status,
        chapter4_status: form.chapter4_status,
      }
      if (form.form_id.trim()) body.form_id = form.form_id.trim()
      await api.createChapterStatus(body)
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to record chapter status')
    } finally {
      setSubmitting(false)
    }
  }

  const payeeName = useCallback(
    (id: string | null) => {
      if (!id) return '—'
      const p = payees.find((x) => x.id === id)
      return p?.vendor_name || p?.legal_name || id.slice(0, 8)
    },
    [payees],
  )

  if (loading) return <FullPageSpinner label="Loading chapter statuses..." />

  if (error) {
    return (
      <div className="py-10">
        <EmptyState
          title="Could not load chapter statuses"
          description={error}
          action={<Button variant="secondary" onClick={load}>Try again</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Chapter 3 / 4 Status</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track FATCA Chapter 4 classifications alongside Chapter 3 status and flag inconsistent pairings.
          </p>
        </div>
        <Button onClick={openCreate}>+ Record Status</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Status Records" value={stats.total} />
        <Stat label="Payees Covered" value={stats.payeesCovered} />
        <Stat label="Consistent" value={stats.consistent} tone="green" />
        <Stat
          label="Inconsistent"
          value={stats.inconsistent}
          tone={stats.inconsistent > 0 ? 'red' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Payees by Chapter 4 Status</h2>
        </CardHeader>
        <CardBody>
          {summaryRows.length === 0 ? (
            <EmptyState
              title="No FATCA distribution yet"
              description="Record chapter statuses to see how your payee book breaks down by Chapter 4 classification."
            />
          ) : (
            <div className="space-y-3">
              {summaryRows
                .slice()
                .sort((a, b) => b.count - a.count)
                .map((r) => (
                  <div key={r.status} className="flex items-center gap-3">
                    <div className="w-56 shrink-0 truncate text-sm text-slate-300">{r.status}</div>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-slate-800">
                      <div
                        className="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-emerald-600 to-emerald-400 px-2 text-xs font-medium text-emerald-950"
                        style={{ width: `${Math.max(6, (r.count / maxCount) * 100)}%` }}
                      >
                        {r.count}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Status Records</h2>
            <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
              {(['all', 'consistent', 'inconsistent'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    filter === f ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredChapters.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={chapters.length === 0 ? 'No chapter statuses recorded' : 'No records match this filter'}
                description={
                  chapters.length === 0
                    ? 'Record a Chapter 3 / Chapter 4 status pairing to run a consistency check.'
                    : 'Try a different filter.'
                }
                action={chapters.length === 0 ? <Button onClick={openCreate}>Record status</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Chapter 3</TH>
                  <TH>Chapter 4 (FATCA)</TH>
                  <TH>Consistency</TH>
                  <TH>Message</TH>
                  <TH>Recorded</TH>
                </TR>
              </THead>
              <TBody>
                {filteredChapters.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-100">{payeeName(c.payee_id)}</TD>
                    <TD>{c.chapter3_status || '—'}</TD>
                    <TD>
                      {c.chapter4_status ? (
                        <Badge tone={chapter4Tone(c.chapter4_status)}>{c.chapter4_status}</Badge>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      <Badge tone={(c.is_consistent ? 'green' : 'red') as BadgeTone}>
                        {c.is_consistent ? 'Consistent' : 'Inconsistent'}
                      </Badge>
                    </TD>
                    <TD className="max-w-xs truncate text-slate-400">{c.message || '—'}</TD>
                    <TD className="text-slate-400">{fmtDate(c.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Record Chapter 3 / 4 Status"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Spinner label="Checking..." /> : 'Record & Check'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Payee</label>
            <select
              value={form.payee_id}
              onChange={(e) => setForm((f) => ({ ...f, payee_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select a payee…</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.vendor_name || p.legal_name || p.id}
                </option>
              ))}
            </select>
            {payees.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">No payees found. Add payees first.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Chapter 3 Status
              </label>
              <select
                value={form.chapter3_status}
                onChange={(e) => setForm((f) => ({ ...f, chapter3_status: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Select…</option>
                {CHAPTER3_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Chapter 4 Status
              </label>
              <select
                value={form.chapter4_status}
                onChange={(e) => setForm((f) => ({ ...f, chapter4_status: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Select…</option>
                {CHAPTER4_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Form ID (optional)
            </label>
            <input
              value={form.form_id}
              onChange={(e) => setForm((f) => ({ ...f, form_id: e.target.value }))}
              placeholder="Link to a form id"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
