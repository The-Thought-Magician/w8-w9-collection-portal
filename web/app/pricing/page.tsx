'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Self-serve payee portal with guided form selection',
  'Field-level validation engine (TIN, classification, chapter 3/4, treaty lines)',
  'Form expiry & three-year recertification clock',
  'Recertification campaigns with reminders',
  'Payment-block gate & readiness ledger',
  'Payee roster CRUD + bulk import',
  'Immutable document version history',
  'Treaty, withholding & B-notice management',
  '1099 readiness reports & analytics',
  'One-click sample roster seeder',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const plan = await api.getBillingPlan()
        if (!cancelled) setStripeEnabled(Boolean(plan?.stripeEnabled))
      } catch {
        if (!cancelled) setStripeEnabled(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">W8</span>
          <span className="text-lg font-bold tracking-tight">W8W9CollectionPortal</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, free pricing</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
          Every feature of W8W9CollectionPortal is free while signed in. No seats, no metering, no per-form charge.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Free</h2>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Current plan
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-black">$0</span>
              <span className="text-slate-500">/ forever</span>
            </div>
            <ul className="mt-6 space-y-3">
              {freeFeatures.map((f) => (
                <li key={f} className="flex gap-3 text-sm text-slate-300">
                  <span className="mt-0.5 text-emerald-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link href="/auth/sign-up" className="mt-8 block rounded-lg bg-emerald-600 px-6 py-3 text-center text-base font-semibold text-white hover:bg-emerald-500">
              Start free
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-300">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-400">
                Coming soon
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1 text-slate-500">
              <span className="text-4xl font-black">—</span>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              A future Pro plan will add team seats, SSO, and direct IRS TIN matching. Billing is powered by Stripe and
              is{' '}
              {stripeEnabled === null
                ? 'currently being checked'
                : stripeEnabled
                  ? 'configured for this workspace'
                  : 'not yet configured'}
              . Until then, everything stays free.
            </p>
            <button
              disabled
              className="mt-8 block w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-800 px-6 py-3 text-center text-base font-semibold text-slate-500"
            >
              Not available yet
            </button>
          </div>
        </div>

        <p className="mt-10 text-sm text-slate-500">
          Already have an account? <Link href="/auth/sign-in" className="text-emerald-400 hover:text-emerald-300">Sign in</Link>
        </p>
      </section>
    </main>
  )
}
