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

interface RequestLink {
  id: string
  payee_id: string
  token: string
  status: string
  opened_at?: string | null
  submitted_at?: string | null
  created_at?: string
}

interface Payee {
  id: string
  vendor_name?: string
  legal_name?: string
  contact_email?: string
}

const STATUSES = ['active', 'opened', 'submitted', 'revoked']

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusTone(s: string): BadgeTone {
  switch (s) {
    case 'submitted':
      return 'green'
    case 'opened':
      return 'blue'
    case 'revoked':
      return 'slate'
    case 'active':
    default:
      return 'yellow'
  }
}

function portalUrl(token: string): string {
  if (typeof window === 'undefined') return `/portal/${token}`
  return `${window.location.origin}/portal/${token}`
}

export default function LinksPage() {
  const [links, setLinks] = useState<RequestLink[]>([])
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [payeeId, setPayeeId] = useState('')

  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const [lk, py] = await Promise.all([
        api.listLinks() as Promise<RequestLink[]>,
        api.listPayees() as Promise<Payee[]>,
      ])
      setLinks(Array.isArray(lk) ? lk : [])
      setPayees(Array.isArray(py) ? py : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load request links')
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
    return links.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false
      if (q) {
        const name = (payeeName.get(l.payee_id) || '').toLowerCase()
        if (!name.includes(q) && !l.token.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [links, search, statusFilter, payeeName])

  const counts = useMemo(() => {
    const active = links.filter((l) => l.status === 'active').length
    const submitted = links.filter((l) => l.status === 'submitted' || !!l.submitted_at).length
    const opened = links.filter((l) => l.status === 'opened' || !!l.opened_at).length
    const conversion = links.length ? Math.round((submitted / links.length) * 100) : 0
    return { active, submitted, opened, conversion }
  }, [links])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!payeeId) {
      setFormError('Select a payee')
      return
    }
    setSubmitting(true)
    try {
      await api.createLink({ payee_id: payeeId })
      setCreateOpen(false)
      setLoading(true)
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id)
    setError(null)
    try {
      await api.revokeLink(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke link')
    } finally {
      setRevokingId(null)
    }
  }

  async function copyLink(l: RequestLink) {
    const url = portalUrl(l.token)
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(l.id)
      setTimeout(() => setCopiedId((c) => (c === l.id ? null : c)), 1800)
    } catch {
      // clipboard unavailable; ignore
    }
  }

  if (loading && links.length === 0 && !error) {
    return <FullPageSpinner label="Loading request links..." />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Request Links</h1>
          <p className="mt-1 text-sm text-slate-400">
            Generate tokenized, no-login portal links so payees can complete their W-8/W-9 questionnaire.
          </p>
        </div>
        <Button
          onClick={() => {
            setPayeeId(payees[0]?.id || '')
            setFormError(null)
            setCreateOpen(true)
          }}
        >
          + Generate link
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
        <Stat label="Total links" value={links.length} hint="generated" />
        <Stat label="Active" value={counts.active} hint="awaiting payee" tone="yellow" />
        <Stat label="Submitted" value={counts.submitted} hint="completed via portal" tone="green" />
        <Stat label="Conversion" value={`${counts.conversion}%`} hint="submitted / total" tone="green" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Document request links</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payee or token..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
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
                title={links.length === 0 ? 'No request links yet' : 'No links match your filters'}
                description={
                  links.length === 0
                    ? 'Generate a tokenized link and send it to a payee so they can self-serve their tax form.'
                    : 'Try clearing the search or status filter.'
                }
                action={
                  links.length === 0 ? (
                    <Button onClick={() => { setPayeeId(payees[0]?.id || ''); setCreateOpen(true) }}>Generate link</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('') }}>
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
                  <TH>Status</TH>
                  <TH>Opened</TH>
                  <TH>Submitted</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-medium text-slate-100">{payeeName.get(l.payee_id) || l.payee_id}</TD>
                    <TD>
                      <Badge tone={statusTone(l.status)} className="capitalize">
                        {l.status}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDate(l.opened_at)}</TD>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDate(l.submitted_at)}</TD>
                    <TD className="whitespace-nowrap text-xs text-slate-500">{fmtDate(l.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => copyLink(l)}>
                          {copiedId === l.id ? 'Copied!' : 'Copy link'}
                        </Button>
                        {l.status !== 'revoked' && l.status !== 'submitted' && (
                          <Button
                            variant="ghost"
                            className="text-red-400 hover:text-red-300"
                            onClick={() => handleRevoke(l.id)}
                            disabled={revokingId === l.id}
                          >
                            {revokingId === l.id ? <Spinner /> : 'Revoke'}
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => !submitting && setCreateOpen(false)}
        title="Generate request link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="link-create-form" disabled={submitting}>
              {submitting ? <Spinner label="Generating..." /> : 'Generate'}
            </Button>
          </>
        }
      >
        <form id="link-create-form" onSubmit={handleCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Payee</label>
            {payees.length === 0 ? (
              <p className="text-sm text-slate-500">No payees available. Add a payee first.</p>
            ) : (
              <select
                value={payeeId}
                onChange={(e) => setPayeeId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500/60 focus:outline-none"
              >
                <option value="">Select a payee...</option>
                {payees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.vendor_name || p.legal_name || p.id}
                    {p.contact_email ? ` — ${p.contact_email}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-slate-500">
            A unique token is minted. Share the generated portal URL with the payee; they can complete the questionnaire
            without logging in.
          </p>
        </form>
      </Modal>
    </div>
  )
}
