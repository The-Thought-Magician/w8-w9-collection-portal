'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Form = {
  id: string
  payee_id?: string
  form_type?: string
  status?: string
  signer_name?: string
  signer_capacity?: string
  signature_date?: string
  tin?: string
  tin_type?: string
  entity_classification?: string
  treaty_country?: string
  valid_through?: string
  version?: number
  submitted_via?: string
  created_at?: string
}

type Payee = { id: string; vendor_name?: string; legal_name?: string }

type Validation = {
  id: string
  form_id?: string
  verdict?: string
  error_count?: number
  warning_count?: number
  summary?: string
}

type Recommendation = { recommended_form?: string; rationale?: string }

const FORM_TYPES = ['W-9', 'W-8BEN', 'W-8BEN-E', 'W-8ECI', 'W-8EXP', 'W-8IMY']
const TIN_TYPES = ['EIN', 'SSN', 'ITIN', 'Foreign']

function dateStr(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function statusTone(status?: string): BadgeTone {
  switch ((status || '').toLowerCase()) {
    case 'valid':
    case 'accepted':
    case 'active':
      return 'green'
    case 'pending':
    case 'review':
      return 'yellow'
    case 'rejected':
    case 'invalid':
    case 'expired':
      return 'red'
    default:
      return 'slate'
  }
}

function verdictTone(v?: string): BadgeTone {
  switch ((v || '').toLowerCase()) {
    case 'pass':
      return 'green'
    case 'fail':
      return 'red'
    case 'warn':
    case 'warning':
      return 'yellow'
    default:
      return 'slate'
  }
}

export default function FormsPage() {
  const [forms, setForms] = useState<Form[]>([])
  const [payees, setPayees] = useState<Payee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // validation state per form
  const [validating, setValidating] = useState<Record<string, boolean>>({})
  const [validationResult, setValidationResult] = useState<Record<string, Validation>>({})

  // manual submit modal
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Form>>({ form_type: 'W-9', submitted_via: 'manual' })

  // recommend (triage) modal
  const [recommendOpen, setRecommendOpen] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [recErr, setRecErr] = useState<string | null>(null)
  const [recAnswers, setRecAnswers] = useState({ is_us_person: false, is_individual: true, has_treaty: false, income_type: 'services' })
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [formsRes, payeesRes] = await Promise.all([api.listForms(), api.listPayees()])
      setForms(Array.isArray(formsRes) ? formsRes : formsRes?.forms ?? [])
      setPayees(Array.isArray(payeesRes) ? payeesRes : payeesRes?.payees ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load forms')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const payeeName = useCallback(
    (id?: string) => {
      if (!id) return '—'
      const p = payees.find((x) => x.id === id)
      return p?.vendor_name || p?.legal_name || id.slice(0, 8)
    },
    [payees]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return forms.filter((f) => {
      if (typeFilter && f.form_type !== typeFilter) return false
      if (statusFilter && (f.status || '').toLowerCase() !== statusFilter.toLowerCase()) return false
      if (q) {
        const hay = `${f.form_type || ''} ${f.signer_name || ''} ${payeeName(f.payee_id)} ${f.treaty_country || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [forms, search, typeFilter, statusFilter, payeeName])

  const stats = useMemo(() => {
    const total = forms.length
    const valid = forms.filter((f) => (f.status || '').toLowerCase() === 'valid').length
    const w8 = forms.filter((f) => (f.form_type || '').startsWith('W-8')).length
    const w9 = forms.filter((f) => f.form_type === 'W-9').length
    return { total, valid, w8, w9 }
  }, [forms])

  async function runValidate(id: string) {
    setValidating((s) => ({ ...s, [id]: true }))
    try {
      const res = await api.validateForm(id)
      const v: Validation = res?.validation ?? res
      setValidationResult((s) => ({ ...s, [id]: v }))
    } catch (e) {
      setValidationResult((s) => ({ ...s, [id]: { id, verdict: 'error', summary: e instanceof Error ? e.message : 'Validation failed' } }))
    } finally {
      setValidating((s) => ({ ...s, [id]: false }))
    }
  }

  function openSubmit() {
    setSubmitErr(null)
    setDraft({ form_type: 'W-9', submitted_via: 'manual', payee_id: payees[0]?.id })
    setSubmitOpen(true)
  }

  async function doSubmit() {
    if (!draft.payee_id) {
      setSubmitErr('Select a payee')
      return
    }
    setSubmitting(true)
    setSubmitErr(null)
    try {
      const body = {
        payee_id: draft.payee_id,
        form_type: draft.form_type,
        signer_name: draft.signer_name,
        signer_capacity: draft.signer_capacity,
        signature_date: draft.signature_date || undefined,
        tin: draft.tin,
        tin_type: draft.tin_type,
        entity_classification: draft.entity_classification,
        treaty_country: draft.treaty_country,
        submitted_via: 'manual',
      }
      await api.submitForm(body)
      setSubmitOpen(false)
      await load()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed to submit form')
    } finally {
      setSubmitting(false)
    }
  }

  async function doRecommend() {
    setRecommending(true)
    setRecErr(null)
    setRecommendation(null)
    try {
      const res = await api.recommendForm(recAnswers)
      setRecommendation(res ?? null)
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Failed to recommend')
    } finally {
      setRecommending(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading forms..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Forms</h1>
          <p className="mt-1 text-sm text-slate-400">Every W-8 and W-9 submitted across your vendor book.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setRecommendation(null); setRecErr(null); setRecommendOpen(true) }}>
            Recommend form (triage)
          </Button>
          <Button onClick={openSubmit} disabled={payees.length === 0}>
            Submit form manually
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button variant="secondary" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total forms" value={stats.total} />
        <Stat label="Valid" value={stats.valid} tone="green" />
        <Stat label="W-8 series" value={stats.w8} />
        <Stat label="W-9" value={stats.w9} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <input
              placeholder="Search by payee, signer, type, country..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 lg:max-w-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value="">All types</option>
                {FORM_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value="">All statuses</option>
                <option value="valid">Valid</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>
              {(search || typeFilter || statusFilter) && (
                <Button variant="ghost" onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter('') }}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {forms.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No forms yet"
                description={payees.length === 0 ? 'Add a payee first, then submit a form.' : 'Submit a form manually or collect one via a request link.'}
                action={payees.length > 0 ? <Button onClick={openSubmit}>Submit form manually</Button> : <Link href="/dashboard/payees"><Button>Go to payees</Button></Link>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No matching forms" description="Adjust your filters or search." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Payee</TH>
                  <TH>Form</TH>
                  <TH>Status</TH>
                  <TH>Signer</TH>
                  <TH>Valid through</TH>
                  <TH>Via</TH>
                  <TH>Validation</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((f) => {
                  const vr = validationResult[f.id]
                  return (
                    <TR key={f.id}>
                      <TD className="font-medium text-white">
                        {f.payee_id ? (
                          <Link href={`/dashboard/payees/${f.payee_id}`} className="hover:text-emerald-400">
                            {payeeName(f.payee_id)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD>{f.form_type || '—'}</TD>
                      <TD>
                        <Badge tone={statusTone(f.status)}>{f.status || 'unknown'}</Badge>
                      </TD>
                      <TD>{f.signer_name || '—'}</TD>
                      <TD>{dateStr(f.valid_through)}</TD>
                      <TD>{f.submitted_via || '—'}</TD>
                      <TD>
                        {vr ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge tone={verdictTone(vr.verdict)}>{vr.verdict || 'done'}</Badge>
                            {(vr.error_count ?? 0) > 0 && <span className="text-xs text-red-400">{vr.error_count}e</span>}
                            {(vr.warning_count ?? 0) > 0 && <span className="text-xs text-amber-400">{vr.warning_count}w</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">not run</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => runValidate(f.id)}
                            disabled={!!validating[f.id]}
                            className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                          >
                            {validating[f.id] ? <Spinner /> : 'Validate'}
                          </button>
                          <Link href={`/dashboard/forms/${f.id}`} className="text-slate-400 hover:text-white">
                            View
                          </Link>
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

      {/* Manual submit modal */}
      <Modal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit form manually"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubmitOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={doSubmit} disabled={submitting}>
              {submitting ? <Spinner /> : 'Submit'}
            </Button>
          </>
        }
      >
        {submitErr && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{submitErr}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Payee" value={draft.payee_id || ''} onChange={(v) => setDraft((s) => ({ ...s, payee_id: v }))}>
            <option value="">Select payee...</option>
            {payees.map((p) => (
              <option key={p.id} value={p.id}>{p.vendor_name || p.legal_name || p.id.slice(0, 8)}</option>
            ))}
          </Select>
          <Select label="Form type" value={draft.form_type || 'W-9'} onChange={(v) => setDraft((s) => ({ ...s, form_type: v }))}>
            {FORM_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Input label="Signer name" value={draft.signer_name || ''} onChange={(v) => setDraft((s) => ({ ...s, signer_name: v }))} />
          <Input label="Signer capacity" value={draft.signer_capacity || ''} onChange={(v) => setDraft((s) => ({ ...s, signer_capacity: v }))} />
          <Input label="Signature date" type="date" value={draft.signature_date || ''} onChange={(v) => setDraft((s) => ({ ...s, signature_date: v }))} />
          <Input label="TIN" value={draft.tin || ''} onChange={(v) => setDraft((s) => ({ ...s, tin: v }))} />
          <Select label="TIN type" value={draft.tin_type || ''} onChange={(v) => setDraft((s) => ({ ...s, tin_type: v }))}>
            <option value="">—</option>
            {TIN_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Input label="Entity classification" value={draft.entity_classification || ''} onChange={(v) => setDraft((s) => ({ ...s, entity_classification: v }))} />
          <Input label="Treaty country" value={draft.treaty_country || ''} onChange={(v) => setDraft((s) => ({ ...s, treaty_country: v }))} />
        </div>
      </Modal>

      {/* Recommend / triage modal */}
      <Modal
        open={recommendOpen}
        onClose={() => setRecommendOpen(false)}
        title="Recommend a form"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecommendOpen(false)}>
              Close
            </Button>
            <Button onClick={doRecommend} disabled={recommending}>
              {recommending ? <Spinner /> : 'Recommend'}
            </Button>
          </>
        }
      >
        {recErr && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{recErr}</div>}
        <p className="mb-4 text-sm text-slate-400">Answer a few questions and the engine will recommend the correct W-8 or W-9.</p>
        <div className="space-y-3">
          <Toggle label="US person (citizen / US entity)" checked={recAnswers.is_us_person} onChange={(v) => setRecAnswers((s) => ({ ...s, is_us_person: v }))} />
          <Toggle label="Individual (not an entity)" checked={recAnswers.is_individual} onChange={(v) => setRecAnswers((s) => ({ ...s, is_individual: v }))} />
          <Toggle label="Claiming a tax treaty benefit" checked={recAnswers.has_treaty} onChange={(v) => setRecAnswers((s) => ({ ...s, has_treaty: v }))} />
          <Select label="Income type" value={recAnswers.income_type} onChange={(v) => setRecAnswers((s) => ({ ...s, income_type: v }))}>
            <option value="services">Services</option>
            <option value="royalties">Royalties</option>
            <option value="interest">Interest</option>
            <option value="effectively_connected">Effectively connected (US trade/business)</option>
          </Select>
        </div>
        {recommendation && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-emerald-300">Recommended</span>
              <Badge tone="green">{recommendation.recommended_form || '—'}</Badge>
            </div>
            {recommendation.rationale && <p className="mt-2 text-sm text-slate-300">{recommendation.rationale}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
      />
    </div>
  )
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
      >
        {children}
      </select>
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/60"
      />
      {label}
    </label>
  )
}
