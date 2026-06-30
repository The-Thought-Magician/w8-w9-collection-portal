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

interface ExceptionRow {
  id: string
  payee_id: string | null
  form_id: string | null
  validation_id: string | null
  kind: string | null
  severity: string | null
  message: string | null
  status: string | null
  assignee: string | null
  resolution_note: string | null
  created_at: string | null
  updated_at: string | null
}

const STATUS_TABS = ['open', 'assigned', 'resolved', 'waived'] as const
type StatusTab = (typeof STATUS_TABS)[number] | 'all'

function statusTone(status: string | null | undefined): BadgeTone {
  switch ((status || '').toLowerCase()) {
    case 'resolved':
      return 'green'
    case 'waived':
      return 'blue'
    case 'assigned':
      return 'yellow'
    case 'open':
      return 'red'
    default:
      return 'slate'
  }
}

function severityTone(severity: string | null | undefined): BadgeTone {
  switch ((severity || '').toLowerCase()) {
    case 'error':
    case 'critical':
    case 'high':
      return 'red'
    case 'warning':
    case 'medium':
      return 'yellow'
    case 'info':
    case 'low':
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

type ActionKind = 'assign' | 'resolve' | 'waive'

export default function ExceptionsPage() {
  const [rows, setRows] = useState<ExceptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<StatusTab>('open')
  const [search, setSearch] = useState('')

  const [active, setActive] = useState<ExceptionRow | null>(null)
  const [actionKind, setActionKind] = useState<ActionKind>('assign')
  const [assignee, setAssignee] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = tab === 'all' ? undefined : { status: tab }
      const data = await api.listExceptions(q)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exceptions')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load])

  const openAction = useCallback((row: ExceptionRow, kind: ActionKind) => {
    setActive(row)
    setActionKind(kind)
    setAssignee(row.assignee || '')
    setNote(row.resolution_note || '')
    setActionError(null)
  }, [])

  const closeAction = useCallback(() => {
    setActive(null)
    setActionError(null)
  }, [])

  const submitAction = useCallback(async () => {
    if (!active) return
    setSubmitting(true)
    setActionError(null)
    try {
      if (actionKind === 'assign') {
        if (!assignee.trim()) {
          setActionError('Assignee is required.')
          setSubmitting(false)
          return
        }
        await api.assignException(active.id, { assignee: assignee.trim() })
      } else if (actionKind === 'resolve') {
        await api.resolveException(active.id, { resolution_note: note.trim() })
      } else {
        await api.waiveException(active.id, { resolution_note: note.trim() })
      }
      closeAction()
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setSubmitting(false)
    }
  }, [active, actionKind, assignee, note, closeAction, load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (r) =>
        (r.message || '').toLowerCase().includes(term) ||
        (r.kind || '').toLowerCase().includes(term) ||
        (r.assignee || '').toLowerCase().includes(term) ||
        (r.payee_id || '').toLowerCase().includes(term),
    )
  }, [rows, search])

  const stats = useMemo(() => {
    let open = 0
    let assigned = 0
    let resolved = 0
    let waived = 0
    for (const r of rows) {
      switch ((r.status || '').toLowerCase()) {
        case 'open':
          open += 1
          break
        case 'assigned':
          assigned += 1
          break
        case 'resolved':
          resolved += 1
          break
        case 'waived':
          waived += 1
          break
      }
    }
    return { open, assigned, resolved, waived, total: rows.length }
  }, [rows])

  const actionTitle =
    actionKind === 'assign' ? 'Assign exception' : actionKind === 'resolve' ? 'Resolve exception' : 'Waive exception'

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Exception Worklist</h1>
          <p className="mt-1 text-sm text-slate-400">
            Triage compliance exceptions: assign an owner, resolve with a note, or waive with justification.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner /> : 'Refresh'}
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open" value={stats.open} tone={stats.open ? 'red' : 'default'} />
        <Stat label="Assigned" value={stats.assigned} tone={stats.assigned ? 'yellow' : 'default'} />
        <Stat label="Resolved" value={stats.resolved} tone="green" />
        <Stat label="Waived" value={stats.waived} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {(['all', ...STATUS_TABS] as StatusTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  tab === t ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search message, kind, assignee…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <FullPageSpinner label="Loading exceptions…" />
          ) : error ? (
            <div className="px-5 py-8">
              <EmptyState
                title="Could not load exceptions"
                description={error}
                action={<Button onClick={() => void load()}>Retry</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No exceptions"
                description={
                  tab === 'open'
                    ? 'Nothing in the open queue. Failed validations and B-notices surface here.'
                    : 'No exceptions match this view.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Kind</TH>
                  <TH>Message</TH>
                  <TH>Payee</TH>
                  <TH>Assignee</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const closed = (r.status || '').toLowerCase() === 'resolved' || (r.status || '').toLowerCase() === 'waived'
                  return (
                    <TR key={r.id}>
                      <TD>
                        <Badge tone={severityTone(r.severity)}>{r.severity || '—'}</Badge>
                      </TD>
                      <TD className="text-slate-200">{r.kind || '—'}</TD>
                      <TD className="max-w-xs truncate" title={r.message || ''}>
                        {r.message || '—'}
                      </TD>
                      <TD className="font-mono text-xs text-slate-400">{r.payee_id ? r.payee_id.slice(0, 8) : '—'}</TD>
                      <TD className="text-slate-300">{r.assignee || <span className="text-slate-600">unassigned</span>}</TD>
                      <TD>
                        <Badge tone={statusTone(r.status)}>{r.status || '—'}</Badge>
                      </TD>
                      <TD className="text-xs text-slate-400">{fmtDate(r.created_at)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" disabled={closed} onClick={() => openAction(r, 'assign')}>
                            Assign
                          </Button>
                          <Button variant="secondary" disabled={closed} onClick={() => openAction(r, 'resolve')}>
                            Resolve
                          </Button>
                          <Button variant="ghost" disabled={closed} onClick={() => openAction(r, 'waive')}>
                            Waive
                          </Button>
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

      <Modal
        open={active !== null}
        onClose={closeAction}
        title={actionTitle}
        footer={
          <>
            <Button variant="ghost" onClick={closeAction}>
              Cancel
            </Button>
            <Button
              variant={actionKind === 'waive' ? 'danger' : 'primary'}
              disabled={submitting}
              onClick={() => void submitAction()}
            >
              {submitting ? <Spinner /> : actionKind === 'assign' ? 'Assign' : actionKind === 'resolve' ? 'Resolve' : 'Waive'}
            </Button>
          </>
        }
      >
        {active && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge tone={severityTone(active.severity)}>{active.severity || '—'}</Badge>
                <span className="text-sm font-medium text-slate-200">{active.kind || 'exception'}</span>
              </div>
              {active.message && <p className="mt-2 text-sm text-slate-400">{active.message}</p>}
            </div>

            {actionKind === 'assign' ? (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-300">Assignee</span>
                <input
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="user id or email"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-300">
                  {actionKind === 'resolve' ? 'Resolution note' : 'Waiver justification'}
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  placeholder={actionKind === 'resolve' ? 'How was this resolved?' : 'Why is this being waived?'}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                />
              </label>
            )}

            {actionError && <p className="text-sm text-red-400">{actionError}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
