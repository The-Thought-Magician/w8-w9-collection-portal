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

interface Bnotice {
  id: string
  payee_id: string
  notice_kind: string
  received_date?: string | null
  status: string
  note?: string | null
  created_at?: string
}

interface AtRisk {
  payee_id: string
  vendor_name?: string
  reason?: string
  open_notices?: number
}

interface BnoticeResponse {
  notices: Bnotice[]
  at_risk: AtRisk[]
}

interface Payee {
  id: string
  vendor_name?: string
  legal_name?: string
}

const NOTICE_KINDS = ['first_b_notice', 'second_b_notice', 'cp2100', '972cg']
const STATUSES = ['open', 'responded', 'resolved', 'escalated']

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusTone(s: string): BadgeTone {
  switch (s) {
    case 'resolved':
      return 'green'
    case 'responded':
      return 'blue'
    case 'escalated':
      return 'red'
    case 'open':
    default:
      return 'yellow'
  }
}

function kindLabel(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function kindTone(k: string): BadgeTone {
  if (k.includes('second') || k === '972cg') return 'red'
  if (k === 'cp2100') return 'yellow'
  return 'slate'
}

export default function BnoticesPage() {
  const [notices, setNotices] = useState<Bnotice[]>([])
  const [atRisk, setAtRisk] = useState<AtRisk[]>([])
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    payee_id: '',
    notice_kind: 'first_b_notice',
    received_date: new Date().toISOString().slice(0, 10),
    note: '',
  })

  const [editing, setEditing] = useState<Bnotice | null>(null)
  const [editStatus, setEditStatus] = useState('open')
  const [editNote, setEditNote] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const [res, py] = await Promise.all([
        api.listBnotices() as Promise<BnoticeResponse | Bnotice[]>,
        api.listPayees() as Promise<Payee[]>,
      ])
      if (Array.isArray(res)) {
        setNotices(res)
        setAtRisk([])
      } else {
        setNotices(Array.isArray(res?.notices) ? res.notices : [])
        setAtRisk(Array.isArray(res?.at_risk) ? res.at_risk : [])
      }
      setPayees(Array.isArray(py) ? py : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load B-notices')
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
    return notices.filter((n) => {
      if (statusFilter && n.status !== statusFilter) return false
      if (kindFilter && n.notice_kind !== kindFilter) return false
      if (q) {
        const name = (payeeName.get(n.payee_id) || '').toLowerCase()
        if (!name.includes(q) && !(n.note || '').toLowerCase().includes(q) && !n.notice_kind.toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })
  }, [notices, search, statusFilter, kindFilter, payeeName])

  const counts = useMemo(() => {
    const open = notices.filter((n) => n.status === 'open').length
    const escalated = notices.filter((n) => n.status === 'escalated').length
    const second = notices.filter((n) => n.notice_kind.includes('second') || n.notice_kind === '972cg').length
    return { open, escalated, second }
  }, [notices])

  function resetCreate() {
    setForm({
      payee_id: payees[0]?.id || '',
      notice_kind: 'first_b_notice',
      received_date: new Date().toISOString().slice(0, 10),
      note: '',
    })
    setFormError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.payee_id) {
      setFormError('Select a payee')
      return
    }
    setSubmitting(true)
    try {
      await api.createBnotice({
        payee_id: form.payee_id,
        notice_kind: form.notice_kind,
        received_date: form.received_date || null,
        note: form.note || null,
        status: 'open',
      })
      setCreateOpen(false)
      setLoading(true)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record B-notice')
    } finally {
      setSubmitting(false)
    }
  }

  function openEdit(n: Bnotice) {
    setEditing(n)
    setEditStatus(n.status)
    setEditNote(n.note || '')
    setEditError(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setEditError(null)
    setSavingEdit(true)
    try {
      await api.updateBnotice(editing.id, { status: editStatus, note: editNote || null })
      setEditing(null)
      setLoading(true)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update B-notice')
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading && notices.length === 0 && !error) {
    return <FullPageSpinner label="Loading B-notice register..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">B-Notices</h1>
          <p className="mt-1 text-sm text-slate-400">
            CP2100/972CG risk register. Track first and second B-notices and the payees at risk of backup withholding.
          </p>
        </div>
        <Button
          onClick={() => {
            resetCreate()
            setCreateOpen(true)
          }}
        >
          + Record B-notice
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
        <Stat label="Total notices" value={notices.length} hint="recorded" />
        <Stat label="Open" value={counts.open} hint="awaiting response" tone="yellow" />
        <Stat label="Second notice / 972CG" value={counts.second} hint="elevated risk" tone="red" />
        <Stat label="At-risk payees" value={atRisk.length} hint="backup-withholding exposure" tone="red" />
      </div>

      {atRisk.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">At-risk payees</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Payees with open notices or a TIN mismatch that may trigger 24% backup withholding.
            </p>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Reason</TH>
                  <TH className="text-right">Open notices</TH>
                </TR>
              </THead>
              <TBody>
                {atRisk.map((a) => (
                  <TR key={a.payee_id}>
                    <TD className="font-medium text-slate-100">
                      {a.vendor_name || payeeName.get(a.payee_id) || a.payee_id}
                    </TD>
                    <TD className="text-slate-400">{a.reason || 'TIN mismatch / B-notice'}</TD>
                    <TD className="text-right tabular-nums">
                      <Badge tone={(a.open_notices ?? 0) > 1 ? 'red' : 'yellow'}>{a.open_notices ?? 0}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Notice register</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payee, kind, note..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">All kinds</option>
              {NOTICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={notices.length === 0 ? 'No B-notices recorded' : 'No notices match your filters'}
                description={
                  notices.length === 0
                    ? 'When the IRS issues a CP2100 or 972CG, record the B-notice here to track your response window.'
                    : 'Try clearing the search or filters.'
                }
                action={
                  notices.length === 0 ? (
                    <Button onClick={() => { resetCreate(); setCreateOpen(true) }}>Record B-notice</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setKindFilter('') }}>
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
                  <TH>Kind</TH>
                  <TH>Received</TH>
                  <TH>Status</TH>
                  <TH>Note</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((n) => (
                  <TR key={n.id}>
                    <TD className="font-medium text-slate-100">{payeeName.get(n.payee_id) || n.payee_id}</TD>
                    <TD>
                      <Badge tone={kindTone(n.notice_kind)}>{kindLabel(n.notice_kind)}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDate(n.received_date)}</TD>
                    <TD>
                      <Badge tone={statusTone(n.status)} className="capitalize">
                        {n.status}
                      </Badge>
                    </TD>
                    <TD className="max-w-xs text-xs text-slate-400">{n.note || '—'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => openEdit(n)}>
                        Update
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !submitting && setCreateOpen(false)}
        title="Record B-notice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="bnotice-create-form" disabled={submitting}>
              {submitting ? <Spinner label="Saving..." /> : 'Record'}
            </Button>
          </>
        }
      >
        <form id="bnotice-create-form" onSubmit={handleCreate} className="space-y-4">
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Notice kind</label>
            <select
              value={form.notice_kind}
              onChange={(e) => setForm((f) => ({ ...f, notice_kind: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            >
              {NOTICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Received date</label>
            <input
              type="date"
              value={form.received_date}
              onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Note</label>
            <textarea
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              rows={3}
              placeholder="Context, response status, follow-up..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => !savingEdit && setEditing(null)}
        title="Update B-notice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="submit" form="bnotice-edit-form" disabled={savingEdit}>
              {savingEdit ? <Spinner label="Saving..." /> : 'Save'}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="bnotice-edit-form" onSubmit={handleEdit} className="space-y-4">
            {editError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{editError}</div>
            )}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
              <span className="text-slate-500">Payee:</span> {payeeName.get(editing.payee_id) || editing.payee_id}
              <br />
              <span className="text-slate-500">Kind:</span> {kindLabel(editing.notice_kind)} ·{' '}
              <span className="text-slate-500">Received:</span> {fmtDate(editing.received_date)}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Status</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Note</label>
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
              />
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
