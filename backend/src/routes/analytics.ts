import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  payees,
  forms,
  readiness_states,
  validations,
  expiry_records,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All analytics are tenant-scoped; require auth.
router.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET /metrics
// Headline dashboard cards.
// ---------------------------------------------------------------------------
router.get('/metrics', async (c) => {
  const userId = getUserId(c)

  const roster = await db.select().from(payees).where(eq(payees.user_id, userId))
  const allForms = await db.select().from(forms).where(eq(forms.user_id, userId))
  const states = await db
    .select()
    .from(readiness_states)
    .where(eq(readiness_states.user_id, userId))
  const runs = await db.select().from(validations).where(eq(validations.user_id, userId))

  // Readiness distribution by traffic-light state.
  const readiness_distribution = { green: 0, yellow: 0, red: 0 }
  let blocked_cents = 0
  const stateByPayee = new Map(states.map((s) => [s.payee_id, s]))
  for (const p of roster) {
    const st = stateByPayee.get(p.id)
    const state = st?.state ?? 'red'
    if (state === 'green') readiness_distribution.green += 1
    else if (state === 'yellow') readiness_distribution.yellow += 1
    else readiness_distribution.red += 1
    if (st?.is_payment_blocked) blocked_cents += st.blocked_amount_cents ?? 0
  }

  // Validation pass rate over all recorded runs.
  const passed = runs.filter((r) => r.verdict === 'pass').length
  const validation_pass_rate = runs.length > 0 ? Math.round((passed / runs.length) * 100) : 0

  return c.json({
    total_payees: roster.length,
    forms_on_file: allForms.length,
    readiness_distribution,
    validation_pass_rate,
    blocked_cents,
  })
})

// ---------------------------------------------------------------------------
// GET /trends
// Submissions and expirations over time (grouped by day).
// ---------------------------------------------------------------------------
router.get('/trends', async (c) => {
  const userId = getUserId(c)

  const allForms = await db.select().from(forms).where(eq(forms.user_id, userId))
  const expiries = await db
    .select()
    .from(expiry_records)
    .where(eq(expiry_records.user_id, userId))

  const dayKey = (d: Date | string | null): string | null => {
    if (!d) return null
    const dt = d instanceof Date ? d : new Date(d)
    if (Number.isNaN(dt.getTime())) return null
    return dt.toISOString().slice(0, 10)
  }

  // Submissions over time: count forms by creation day.
  const subMap = new Map<string, number>()
  for (const f of allForms) {
    const k = dayKey(f.created_at)
    if (!k) continue
    subMap.set(k, (subMap.get(k) ?? 0) + 1)
  }

  // Expirations over time: count forms by their valid_through day.
  const expMap = new Map<string, number>()
  for (const e of expiries) {
    const k = dayKey(e.valid_through)
    if (!k) continue
    expMap.set(k, (expMap.get(k) ?? 0) + 1)
  }

  const toSeries = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, z) => (a[0] < z[0] ? -1 : a[0] > z[0] ? 1 : 0))
      .map(([date, count]) => ({ date, count }))

  return c.json({
    submissions: toSeries(subMap),
    expirations: toSeries(expMap),
  })
})

export default router
