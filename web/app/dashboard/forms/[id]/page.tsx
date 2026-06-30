'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
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
  chapter3_status?: string
  chapter4_status?: string
  treaty_country?: string
  data?: Record<string, unknown>
  valid_through?: string
  version?: number
  submitted_via?: string
  created_at?: string
}

type Field = { id: string; field_key?: string; field_value?: string }

type Check = { id?: string; check_key?: string; severity?: string; message?: string }

type Validation = {
  id?: string
  verdict?: string
  error_count?: number
  warning_count?: number
  summary?: string
  checks?: Check[]
  created_at?: string
}

type TinCheck = {
  id?: string
  tin_type?: string
  structural_valid?: boolean
  name_tin_match?: boolean
  message?: string
  created_at?: string
}

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
    case 'error':
      return 'red'
    case 'warn':
    case 'warning':
      return 'yellow'
    default:
      return 'slate'
  }
}

function severityTone(s?: string): BadgeTone {
  switch ((s || '').toLowerCase()) {
    case 'error':
    case 'critical':
      return 'red'
    case 'warning':
    case 'warn':
      return 'yellow'
    case 'info':
      return 'blue'
    default:
      return 'slate'
  }
}

function maskTin(tin?: string): string {
  if (!tin) return '—'
  const cleaned = tin.replace(/\s/g, '')
  if (cleaned.length <= 4) return cleaned
  return `${'•'.repeat(cleaned.length - 4)}${cleaned.slice(-4)}`
}

export default function FormDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [form, setForm] = useState<Form | null>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [validation, setValidation] = useState<Validation | null>(null)
  const [validating, setValidating] = useState(false)

  const [tinResult, setTinResult] = useState<TinCheck | null>(null)
  const [tinChecking, setTinChecking] = useState(false)
  const [tinErr, setTinErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getForm(id)
      const f: Form = res?.form ?? res
      setForm(f)
      setFields(res?.fields ?? res?.form?.fields ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load form')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function runValidate() {
    if (!id) return
    setValidating(true)
    try {
      const res = await api.validateForm(id)
      const v: Validation = res?.validation ?? res
      // checks may live on res.checks
      if (res?.checks && !v.checks) v.checks = res.checks
      setValidation(v)
      // refresh form status which validation may have changed
      load()
    } catch (e) {
      setValidation({ verdict: 'error', summary: e instanceof Error ? e.message : 'Validation failed', checks: [] })
    } finally {
      setValidating(false)
    }
  }

  async function runTin() {
    if (!id) return
    setTinChecking(true)
    setTinErr(null)
    try {
      const res = await api.checkTin({ form_id: id })
      setTinResult(res?.tin_check ?? res ?? null)
    } catch (e) {
      setTinErr(e instanceof Error ? e.message : 'TIN check failed')
    } finally {
      setTinChecking(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading form..." />

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState
          title="Could not load form"
          description={error}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => router.push('/dashboard/forms')}>Back to forms</Button>
              <Button onClick={load}>Retry</Button>
            </div>
          }
        />
      </div>
    )
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <EmptyState title="Form not found" action={<Link href="/dashboard/forms"><Button variant="secondary">Back to forms</Button></Link>} />
      </div>
    )
  }

  const checks = validation?.checks ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/forms" className="text-xs text-slate-500 hover:text-emerald-400">
            ← Forms
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-white">
            {form.form_type || 'Form'}
            <Badge tone={statusTone(form.status)}>{form.status || 'unknown'}</Badge>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span>Version {form.version ?? 1}</span>
            {form.submitted_via && <Badge tone="slate">via {form.submitted_via}</Badge>}
            {form.payee_id && (
              <Link href={`/dashboard/payees/${form.payee_id}`} className="text-emerald-400 hover:text-emerald-300">
                View payee →
              </Link>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={runTin} disabled={tinChecking}>
            {tinChecking ? <Spinner /> : 'Run TIN check'}
          </Button>
          <Button onClick={runValidate} disabled={validating}>
            {validating ? <Spinner /> : 'Run validation'}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Signer" value={form.signer_name || '—'} hint={form.signer_capacity || undefined} />
        <Stat label="TIN type" value={form.tin_type || '—'} hint={form.tin ? maskTin(form.tin) : undefined} />
        <Stat label="Valid through" value={dateStr(form.valid_through)} />
        <Stat label="Treaty country" value={form.treaty_country || '—'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Form details */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Form details</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label="Form type" value={form.form_type || '—'} />
              <Field label="Status" value={<Badge tone={statusTone(form.status)}>{form.status || 'unknown'}</Badge>} />
              <Field label="Signer name" value={form.signer_name || '—'} />
              <Field label="Signer capacity" value={form.signer_capacity || '—'} />
              <Field label="Signature date" value={dateStr(form.signature_date)} />
              <Field label="TIN" value={maskTin(form.tin)} />
              <Field label="TIN type" value={form.tin_type || '—'} />
              <Field label="Entity classification" value={form.entity_classification || '—'} />
              <Field label="Chapter 3 status" value={form.chapter3_status || '—'} />
              <Field label="Chapter 4 status" value={form.chapter4_status || '—'} />
              <Field label="Treaty country" value={form.treaty_country || '—'} />
              <Field label="Submitted" value={dateStr(form.created_at)} />
            </dl>
          </CardBody>
        </Card>

        {/* Raw fields */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Captured fields</h2>
          </CardHeader>
          <CardBody className="p-0">
            {fields.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No captured fields" description="Field-level data captured during collection appears here." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Key</TH>
                    <TH>Value</TH>
                  </TR>
                </THead>
                <TBody>
                  {fields.map((fl) => (
                    <TR key={fl.id}>
                      <TD className="font-mono text-xs text-slate-400">{fl.field_key}</TD>
                      <TD className="text-slate-200">{fl.field_value || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* TIN check result */}
      {(tinResult || tinErr) && (
        <Card className={tinResult && tinResult.structural_valid && tinResult.name_tin_match !== false ? 'border-emerald-500/30' : 'border-amber-500/30'}>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">TIN check</h2>
          </CardHeader>
          <CardBody>
            {tinErr ? (
              <p className="text-sm text-red-300">{tinErr}</p>
            ) : tinResult ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={tinResult.structural_valid ? 'green' : 'red'}>
                    {tinResult.structural_valid ? 'Structurally valid' : 'Structurally invalid'}
                  </Badge>
                  <Badge tone={tinResult.name_tin_match ? 'green' : 'yellow'}>
                    {tinResult.name_tin_match ? 'Name/TIN match' : 'Name/TIN mismatch'}
                  </Badge>
                  {tinResult.tin_type && <Badge tone="slate">{tinResult.tin_type}</Badge>}
                </div>
                {tinResult.message && <p className="text-sm text-slate-300">{tinResult.message}</p>}
              </div>
            ) : null}
          </CardBody>
        </Card>
      )}

      {/* Validation report */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Validation report</h2>
            {validation && (
              <div className="flex items-center gap-2">
                <Badge tone={verdictTone(validation.verdict)}>{validation.verdict || 'done'}</Badge>
                {(validation.error_count ?? 0) > 0 && <span className="text-xs text-red-400">{validation.error_count} errors</span>}
                {(validation.warning_count ?? 0) > 0 && <span className="text-xs text-amber-400">{validation.warning_count} warnings</span>}
              </div>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {!validation ? (
            <div className="p-5">
              <EmptyState
                title="No validation run yet"
                description="Run the validation engine to check this form against IRS rules."
                action={<Button onClick={runValidate} disabled={validating}>{validating ? <Spinner /> : 'Run validation'}</Button>}
              />
            </div>
          ) : (
            <div>
              {validation.summary && (
                <p className="border-b border-slate-800 px-5 py-3 text-sm text-slate-300">{validation.summary}</p>
              )}
              {checks.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-slate-500">
                  No individual checks reported{validation.verdict === 'pass' ? ' — form passed all rules.' : '.'}
                </div>
              ) : (
                <ul className="divide-y divide-slate-800">
                  {checks.map((c, i) => (
                    <li key={c.id || i} className="flex items-start gap-3 px-5 py-3">
                      <Badge tone={severityTone(c.severity)}>{c.severity || 'info'}</Badge>
                      <div className="min-w-0">
                        <div className="text-sm text-slate-200">{c.message || c.check_key}</div>
                        {c.check_key && c.message && <div className="mt-0.5 font-mono text-xs text-slate-500">{c.check_key}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardBody>
      </Card>
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
