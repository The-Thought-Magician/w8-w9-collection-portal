import Link from 'next/link'

const features = [
  {
    title: 'Self-Serve Payee Portal',
    body: 'A tokenized, no-login portal directs each payee through a guided entity and residency questionnaire and determines the required form: W-9, W-8BEN, W-8BEN-E, W-8ECI, or W-8IMY.',
  },
  {
    title: 'Field-Level Validation Engine',
    body: 'Every submitted form is checked field by field: TIN structure, entity-versus-classification consistency, Chapter 3 and Chapter 4 status, treaty-claim lines, signature, and date. Each check returns a documented pass, warning, or error.',
  },
  {
    title: 'Expiry and Recertification Clock',
    body: 'W-8 series forms expire on the three-year statutory clock. The system computes valid-through dates, classifies the roster into valid, expiring, and expired, and recalculates readiness on demand.',
  },
  {
    title: 'Recertification Campaigns',
    body: 'Payees expiring within 90 days or missing a form on file are identified and notified on a defined schedule. Invitation, submission, and completion status are tracked to closure.',
  },
  {
    title: 'Payment-Block Readiness Ledger',
    body: 'Each payee holds a documented readiness state. The ledger states, precisely, how many payees and how many dollars are withheld from payment, and for what reason, prior to disbursement.',
  },
  {
    title: 'Treaty, Withholding, and Chapter 3/4 Controls',
    body: 'Treaty benefit claims are checked against a country and article catalog. Backup-withholding exposure is calculated. Chapter 3 (NRA) and Chapter 4 (FATCA) statuses are verified for consistency with the declared entity classification.',
  },
]

const problems = [
  'The required form depends on entity type and residency status; an incorrect determination exposes the payer to 24% backup withholding.',
  'W-8 series forms expire on a three-year clock. A form on file as valid last year may be invalid today.',
  'Treaty claims and Chapter 3/4 status fields must be completed correctly and consistently, or the claimed benefit does not hold.',
  'Absent a system of record, gaps are typically discovered during 1099 filing, after penalties and remediation costs have already accrued.',
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500 text-sm font-black text-slate-950">W8</span>
          <span className="text-lg font-bold tracking-tight">W8W9CollectionPortal</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-yellow-400">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-300">
          W-9 / W-8 readiness system of record
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Document a valid tax form for every payee
          <span className="text-yellow-400"> before the first payment is issued.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          W8W9CollectionPortal is the system of record for W-9 and W-8 series compliance. It determines the correct
          form, validates every field against IRS requirements, tracks the three-year expiry clock, and maintains a
          readiness ledger that quantifies the payees and dollars withheld pending documentation.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/auth/sign-up" className="rounded-lg bg-yellow-500 px-6 py-3 text-base font-semibold text-slate-950 hover:bg-yellow-400">
            Start free
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">All features available at no cost. A sample roster can be seeded for review on demand.</p>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/40 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold">The compliance exposure</h2>
          <p className="mt-2 text-slate-400">
            Any US business paying non-employees is required to hold a valid W-9 or W-8 series form before payment, or
            it assumes backup-withholding liability and IRS penalty exposure. In practice, four conditions create risk.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {problems.map((p) => (
              <li key={p} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-5 text-sm text-slate-300">
                <span className="mt-0.5 text-yellow-400">■</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-bold">A single system of record for the form lifecycle</h2>
          <p className="mt-2 text-slate-400">
            Form determination, field-level validation, the three-year expiry clock, recertification campaigns, and a
            payment-block gate with quantified exposure, maintained as one auditable record.
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
        <div className="mx-auto max-w-3xl rounded-2xl border border-yellow-500/30 bg-yellow-500/5 p-10 text-center">
          <h2 className="text-2xl font-bold">Establish readiness before the filing season, not during it.</h2>
          <p className="mt-3 text-slate-400">
            Replace email- and spreadsheet-based tracking with a documented readiness ledger. Seed a sample roster and
            review the current state in minutes.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/auth/sign-up" className="rounded-lg bg-yellow-500 px-6 py-3 text-base font-semibold text-slate-950 hover:bg-yellow-400">
              Create your account
            </Link>
            <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>W8W9CollectionPortal — system of record for the W-9 / W-8 series form lifecycle.</p>
      </footer>
    </main>
  )
}
