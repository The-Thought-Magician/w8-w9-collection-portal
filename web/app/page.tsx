import Link from 'next/link'

const features = [
  {
    title: 'Self-Serve Payee Portal',
    body: 'A tokenized, no-login portal walks each vendor through a guided entity and residency questionnaire, then picks the right form automatically: W-9, W-8BEN, W-8BEN-E, W-8ECI, or W-8IMY.',
  },
  {
    title: 'Field-Level Validation Engine',
    body: 'Every form is checked field by field: TIN structure, entity-vs-classification consistency, chapter 3 and 4 status, treaty-claim lines, signature and date. Each check returns a typed pass, warning, or error.',
  },
  {
    title: 'Expiry & Recertification Clock',
    body: 'W-8 forms expire on the three-year clock. We compute valid-through dates, bucket your roster into valid, expiring-soon, and expired, and recompute readiness on demand.',
  },
  {
    title: 'Recertification Campaigns',
    body: 'Target every payee expiring within 90 days or missing a form, track invited, opened, submitted, and completed counts, and send reminders without leaving the portal.',
  },
  {
    title: 'Payment-Block Readiness Ledger',
    body: 'Each payee gets a green, yellow, or red readiness state. The ledger quantifies exactly how many payees and how many dollars are blocked, grouped by reason, before any payment goes out.',
  },
  {
    title: 'Treaty, Withholding & Chapter 3/4',
    body: 'Validate treaty benefit claims against a country catalog, compute backup-withholding exposure, and keep chapter 3 (NRA) and chapter 4 (FATCA) statuses consistent with the declared entity type.',
  },
]

const problems = [
  'The correct form depends on entity type and US-vs-foreign residency, and getting it wrong triggers 24% backup withholding.',
  'W-8 forms expire on a three-year clock, so a form valid last year may be invalid now.',
  'Treaty claims and chapter 3/4 status fields must be filled correctly and consistently, or the benefit is void.',
  'Most AP teams chase forms over email and spreadsheets and find the gaps only at 1099 season, when penalties have already accrued.',
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">W8</span>
          <span className="text-lg font-bold tracking-tight">W8W9CollectionPortal</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          W-9 / W-8 readiness system of record
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Hold a valid tax form for every payee,
          <span className="text-emerald-400"> before the first payment.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          W8W9CollectionPortal collects, validates, and keeps current every payee W-9 and W-8 series form. A self-serve
          portal picks the right form, a validation engine checks it field by field, and a readiness ledger shows the
          dollars and payees blocked by missing or invalid documents.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-500">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">All features free. Sample roster seeded in one click.</p>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/40 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold">Why this is hard</h2>
          <p className="mt-2 text-slate-400">
            Every US business that pays non-employees must hold a valid W-9 or W-8 before payment, or face backup
            withholding and IRS penalties. The reality is messy.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {problems.map((p) => (
              <li key={p} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-300">
                <span className="mt-0.5 text-red-400">●</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold">Everything in one readiness system</h2>
          <p className="mt-2 text-slate-400">
            Form selection, field-level validation, the three-year expiry clock, recertification campaigns, and a
            payment-block gate with quantified blocked dollars.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <h3 className="text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-10 text-center">
          <h2 className="text-2xl font-bold">Be ready before 1099 season, not during it.</h2>
          <p className="mt-3 text-slate-400">
            Stop chasing forms over email. Seed a sample roster and see your readiness ledger in minutes.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/auth/sign-up" className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-500">
              Create your account
            </Link>
            <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>W8W9CollectionPortal — the readiness system of record for the W-9 / W-8 lifecycle.</p>
      </footer>
    </main>
  )
}
