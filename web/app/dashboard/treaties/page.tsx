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

interface TreatyCatalogEntry {
  id: string
  country: string
  article: string | null
  income_type: string | null
  rate: number | null
  notes: string | null
  created_at?: string | null
}

interface TreatyClaim {
  id: string
  user_id?: string
  form_id: string | null
  payee_id: string | null
  country: string | null
  article: string | null
  rate: number | null
  income_type: string | null
  is_valid: boolean | null
  message: string | null
  created_at: string | null
}

interface Payee {
  id: string
  vendor_name?: string | null
  legal_name?: string | null
  country?: string | null
}

function fmtRate(r?: number | null): string {
  if (r == null) return '—'
  return `${r}%`
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function TreatiesPage() {
  const [catalog, setCatalog] = useState<TreatyCatalogEntry[]>([])
  const [claims, setClaims] = useState<TreatyClaim[]>([])
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [catalogSearch, setCatalogSearch] = useState('')
  const [claimFilter, setClaimFilter] = useState<'all' | 'valid' | 'invalid'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    payee_id: '',
    form_id: '',
    country: '',
    article: '',
    rate: '',
    income_type: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cat, cl, py] = await Promise.all([
        api.getTreatyCatalog(),
        api.listTreatyClaims(),
        api.listPayees().catch(() => []),
      ])
      setCatalog(Array.isArray(cat) ? cat : cat?.catalog ?? [])
      setClaims(Array.isArray(cl) ? cl : cl?.claims ?? [])
      setPayees(Array.isArray(py) ? py : py?.payees ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load treaties')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (e) =>
        (e.country || '').toLowerCase().includes(q) ||
        (e.income_type || '').toLowerCase().includes(q) ||
        (e.article || '').toLowerCase().includes(q),
    )
  }, [catalog, catalogSearch])

  const filteredClaims = useMemo(() => {
    if (claimFilter === 'all') return claims
    return claims.filter((c) => (claimFilter === 'valid' ? c.is_valid === true : c.is_valid !== true))
  }, [claims, claimFilter])

  const claimStats = useMemo(() => {
    const valid = claims.filter((c) => c.is_valid === true).length
    const invalid = claims.length - valid
    const avgRate =
      claims.length > 0
        ? claims.reduce((s, c) => s + (c.rate ?? 0), 0) / claims.filter((c) => c.rate != null).length || 0
        : 0
    return { total: claims.length, valid, invalid, avgRate, countries: new Set(catalog.map((c) => c.country)).size }
  }, [claims, catalog])

  function openCreate() {
    setForm({ payee_id: '', form_id: '', country: '', article: '', rate: '', income_type: '' })
    setFormError(null)
    setCreateOpen(true)
  }

  function applyCatalogToForm(entry: TreatyCatalogEntry) {
    setForm((f) => ({
      ...f,
      country: entry.country,
      article: entry.article || f.article,
      rate: entry.rate != null ? String(entry.rate) : f.rate,
      income_type: entry.income_type || f.income_type,
    }))
    setCreateOpen(true)
  }

  async function submit() {
    setFormError(null)
    if (!form.payee_id) {
      setFormError('Select a payee for this claim.')
      return
    }
    if (!form.country.trim()) {
      setFormError('Country is required.')
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        payee_id: form.payee_id,
        country: form.country.trim(),
        article: form.article.trim() || undefined,
        income_type: form.income_type.trim() || undefined,
      }
      if (form.form_id.trim()) body.form_id = form.form_id.trim()
      if (form.rate.trim() !== '') {
        const r = Number(form.rate)
        if (!Number.isNaN(r)) body.rate = r
      }
      await api.createTreatyClaim(body)
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create claim')
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

  if (loading) return <FullPageSpinner label="Loading treaty data..." />

  if (error) {
    return (
      <div className="py-10">
        <EmptyState
          title="Could not load treaties"
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
          <h1 className="text-2xl font-bold text-white">Tax Treaties</h1>
          <p className="mt-1 text-sm text-slate-400">
            Browse the income-tax treaty catalog and record reduced-rate withholding claims for foreign payees.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Treaty Claim</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Treaty Countries" value={claimStats.countries} />
        <Stat label="Total Claims" value={claimStats.total} />
        <Stat label="Valid Claims" value={claimStats.valid} tone="green" />
        <Stat label="Invalid / Flagged" value={claimStats.invalid} tone={claimStats.invalid > 0 ? 'red' : 'default'} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Treaty Catalog</h2>
            <input
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
              placeholder="Search country, article, income type..."
              className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredCatalog.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={catalog.length === 0 ? 'Treaty catalog is empty' : 'No matches'}
                description={
                  catalog.length === 0
                    ? 'The treaty catalog has not been populated.'
                    : 'No catalog entries match your search.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Country</TH>
                  <TH>Article</TH>
                  <TH>Income Type</TH>
                  <TH className="text-right">Treaty Rate</TH>
                  <TH>Notes</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filteredCatalog.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-medium text-slate-100">{e.country}</TD>
                    <TD>{e.article || '—'}</TD>
                    <TD>{e.income_type || '—'}</TD>
                    <TD className="text-right tabular-nums text-emerald-400">{fmtRate(e.rate)}</TD>
                    <TD className="max-w-xs truncate text-slate-400">{e.notes || '—'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => applyCatalogToForm(e)}>
                        Claim
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Treaty Claims</h2>
            <div className="flex gap-1 rounded-lg border border-slate-700 bg-slate-950 p-1">
              {(['all', 'valid', 'invalid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setClaimFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    claimFilter === f ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredClaims.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={claims.length === 0 ? 'No treaty claims yet' : 'No claims match this filter'}
                description={
                  claims.length === 0
                    ? 'Record a treaty claim to apply a reduced withholding rate for a foreign payee.'
                    : 'Try a different filter.'
                }
                action={claims.length === 0 ? <Button onClick={openCreate}>New treaty claim</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Country</TH>
                  <TH>Article</TH>
                  <TH>Income Type</TH>
                  <TH className="text-right">Rate</TH>
                  <TH>Verdict</TH>
                  <TH>Message</TH>
                  <TH>Recorded</TH>
                </TR>
              </THead>
              <TBody>
                {filteredClaims.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-100">{payeeName(c.payee_id)}</TD>
                    <TD>{c.country || '—'}</TD>
                    <TD>{c.article || '—'}</TD>
                    <TD>{c.income_type || '—'}</TD>
                    <TD className="text-right tabular-nums">{fmtRate(c.rate)}</TD>
                    <TD>
                      <Badge tone={(c.is_valid ? 'green' : 'red') as BadgeTone}>
                        {c.is_valid ? 'Valid' : 'Invalid'}
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
        title="New Treaty Claim"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Spinner label="Validating..." /> : 'Record & Validate'}
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
                  {p.country ? ` (${p.country})` : ''}
                </option>
              ))}
            </select>
            {payees.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">No payees found. Add payees before recording claims.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="DE"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Article</label>
              <input
                value={form.article}
                onChange={(e) => setForm((f) => ({ ...f, article: e.target.value }))}
                placeholder="Article 12"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Income Type
              </label>
              <input
                value={form.income_type}
                onChange={(e) => setForm((f) => ({ ...f, income_type: e.target.value }))}
                placeholder="royalties"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Rate (%)
              </label>
              <input
                value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                placeholder="0"
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Form ID (optional)
            </label>
            <input
              value={form.form_id}
              onChange={(e) => setForm((f) => ({ ...f, form_id: e.target.value }))}
              placeholder="Link to a W-8 form id"
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
