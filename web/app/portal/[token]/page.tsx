'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

interface Session {
  id?: string
  token: string
  payee_id?: string | null
  status: string
  answers?: Record<string, unknown>
  recommended_form?: string | null
}

interface Recommendation {
  recommended_form?: string
  rationale?: string
}

interface TreatyRow {
  id?: string
  country: string
  article?: string | null
  income_type?: string | null
  rate?: number | null
  notes?: string | null
}

interface Rule {
  id?: string
  form?: string
  recommended_form?: string
  when?: string
  condition?: string
  description?: string
  rationale?: string
  [k: string]: unknown
}

// Guided questionnaire steps. Answers are persisted to the session as a flat object.
interface Step {
  key: string
  question: string
  help?: string
  options: { value: string; label: string; hint?: string }[]
}

const STEPS: Step[] = [
  {
    key: 'us_person',
    question: 'Are you a U.S. person?',
    help: 'A U.S. person is a U.S. citizen, resident, or an entity organized under U.S. law.',
    options: [
      { value: 'yes', label: 'Yes, U.S. person', hint: 'Leads to a W-9' },
      { value: 'no', label: 'No, foreign person or entity', hint: 'Leads to the W-8 series' },
    ],
  },
  {
    key: 'entity_kind',
    question: 'Are you an individual or an entity?',
    help: 'An entity is a corporation, partnership, LLC, trust, estate, or similar.',
    options: [
      { value: 'individual', label: 'Individual / sole proprietor' },
      { value: 'entity', label: 'Entity (corporation, partnership, LLC, trust)' },
    ],
  },
  {
    key: 'us_trade_business',
    question: 'Is the income effectively connected with a U.S. trade or business?',
    help: 'Effectively connected income (ECI) is reported on a W-8ECI rather than W-8BEN/BEN-E.',
    options: [
      { value: 'no', label: 'No, not effectively connected' },
      { value: 'yes', label: 'Yes, effectively connected (ECI)', hint: 'Leads to a W-8ECI' },
    ],
  },
  {
    key: 'intermediary',
    question: 'Are you acting as an intermediary or flow-through entity?',
    help: 'Qualified/nonqualified intermediaries and flow-through entities use a W-8IMY.',
    options: [
      { value: 'no', label: 'No, beneficial owner of the income' },
      { value: 'yes', label: 'Yes, intermediary or flow-through', hint: 'Leads to a W-8IMY' },
    ],
  },
  {
    key: 'treaty_claim',
    question: 'Will you claim a reduced rate under an income tax treaty?',
    help: 'Treaty benefits require your residence country to have a treaty with the U.S.',
    options: [
      { value: 'no', label: 'No treaty claim' },
      { value: 'yes', label: 'Yes, claiming treaty benefits' },
    ],
  },
]

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'

function formBadge(form?: string | null) {
  if (!form) return null
  return <Badge tone="green" className="text-sm">{form}</Badge>
}

export default function PortalPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [stepIdx, setStepIdx] = useState(0)
  const [saving, setSaving] = useState(false)

  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [recommending, setRecommending] = useState(false)

  const [treaties, setTreaties] = useState<TreatyRow[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [showRules, setShowRules] = useState(false)

  // Signer details collected before submission.
  const [signerName, setSignerName] = useState('')
  const [signerCapacity, setSignerCapacity] = useState('')
  const [tin, setTin] = useState('')
  const [treatyCountry, setTreatyCountry] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ form: unknown; recommendation?: Recommendation } | null>(null)

  // Resolve or start the session for this token.
  const init = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      let s: Session
      try {
        s = await api.getQuestionnaire(token)
      } catch {
        // No session yet for this token: start one bound to the token.
        s = await api.startQuestionnaire({ token })
      }
      setSession(s)
      const existing = (s.answers ?? {}) as Record<string, string>
      setAnswers(existing)
      if (s.recommended_form) {
        setRecommendation({ recommended_form: s.recommended_form })
      }
      // Resume at first unanswered step.
      const firstUnanswered = STEPS.findIndex((st) => !(st.key in existing))
      setStepIdx(firstUnanswered === -1 ? STEPS.length : firstUnanswered)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This portal link is invalid or expired.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    api.getTreatyCatalog().then((d) => setTreaties(Array.isArray(d) ? d : [])).catch(() => {})
    api.getRecommendationRules().then((d) => setRules(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const totalSteps = STEPS.length
  const answeredCount = useMemo(() => STEPS.filter((s) => answers[s.key]).length, [answers])
  const allAnswered = answeredCount === totalSteps
  const treatyClaimed = answers.treaty_claim === 'yes'

  async function persist(next: Record<string, string>) {
    if (!token) return
    setSaving(true)
    try {
      const updated = await api.answerQuestionnaire(token, { answers: next })
      if (updated && typeof updated === 'object') setSession(updated as Session)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer')
    } finally {
      setSaving(false)
    }
  }

  async function choose(step: Step, value: string) {
    const next = { ...answers, [step.key]: value }
    setAnswers(next)
    setRecommendation(null)
    setSubmitted(null)
    await persist(next)
    setStepIdx((i) => Math.min(i + 1, totalSteps))
  }

  async function getRecommendation() {
    if (!token) return
    setRecommending(true)
    setError(null)
    try {
      const rec = await api.recommendFromSession(token, { answers })
      setRecommendation(rec)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not compute a recommendation')
    } finally {
      setRecommending(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitErr(null)
    if (!signerName.trim()) {
      setSubmitErr('Signer name is required.')
      return
    }
    if (!token) return
    setSubmitting(true)
    try {
      const res = await api.submitQuestionnaire(token, {
        answers,
        recommended_form: recommendation?.recommended_form,
        signer_name: signerName.trim(),
        signer_capacity: signerCapacity.trim() || null,
        tin: tin.trim() || null,
        treaty_country: treatyClaimed ? treatyCountry.trim() || null : null,
      })
      setSubmitted(res as { form: unknown; recommendation?: Recommendation })
      // Refresh session status (now completed).
      try {
        const s = await api.getQuestionnaire(token)
        setSession(s)
      } catch {
        /* ignore */
      }
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <Spinner label="Loading your portal..." />
      </main>
    )
  }

  if (error && !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 text-lg font-semibold">Portal unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
        </div>
      </main>
    )
  }

  const completed = session?.status === 'completed' || !!submitted

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">W8</span>
          <span className="text-lg font-bold tracking-tight">Tax Form Portal</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {completed ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
            <div className="text-4xl">✅</div>
            <h1 className="mt-4 text-2xl font-bold">Thank you, your form has been submitted</h1>
            <p className="mt-2 text-slate-400">
              Your{' '}
              {formBadge(submitted?.recommendation?.recommended_form ?? recommendation?.recommended_form ?? session?.recommended_form)}{' '}
              has been recorded. The requesting business has been notified. You can close this window.
            </p>
            {(submitted?.recommendation?.rationale ?? recommendation?.rationale) && (
              <p className="mx-auto mt-4 max-w-md text-sm text-slate-500">
                {submitted?.recommendation?.rationale ?? recommendation?.rationale}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold">Vendor tax form questionnaire</h1>
              <p className="mt-2 text-sm text-slate-400">
                Answer a few questions and we will determine the correct U.S. tax form (W-9 or W-8 series) for you, then
                collect the details needed to submit it. No account required.
              </p>
            </div>

            {/* Progress */}
            <div className="mb-8">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {answeredCount} of {totalSteps} answered
                  {saving && <span className="ml-2 text-emerald-400">saving…</span>}
                </span>
                <span>{Math.round((answeredCount / totalSteps) * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${(answeredCount / totalSteps) * 100}%` }}
                />
              </div>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Steps */}
            <div className="space-y-4">
              {STEPS.map((step, i) => {
                const active = i === stepIdx
                const answered = !!answers[step.key]
                const visible = active || answered
                if (!visible) return null
                return (
                  <div
                    key={step.key}
                    className={`rounded-xl border p-5 transition-colors ${
                      active ? 'border-emerald-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">Step {i + 1}</span>
                          {answered && !active && <Badge tone="green">Answered</Badge>}
                        </div>
                        <h2 className="mt-1 text-base font-semibold text-white">{step.question}</h2>
                        {step.help && active && <p className="mt-1 text-sm text-slate-500">{step.help}</p>}
                      </div>
                      {answered && !active && (
                        <button
                          onClick={() => setStepIdx(i)}
                          className="shrink-0 text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Change
                        </button>
                      )}
                    </div>

                    {active ? (
                      <div className="mt-4 grid gap-2">
                        {step.options.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => choose(step, opt.value)}
                            disabled={saving}
                            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50 ${
                              answers[step.key] === opt.value
                                ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-600 hover:bg-slate-800'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {opt.hint && <span className="text-xs text-slate-500">{opt.hint}</span>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-slate-400">
                        {step.options.find((o) => o.value === answers[step.key])?.label ?? answers[step.key]}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Recommendation */}
            {allAnswered && (
              <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
                <h2 className="text-base font-semibold text-white">Recommended form</h2>
                {recommendation?.recommended_form ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-3">
                      {formBadge(recommendation.recommended_form)}
                      <span className="text-sm text-slate-400">is the right form for you.</span>
                    </div>
                    {recommendation.rationale && (
                      <p className="rounded-lg bg-slate-950 p-3 text-sm text-slate-400">{recommendation.rationale}</p>
                    )}
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-sm text-slate-400">
                      All questions answered. Compute the recommended form from your responses.
                    </p>
                    <Button onClick={getRecommendation} disabled={recommending} className="mt-3">
                      {recommending ? <Spinner label="Computing..." /> : 'Recommend my form'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Submission */}
            {recommendation?.recommended_form && (
              <form onSubmit={submit} className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
                <h2 className="text-base font-semibold text-white">Complete and submit your {recommendation.recommended_form}</h2>
                {submitErr && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {submitErr}
                  </div>
                )}
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400">Signer name *</label>
                      <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className={inputCls} placeholder="Full legal name" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400">Signing capacity</label>
                      <input value={signerCapacity} onChange={(e) => setSignerCapacity(e.target.value)} className={inputCls} placeholder="e.g. Owner, CFO" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-400">
                        {answers.us_person === 'yes' ? 'TIN / SSN / EIN' : 'Foreign TIN (if any)'}
                      </label>
                      <input value={tin} onChange={(e) => setTin(e.target.value)} className={inputCls} placeholder="XX-XXXXXXX" />
                    </div>
                    {treatyClaimed && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-400">Treaty country</label>
                        <input
                          value={treatyCountry}
                          onChange={(e) => setTreatyCountry(e.target.value)}
                          className={inputCls}
                          placeholder="Country of tax residence"
                          list="treaty-countries"
                        />
                        <datalist id="treaty-countries">
                          {treaties.map((t) => (
                            <option key={t.country} value={t.country} />
                          ))}
                        </datalist>
                      </div>
                    )}
                  </div>

                  {treatyClaimed && treaties.length > 0 && (
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Treaty catalog</div>
                      <div className="max-h-44 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="py-1 pr-3">Country</th>
                              <th className="py-1 pr-3">Article</th>
                              <th className="py-1 pr-3">Income type</th>
                              <th className="py-1 text-right">Rate</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-300">
                            {treaties.map((t) => (
                              <tr key={t.country} className="border-t border-slate-800">
                                <td className="py-1 pr-3">{t.country}</td>
                                <td className="py-1 pr-3">{t.article ?? '—'}</td>
                                <td className="py-1 pr-3">{t.income_type ?? '—'}</td>
                                <td className="py-1 text-right tabular-nums">
                                  {t.rate == null ? '—' : `${(t.rate <= 1 ? t.rate * 100 : t.rate).toFixed(1)}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <Button type="submit" disabled={submitting} className="w-full">
                    {submitting ? <Spinner label="Submitting..." /> : `Submit ${recommendation.recommended_form}`}
                  </Button>
                </div>
              </form>
            )}

            {/* Rules explainer */}
            {rules.length > 0 && (
              <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
                <button
                  onClick={() => setShowRules((v) => !v)}
                  className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-300"
                >
                  <span>How we choose your form ({rules.length} rules)</span>
                  <span className="text-slate-500">{showRules ? '−' : '+'}</span>
                </button>
                {showRules && (
                  <ul className="mt-4 space-y-3">
                    {rules.map((r, i) => (
                      <li key={r.id ?? i} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
                        <div className="flex items-center gap-2">
                          {formBadge(r.form ?? r.recommended_form)}
                        </div>
                        <p className="mt-1 text-slate-400">
                          {r.when ?? r.condition ?? r.description ?? r.rationale ?? 'Rule'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
