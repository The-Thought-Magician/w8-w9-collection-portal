'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface OrgSettings {
  id?: string
  user_id?: string
  org_name?: string
  expiring_soon_days?: number
  default_withholding_rate?: number
  backup_withholding_rate?: number
  tax_year?: number
  created_at?: string
  updated_at?: string
}

interface Plan {
  id?: string
  name?: string
  price_cents?: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  current_period_end?: string | null
}

interface BillingPlan {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

interface SettingsForm {
  org_name: string
  tax_year: string
  expiring_soon_days: string
  default_withholding_rate: string
  backup_withholding_rate: string
}

function toForm(s: OrgSettings | null): SettingsForm {
  return {
    org_name: s?.org_name ?? '',
    tax_year: s?.tax_year != null ? String(s.tax_year) : '',
    expiring_soon_days: s?.expiring_soon_days != null ? String(s.expiring_soon_days) : '',
    // Rates stored as fractions (0.30) — surface as percentages for editing.
    default_withholding_rate: s?.default_withholding_rate != null ? String(round2(asPercent(s.default_withholding_rate))) : '',
    backup_withholding_rate: s?.backup_withholding_rate != null ? String(round2(asPercent(s.backup_withholding_rate))) : '',
  }
}

function asPercent(rate: number): number {
  // A rate <= 1 is a fraction; otherwise it is already a percentage.
  return rate <= 1 ? rate * 100 : rate
}

function fromPercent(pct: number): number {
  return pct / 100
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmtUsd(cents?: number): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'green',
  trialing: 'blue',
  past_due: 'yellow',
  canceled: 'red',
  incomplete: 'yellow',
  unpaid: 'red',
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40'

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [form, setForm] = useState<SettingsForm>(toForm(null))

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, b] = await Promise.all([api.getSettings(), api.getBillingPlan()])
      setSettings(s)
      setForm(toForm(s))
      setBilling(b)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function setField<K extends keyof SettingsForm>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaveMsg(null)
    setSaveErr(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    setSaveErr(null)
    try {
      const orgName = form.org_name.trim()
      if (!orgName) throw new Error('Organization name is required.')

      const body: Record<string, unknown> = { org_name: orgName }

      if (form.tax_year.trim() !== '') {
        const ty = Number(form.tax_year)
        if (!Number.isInteger(ty) || ty < 2000 || ty > 2100) throw new Error('Tax year must be a year between 2000 and 2100.')
        body.tax_year = ty
      }
      if (form.expiring_soon_days.trim() !== '') {
        const d = Number(form.expiring_soon_days)
        if (!Number.isInteger(d) || d < 1 || d > 3650) throw new Error('Expiring-soon window must be 1–3650 days.')
        body.expiring_soon_days = d
      }
      if (form.default_withholding_rate.trim() !== '') {
        const r = Number(form.default_withholding_rate)
        if (Number.isNaN(r) || r < 0 || r > 100) throw new Error('Default withholding rate must be 0–100%.')
        body.default_withholding_rate = round4(fromPercent(r))
      }
      if (form.backup_withholding_rate.trim() !== '') {
        const r = Number(form.backup_withholding_rate)
        if (Number.isNaN(r) || r < 0 || r > 100) throw new Error('Backup withholding rate must be 0–100%.')
        body.backup_withholding_rate = round4(fromPercent(r))
      }

      const updated = await api.updateSettings(body)
      setSettings(updated)
      setForm(toForm(updated))
      setSaveMsg('Settings saved.')
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckout() {
    setBillingBusy('checkout')
    setBillingMsg(null)
    try {
      const res = await api.startCheckout()
      const url = res && (res.url as string)
      if (url) {
        window.location.href = url
      } else {
        setBillingMsg('Checkout is not available right now.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Could not start checkout. Billing may not be configured.')
    } finally {
      setBillingBusy(null)
    }
  }

  async function handlePortal() {
    setBillingBusy('portal')
    setBillingMsg(null)
    try {
      const res = await api.openBillingPortal()
      const url = res && (res.url as string)
      if (url) {
        window.location.href = url
      } else {
        setBillingMsg('The billing portal is not available right now.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Could not open the billing portal. Billing may not be configured.')
    } finally {
      setBillingBusy(null)
    }
  }

  function resetForm() {
    setForm(toForm(settings))
    setSaveMsg(null)
    setSaveErr(null)
  }

  if (loading) return <FullPageSpinner label="Loading settings..." />

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          title="Could not load settings"
          description={error}
          icon={<span>⚠️</span>}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
      </div>
    )
  }

  const sub = billing?.subscription ?? null
  const plan = billing?.plan ?? null
  const stripeEnabled = billing?.stripeEnabled ?? false
  const planId = plan?.id ?? sub?.plan_id ?? 'free'
  const isPro = planId === 'pro'
  const status = sub?.status ?? (isPro ? 'active' : 'free')
  const statusTone = STATUS_TONE[status] ?? 'slate'

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(settings))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure your organization defaults and manage your subscription.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Organization" value={settings?.org_name || 'Unnamed org'} />
        <Stat label="Tax year" value={settings?.tax_year ?? '—'} tone="green" />
        <Stat
          label="Plan"
          value={isPro ? 'Pro' : 'Free'}
          tone={isPro ? 'green' : 'default'}
          hint={plan?.name ?? undefined}
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Organization settings</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Defaults applied to expiry tracking and withholding determinations.
            </p>
          </div>
          {dirty && <Badge tone="yellow">Unsaved changes</Badge>}
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Organization name">
                <input
                  className={inputCls}
                  value={form.org_name}
                  onChange={(e) => setField('org_name', e.target.value)}
                  placeholder="Acme Payments LLC"
                  maxLength={200}
                  required
                />
              </Field>
              <Field label="Tax year" hint="The reporting year for 1099 readiness.">
                <input
                  className={inputCls}
                  type="number"
                  inputMode="numeric"
                  value={form.tax_year}
                  onChange={(e) => setField('tax_year', e.target.value)}
                  placeholder="2026"
                  min={2000}
                  max={2100}
                  step={1}
                />
              </Field>
              <Field label="Expiring-soon window (days)" hint="Forms within this window are flagged for recertification.">
                <input
                  className={inputCls}
                  type="number"
                  inputMode="numeric"
                  value={form.expiring_soon_days}
                  onChange={(e) => setField('expiring_soon_days', e.target.value)}
                  placeholder="60"
                  min={1}
                  max={3650}
                  step={1}
                />
              </Field>
              <div className="grid grid-cols-2 gap-5">
                <Field label="Default withholding %" hint="Standard NRA rate.">
                  <input
                    className={inputCls}
                    type="number"
                    inputMode="decimal"
                    value={form.default_withholding_rate}
                    onChange={(e) => setField('default_withholding_rate', e.target.value)}
                    placeholder="30"
                    min={0}
                    max={100}
                    step={0.01}
                  />
                </Field>
                <Field label="Backup withholding %" hint="Applied when a TIN is missing or invalid.">
                  <input
                    className={inputCls}
                    type="number"
                    inputMode="decimal"
                    value={form.backup_withholding_rate}
                    onChange={(e) => setField('backup_withholding_rate', e.target.value)}
                    placeholder="24"
                    min={0}
                    max={100}
                    step={0.01}
                  />
                </Field>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? <Spinner label="Saving..." /> : 'Save changes'}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm} disabled={saving || !dirty}>
                Reset
              </Button>
              {saveMsg && <span className="text-sm text-emerald-400">{saveMsg}</span>}
              {saveErr && <span className="text-sm text-red-400">{saveErr}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Billing &amp; subscription</h2>
          <p className="mt-0.5 text-xs text-slate-500">Manage your plan and payment method.</p>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 px-5 py-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-white">{isPro ? 'Pro' : 'Free'} plan</span>
                <Badge tone={statusTone}>{status}</Badge>
              </div>
              <div className="text-sm text-slate-400">
                {plan?.price_cents != null
                  ? plan.price_cents > 0
                    ? `${fmtUsd(plan.price_cents)} / month`
                    : 'No charge'
                  : isPro
                    ? 'Active subscription'
                    : 'Free forever'}
              </div>
              {sub?.current_period_end && (
                <div className="text-xs text-slate-500">
                  {status === 'canceled' ? 'Access until' : 'Renews'} {fmtDate(sub.current_period_end)}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {isPro ? (
                  <Button onClick={handlePortal} disabled={billingBusy !== null} variant="secondary">
                    {billingBusy === 'portal' ? <Spinner label="Opening..." /> : 'Manage billing'}
                  </Button>
                ) : (
                  <Button onClick={handleCheckout} disabled={billingBusy !== null}>
                    {billingBusy === 'checkout' ? <Spinner label="Redirecting..." /> : 'Upgrade to Pro'}
                  </Button>
                )}
                {sub?.stripe_customer_id && !isPro && (
                  <Button onClick={handlePortal} disabled={billingBusy !== null} variant="ghost">
                    {billingBusy === 'portal' ? <Spinner /> : 'Billing portal'}
                  </Button>
                )}
              </div>
              {billingMsg && <span className="max-w-xs text-right text-xs text-amber-400">{billingMsg}</span>}
            </div>
          </div>

          {!stripeEnabled && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
              Stripe is not configured for this deployment, so checkout and the billing portal are unavailable. The free
              plan remains fully functional.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className={`rounded-xl border px-5 py-4 ${!isPro ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Free</span>
                {!isPro && <Badge tone="green">Current</Badge>}
              </div>
              <div className="mt-1 text-2xl font-bold text-white">$0<span className="text-sm font-normal text-slate-500">/mo</span></div>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-400">
                <li>Payee roster &amp; form collection</li>
                <li>Validation &amp; readiness ledger</li>
                <li>Expiry tracking &amp; campaigns</li>
              </ul>
            </div>
            <div className={`rounded-xl border px-5 py-4 ${isPro ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">Pro</span>
                {isPro && <Badge tone="green">Current</Badge>}
              </div>
              <div className="mt-1 text-2xl font-bold text-white">
                {plan?.price_cents != null && plan.price_cents > 0 && isPro ? fmtUsd(plan.price_cents) : '$—'}
                <span className="text-sm font-normal text-slate-500">/mo</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-400">
                <li>Everything in Free</li>
                <li>Unlimited bulk imports</li>
                <li>Priority validation &amp; TIN matching</li>
                <li>Advanced treaty &amp; withholding tooling</li>
              </ul>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
