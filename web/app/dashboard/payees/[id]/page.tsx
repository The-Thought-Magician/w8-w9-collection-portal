'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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

type Payee = {
  id: string
  vendor_name?: string
  legal_name?: string
  contact_email?: string
  country?: string
  is_us_person?: boolean
  vendor_type?: string
  expected_annual_spend_cents?: number
  external_ref?: string
  notes?: string
  readiness_state?: string
  compliance_status?: string
  created_at?: string
  updated_at?: string
}

type Form = {
  id: string
  payee_id?: string
  form_type?: string
  status?: string
  signer_name?: string
  tin_type?: string
  treaty_country?: string
  valid_through?: string
  version?: number
  submitted_via?: string
  created_at?: string
}

type Readiness = {
  state?: string
  reason?: string
  blocked_amount_cents?: number
  is_payment_blocked?: boolean
  computed_at?: string
}

type Version = {
  id: string
  version?: number
  form_type?: string
  verdict?: string
  superseded_by?: string | null
  submitted_by?: string
  created_at?: string
}

type Withholding = {
  id: string
  payee_id?: string
  income_type?: string
  base_rate?: number
  applied_rate?: number
  treaty_applied?: boolean
  estimated_withholding_cents?: number
  rationale?: string
  created_at?: string
}

type Bnotice = {
  id: string
  payee_id?: string
  notice_kind?: string
  received_date?: string
  status?: string
  note?: string
  created_at?: string
}

type Eligibility = { allowed?: boolean; reasons?: string[] }

function cents(v?: number | null): string {
  if (v == null) return '$0.00'
  return (v / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function pct(v?: number | null): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function dateStr(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function readinessTone(state?: string): BadgeTone {
  switch ((state || '').toLowerCase()) {
    case 'ready':
      return 'green'
    case 'expiring':
    case 'expiring_soon':
    case 'pending':
      return 'yellow'
    case 'blocked':
    case 'expired':
    case 'missing':
      return 'red'
    default:
      return 'slate'
  }
}

function formStatusTone(status?: string): BadgeTone {
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

const TABS = ['forms', 'readiness', 'versions', 'withholding', 'bnotices'] as const
type Tab = (typeof TABS)[number]

export default function PayeeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [payee, setPayee] = useState<Payee | null>(null)
  const [forms, setForms] = useState<Form[]>([])
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [withholding, setWithholding] = useState<Withholding[]>([])
  const [bnotices, setBnotices] = useState<Bnotice[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('forms')

  // edit
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Payee>>({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // eligibility
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const payeeRes = await api.getPayee(id)
      const p: Payee = payeeRes?.payee ?? payeeRes
      setPayee(p)

      const [formsRes, readinessRes, versionsRes, withholdingRes, bnoticesRes] = await Promise.allSettled([
        api.listForms({ payee_id: id }),
        api.getPayeeReadiness(id),
        api.getPayeeVersions(id),
        api.listWithholding(),
        api.listBnotices(),
      ])

      if (formsRes.status === 'fulfilled') {
        const v = formsRes.value
        setForms(Array.isArray(v) ? v : v?.forms ?? [])
      }
      if (readinessRes.status === 'fulfilled') {
        const v = readinessRes.value
        setReadiness(v?.readiness ?? v ?? null)
      }
      if (versionsRes.status === 'fulfilled') {
        const v = versionsRes.value
        setVersions(Array.isArray(v) ? v : v?.versions ?? [])
      }
      if (withholdingRes.status === 'fulfilled') {
        const v = withholdingRes.value
        const all: Withholding[] = Array.isArray(v) ? v : v?.determinations ?? []
        setWithholding(all.filter((w) => !w.payee_id || w.payee_id === id))
      }
      if (bnoticesRes.status === 'fulfilled') {
        const v = bnoticesRes.value
        const all: Bnotice[] = Array.isArray(v) ? v : v?.notices ?? []
        setBnotices(all.filter((b) => !b.payee_id || b.payee_id === id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payee')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  function openEdit() {
    if (!payee) return
    setSaveErr(null)
    setEditForm({
      vendor_name: payee.vendor_name,
      legal_name: payee.legal_name,
      contact_email: payee.contact_email,
      country: payee.country,
      is_us_person: payee.is_us_person,
      vendor_type: payee.vendor_type,
      expected_annual_spend_cents: payee.expected_annual_spend_cents,
      external_ref: payee.external_ref,
      notes: payee.notes,
    })
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!id) return
    setSaving(true)
    setSaveErr(null)
    try {
      const res = await api.updatePayee(id, editForm)
      const updated: Payee = res?.payee ?? res
      setPayee((prev) => ({ ...(prev ?? {}), ...updated }))
      setEditOpen(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function runEligibility() {
    if (!id) return
    setChecking(true)
    setEligibility(null)
    try {
      const res = await api.checkPaymentEligibility({ payee_id: id })
      setEligibility(res ?? null)
    } catch (e) {
      setEligibility({ allowed: false, reasons: [e instanceof Error ? e.message : 'Check failed'] })
    } finally {
      setChecking(false)
    }
  }

  const exposureCents = useMemo(
    () => withholding.reduce((acc, w) => acc + (w.estimated_withholding_cents || 0), 0),
    [withholding]
  )

  if (loading) return <FullPageSpinner label="Loading payee..." />

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState
          title="Could not load payee"
          description={error}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push('/dashboard/payees')}>
                Back to roster
              </Button>
              <Button onClick={load}>Retry</Button>
            </div>
          }
        />
      </div>
    )
  }

  if (!payee) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState title="Payee not found" action={<Link href="/dashboard/payees"><Button variant="secondary">Back to roster</Button></Link>} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/payees" className="text-xs text-slate-500 hover:text-emerald-400">
            ← Payees
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold text-white">{payee.vendor_name || payee.legal_name || 'Unnamed payee'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            {payee.legal_name && payee.legal_name !== payee.vendor_name && <span>{payee.legal_name}</span>}
            {payee.country && <Badge tone="slate">{payee.country}</Badge>}
            <Badge tone={payee.is_us_person ? 'blue' : 'slate'}>{payee.is_us_person ? 'US person' : 'Non-US'}</Badge>
            {payee.vendor_type && <Badge tone="slate">{payee.vendor_type}</Badge>}
            <Badge tone={readinessTone(payee.readiness_state)}>{payee.readiness_state || 'unknown'}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={openEdit}>
            Edit payee
          </Button>
          <Button onClick={runEligibility} disabled={checking}>
            {checking ? <Spinner /> : 'Check payment eligibility'}
          </Button>
        </div>
      </div>

      {/* Eligibility banner */}
      {eligibility && (
        <Card className={eligibility.allowed ? 'border-emerald-500/40' : 'border-red-500/40'}>
          <CardBody>
            <div className="flex items-start gap-3">
              <Badge tone={eligibility.allowed ? 'green' : 'red'}>{eligibility.allowed ? 'Payment allowed' : 'Payment blocked'}</Badge>
              <div className="text-sm text-slate-300">
                {eligibility.reasons && eligibility.reasons.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1">
                    {eligibility.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : eligibility.allowed ? (
                  'No blocking conditions found. This payee is eligible to be paid.'
                ) : (
                  'Payment is blocked.'
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Forms on file" value={forms.length} hint={`${forms.filter((f) => (f.status || '').toLowerCase() === 'valid').length} valid`} />
        <Stat
          label="Readiness"
          value={(readiness?.state || payee.readiness_state || 'unknown').toString()}
          tone={readinessTone(readiness?.state || payee.readiness_state) === 'green' ? 'green' : readinessTone(readiness?.state) === 'red' ? 'red' : 'default'}
          hint={readiness?.is_payment_blocked ? 'Payments blocked' : 'Not blocked'}
        />
        <Stat label="Expected annual spend" value={cents(payee.expected_annual_spend_cents)} />
        <Stat label="Est. withholding exposure" value={cents(exposureCents)} tone={exposureCents > 0 ? 'yellow' : 'default'} hint={`${bnotices.length} B-notice(s)`} />
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Vendor profile</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Contact email" value={payee.contact_email || '—'} />
            <Field label="Country" value={payee.country || '—'} />
            <Field label="Vendor type" value={payee.vendor_type || '—'} />
            <Field label="US person" value={payee.is_us_person ? 'Yes' : 'No'} />
            <Field label="External ref" value={payee.external_ref || '—'} />
            <Field label="Compliance status" value={payee.compliance_status || '—'} />
            <Field label="Created" value={dateStr(payee.created_at)} />
            <Field label="Updated" value={dateStr(payee.updated_at)} />
          </dl>
          {payee.notes && (
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Notes</div>
              {payee.notes}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'bnotices' ? 'B-Notices' : t}
            {t === 'forms' && forms.length > 0 ? ` (${forms.length})` : ''}
            {t === 'versions' && versions.length > 0 ? ` (${versions.length})` : ''}
            {t === 'withholding' && withholding.length > 0 ? ` (${withholding.length})` : ''}
            {t === 'bnotices' && bnotices.length > 0 ? ` (${bnotices.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'forms' && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Forms</h2>
          </CardHeader>
          <CardBody className="p-0">
            {forms.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No forms on file" description="This payee has not submitted a W-8 or W-9 form yet." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Form</TH>
                    <TH>Status</TH>
                    <TH>Signer</TH>
                    <TH>Valid through</TH>
                    <TH>Version</TH>
                    <TH>Submitted via</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {forms.map((f) => (
                    <TR key={f.id}>
                      <TD className="font-medium text-white">{f.form_type || '—'}</TD>
                      <TD>
                        <Badge tone={formStatusTone(f.status)}>{f.status || 'unknown'}</Badge>
                      </TD>
                      <TD>{f.signer_name || '—'}</TD>
                      <TD>{dateStr(f.valid_through)}</TD>
                      <TD className="tabular-nums">v{f.version ?? 1}</TD>
                      <TD>{f.submitted_via || '—'}</TD>
                      <TD>
                        <Link href={`/dashboard/forms/${f.id}`} className="text-emerald-400 hover:text-emerald-300">
                          View
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'readiness' && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Readiness state</h2>
          </CardHeader>
          <CardBody>
            {!readiness ? (
              <EmptyState title="No readiness record" description="Run a readiness recompute from the Readiness Ledger to populate this." />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={readinessTone(readiness.state)}>{readiness.state || 'unknown'}</Badge>
                  {readiness.is_payment_blocked ? (
                    <Badge tone="red">Payments blocked</Badge>
                  ) : (
                    <Badge tone="green">Payments allowed</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Field label="Reason" value={readiness.reason || '—'} />
                  <Field label="Blocked amount" value={cents(readiness.blocked_amount_cents)} />
                  <Field label="Computed at" value={dateStr(readiness.computed_at)} />
                </dl>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'versions' && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Version history</h2>
          </CardHeader>
          <CardBody className="p-0">
            {versions.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No version history" description="Immutable document versions appear here as forms are submitted." />
              </div>
            ) : (
              <ol className="relative space-y-0">
                {versions.map((v, i) => (
                  <li key={v.id} className="flex gap-4 px-5 py-4">
                    <div className="flex flex-col items-center">
                      <span className={`h-3 w-3 rounded-full ${v.superseded_by ? 'bg-slate-600' : 'bg-emerald-500'}`} />
                      {i < versions.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-800" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">v{v.version ?? i + 1}</span>
                        {v.form_type && <Badge tone="slate">{v.form_type}</Badge>}
                        {v.verdict && <Badge tone={v.verdict === 'pass' ? 'green' : v.verdict === 'fail' ? 'red' : 'yellow'}>{v.verdict}</Badge>}
                        {v.superseded_by ? <Badge tone="slate">superseded</Badge> : <Badge tone="green">current</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {dateStr(v.created_at)}
                        {v.submitted_by ? ` · by ${v.submitted_by}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'withholding' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Withholding determinations</h2>
              <span className="text-xs text-slate-500">Total exposure {cents(exposureCents)}</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {withholding.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No determinations" description="Withholding determinations for this payee will appear here." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Income type</TH>
                    <TH>Base rate</TH>
                    <TH>Applied rate</TH>
                    <TH>Treaty</TH>
                    <TH>Est. withholding</TH>
                    <TH>Date</TH>
                  </TR>
                </THead>
                <TBody>
                  {withholding.map((w) => (
                    <TR key={w.id}>
                      <TD className="font-medium text-white">{w.income_type || '—'}</TD>
                      <TD className="tabular-nums">{pct(w.base_rate)}</TD>
                      <TD className="tabular-nums">{pct(w.applied_rate)}</TD>
                      <TD>{w.treaty_applied ? <Badge tone="green">applied</Badge> : <Badge tone="slate">none</Badge>}</TD>
                      <TD className="tabular-nums">{cents(w.estimated_withholding_cents)}</TD>
                      <TD>{dateStr(w.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'bnotices' && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">B-Notices</h2>
          </CardHeader>
          <CardBody className="p-0">
            {bnotices.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No B-Notices" description="CP2100 / backup-withholding notices for this payee appear here." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Kind</TH>
                    <TH>Received</TH>
                    <TH>Status</TH>
                    <TH>Note</TH>
                  </TR>
                </THead>
                <TBody>
                  {bnotices.map((b) => (
                    <TR key={b.id}>
                      <TD className="font-medium text-white">{b.notice_kind || '—'}</TD>
                      <TD>{dateStr(b.received_date)}</TD>
                      <TD>
                        <Badge tone={(b.status || '').toLowerCase() === 'resolved' ? 'green' : (b.status || '').toLowerCase() === 'open' ? 'red' : 'yellow'}>
                          {b.status || 'open'}
                        </Badge>
                      </TD>
                      <TD className="max-w-md truncate">{b.note || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit payee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Spinner /> : 'Save changes'}
            </Button>
          </>
        }
      >
        {saveErr && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{saveErr}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Vendor name" value={editForm.vendor_name || ''} onChange={(v) => setEditForm((s) => ({ ...s, vendor_name: v }))} />
          <Input label="Legal name" value={editForm.legal_name || ''} onChange={(v) => setEditForm((s) => ({ ...s, legal_name: v }))} />
          <Input label="Contact email" type="email" value={editForm.contact_email || ''} onChange={(v) => setEditForm((s) => ({ ...s, contact_email: v }))} />
          <Input label="Country" value={editForm.country || ''} onChange={(v) => setEditForm((s) => ({ ...s, country: v }))} />
          <Input label="Vendor type" value={editForm.vendor_type || ''} onChange={(v) => setEditForm((s) => ({ ...s, vendor_type: v }))} />
          <Input label="External ref" value={editForm.external_ref || ''} onChange={(v) => setEditForm((s) => ({ ...s, external_ref: v }))} />
          <Input
            label="Expected annual spend (USD)"
            type="number"
            value={editForm.expected_annual_spend_cents != null ? String(editForm.expected_annual_spend_cents / 100) : ''}
            onChange={(v) => setEditForm((s) => ({ ...s, expected_annual_spend_cents: v === '' ? undefined : Math.round(Number(v) * 100) }))}
          />
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={!!editForm.is_us_person}
                onChange={(e) => setEditForm((s) => ({ ...s, is_us_person: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500/60"
              />
              US person
            </label>
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Notes</label>
          <textarea
            value={editForm.notes || ''}
            onChange={(e) => setEditForm((s) => ({ ...s, notes: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
          />
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
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
