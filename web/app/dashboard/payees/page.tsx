'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Payee {
  id: string
  vendor_name: string
  legal_name?: string | null
  contact_email?: string | null
  country: string
  is_us_person: boolean
  vendor_type: string
  expected_annual_spend_cents: number
  external_ref?: string | null
  notes?: string | null
  readiness_state: string
  compliance_status: string
  created_at?: string
}

const READINESS_TONE: Record<string, BadgeTone> = {
  green: 'green',
  yellow: 'yellow',
  red: 'red',
}
const READINESS_LABEL: Record<string, string> = {
  green: 'Ready',
  yellow: 'At risk',
  red: 'Blocked',
}

const VENDOR_TYPES = ['individual', 'corporation', 'partnership', 'llc', 'trust', 'government', 'other']

function fmtUsd(cents?: number): string {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

interface FormState {
  vendor_name: string
  legal_name: string
  contact_email: string
  country: string
  is_us_person: boolean
  vendor_type: string
  expected_annual_spend: string
  external_ref: string
  notes: string
}

const EMPTY_FORM: FormState = {
  vendor_name: '',
  legal_name: '',
  contact_email: '',
  country: 'US',
  is_us_person: true,
  vendor_type: 'individual',
  expected_annual_spend: '',
  external_ref: '',
  notes: '',
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'

export default function PayeesPage() {
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Payee | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q: Record<string, string> = {}
      if (stateFilter) q.state = stateFilter
      if (countryFilter) q.country = countryFilter
      if (typeFilter) q.type = typeFilter
      const data = await api.listPayees(Object.keys(q).length ? q : undefined)
      setPayees(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payees')
    } finally {
      setLoading(false)
    }
  }, [stateFilter, countryFilter, typeFilter])

  useEffect(() => {
    void load()
  }, [load])

  const countries = useMemo(
    () => Array.from(new Set(payees.map((p) => p.country).filter(Boolean))).sort(),
    [payees],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return payees
    return payees.filter((p) =>
      [p.vendor_name, p.legal_name, p.contact_email, p.external_ref]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    )
  }, [payees, search])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormErr(null)
    if (!form.vendor_name.trim()) {
      setFormErr('Vendor name is required.')
      return
    }
    setSaving(true)
    try {
      const spend = form.expected_annual_spend.trim()
      const cents = spend ? Math.round(parseFloat(spend) * 100) : 0
      await api.createPayee({
        vendor_name: form.vendor_name.trim(),
        legal_name: form.legal_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        country: form.country.trim() || 'US',
        is_us_person: form.is_us_person,
        vendor_type: form.vendor_type,
        expected_annual_spend_cents: Number.isFinite(cents) ? cents : 0,
        external_ref: form.external_ref.trim() || null,
        notes: form.notes.trim() || null,
      })
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create payee')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    setDeletingBusy(true)
    try {
      await api.deletePayee(deleting.id)
      setDeleting(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete payee')
      setDeleting(null)
    } finally {
      setDeletingBusy(false)
    }
  }

  const hasFilters = Boolean(stateFilter || countryFilter || typeFilter || search)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Payees</h1>
          <p className="mt-1 text-sm text-slate-400">Your vendor roster with readiness and compliance status.</p>
        </div>
        <Button onClick={() => { setForm(EMPTY_FORM); setFormErr(null); setCreateOpen(true) }}>
          + Add payee
        </Button>
      </header>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, ref..."
            className={`${inputCls} max-w-xs flex-1`}
          />
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="">All readiness</option>
            <option value="green">Ready</option>
            <option value="yellow">At risk</option>
            <option value="red">Blocked</option>
          </select>
          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputCls} w-auto`}>
            <option value="">All types</option>
            {VENDOR_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() => { setSearch(''); setStateFilter(''); setCountryFilter(''); setTypeFilter('') }}
            >
              Clear
            </Button>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {filtered.length} of {payees.length}
          </span>
        </CardBody>
      </Card>

      {loading ? (
        <FullPageSpinner label="Loading payees..." />
      ) : error ? (
        <EmptyState
          title="Could not load payees"
          description={error}
          icon={<span>⚠️</span>}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={payees.length === 0 ? 'No payees yet' : 'No payees match your filters'}
          description={
            payees.length === 0
              ? 'Add your first vendor, or seed a sample roster from the dashboard.'
              : 'Try clearing the filters or search term.'
          }
          icon={<span>📄</span>}
          action={
            payees.length === 0 ? (
              <Button onClick={() => setCreateOpen(true)}>Add payee</Button>
            ) : (
              <Button variant="secondary" onClick={() => { setSearch(''); setStateFilter(''); setCountryFilter(''); setTypeFilter('') }}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Vendor</TH>
              <TH>Type</TH>
              <TH>Country</TH>
              <TH>Person</TH>
              <TH className="text-right">Annual spend</TH>
              <TH>Readiness</TH>
              <TH>Compliance</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link href={`/dashboard/payees/${p.id}`} className="font-medium text-white hover:text-emerald-300">
                    {p.vendor_name}
                  </Link>
                  {p.legal_name && p.legal_name !== p.vendor_name && (
                    <div className="text-xs text-slate-500">{p.legal_name}</div>
                  )}
                  {p.contact_email && <div className="text-xs text-slate-600">{p.contact_email}</div>}
                </TD>
                <TD className="capitalize">{p.vendor_type}</TD>
                <TD>{p.country}</TD>
                <TD>
                  <Badge tone={p.is_us_person ? 'blue' : 'slate'}>{p.is_us_person ? 'US' : 'Foreign'}</Badge>
                </TD>
                <TD className="text-right tabular-nums">{fmtUsd(p.expected_annual_spend_cents)}</TD>
                <TD>
                  <Badge tone={READINESS_TONE[p.readiness_state] ?? 'slate'}>
                    {READINESS_LABEL[p.readiness_state] ?? p.readiness_state}
                  </Badge>
                </TD>
                <TD className="capitalize text-slate-400">{p.compliance_status}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link
                      href={`/dashboard/payees/${p.id}`}
                      className="rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => setDeleting(p)}
                      className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="Add payee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-payee-form" disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : 'Create payee'}
            </Button>
          </>
        }
      >
        <form id="create-payee-form" onSubmit={handleCreate} className="space-y-4">
          {formErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formErr}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Vendor name *</label>
            <input
              value={form.vendor_name}
              onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
              className={inputCls}
              placeholder="Acme Studio LLC"
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Legal name</label>
              <input
                value={form.legal_name}
                onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Contact email</label>
              <input
                type="email"
                value={form.contact_email}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                className={inputCls}
                placeholder="ap@vendor.com"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                className={inputCls}
                placeholder="US"
                maxLength={2}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Vendor type</label>
              <select
                value={form.vendor_type}
                onChange={(e) => setForm({ ...form, vendor_type: e.target.value })}
                className={inputCls}
              >
                {VENDOR_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Expected annual spend (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.expected_annual_spend}
                onChange={(e) => setForm({ ...form, expected_annual_spend: e.target.value })}
                className={inputCls}
                placeholder="0"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">External ref</label>
              <input
                value={form.external_ref}
                onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
                className={inputCls}
                placeholder="ERP vendor id"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_us_person}
              onChange={(e) => setForm({ ...form, is_us_person: e.target.checked })}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
            />
            US person (W-9 expected; uncheck for foreign payees on the W-8 series)
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={`${inputCls} min-h-[72px]`}
              rows={3}
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => !deletingBusy && setDeleting(null)}
        title="Delete payee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deletingBusy}>
              {deletingBusy ? <Spinner label="Deleting..." /> : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{deleting?.vendor_name}</span>? This removes the payee from
          your roster. Related forms and history may be affected.
        </p>
      </Modal>
    </div>
  )
}
