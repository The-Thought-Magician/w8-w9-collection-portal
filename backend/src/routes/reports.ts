import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  payees,
  readiness_states,
  forms,
  expiry_records,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All report endpoints require auth (tenant-scoped aggregates over the user's roster).
router.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET /1099-readiness
// 1099 readiness report: ready vs not-ready counts, blocked dollars, expiring.
// ---------------------------------------------------------------------------
router.get('/1099-readiness', async (c) => {
  const userId = getUserId(c)

  const roster = await db.select().from(payees).where(eq(payees.user_id, userId))
  const states = await db
    .select()
    .from(readiness_states)
    .where(eq(readiness_states.user_id, userId))
  const expiries = await db
    .select()
    .from(expiry_records)
    .where(eq(expiry_records.user_id, userId))
  const allForms = await db.select().from(forms).where(eq(forms.user_id, userId))

  const stateByPayee = new Map(states.map((s) => [s.payee_id, s]))

  let ready = 0
  let not_ready = 0
  let blocked_payees = 0
  let blocked_cents = 0

  for (const p of roster) {
    const st = stateByPayee.get(p.id)
    const isReady = st ? st.state === 'green' : false
    if (isReady) {
      ready += 1
    } else {
      not_ready += 1
    }
    if (st?.is_payment_blocked) {
      blocked_payees += 1
      blocked_cents += st.blocked_amount_cents ?? 0
    }
  }

  // Expiring forms = expiry records in the expiring_soon bucket; expired separately.
  let expiring_soon = 0
  let expired = 0
  for (const e of expiries) {
    if (e.bucket === 'expiring_soon') expiring_soon += 1
    else if (e.bucket === 'expired') expired += 1
  }

  // Payees with at least one form on file.
  const payeesWithForms = new Set(allForms.map((f) => f.payee_id))
  const missing_forms = roster.filter((p) => !payeesWithForms.has(p.id)).length

  const total = roster.length
  const readiness_rate = total > 0 ? Math.round((ready / total) * 100) : 0

  return c.json({
    total_payees: total,
    ready,
    not_ready,
    readiness_rate,
    blocked_payees,
    blocked_cents,
    expiring_soon,
    expired,
    forms_on_file: allForms.length,
    missing_forms,
  })
})

// ---------------------------------------------------------------------------
// GET /breakdown
// Breakdown by vendor type and by country.
// ---------------------------------------------------------------------------
router.get('/breakdown', async (c) => {
  const userId = getUserId(c)

  const roster = await db.select().from(payees).where(eq(payees.user_id, userId))
  const states = await db
    .select()
    .from(readiness_states)
    .where(eq(readiness_states.user_id, userId))
  const stateByPayee = new Map(states.map((s) => [s.payee_id, s]))

  type Bucket = {
    key: string
    count: number
    ready: number
    blocked_cents: number
  }

  const byType = new Map<string, Bucket>()
  const byCountry = new Map<string, Bucket>()

  const bump = (map: Map<string, Bucket>, key: string, isReady: boolean, blocked: number) => {
    let b = map.get(key)
    if (!b) {
      b = { key, count: 0, ready: 0, blocked_cents: 0 }
      map.set(key, b)
    }
    b.count += 1
    if (isReady) b.ready += 1
    b.blocked_cents += blocked
  }

  for (const p of roster) {
    const st = stateByPayee.get(p.id)
    const isReady = st ? st.state === 'green' : false
    const blocked = st?.is_payment_blocked ? st.blocked_amount_cents ?? 0 : 0
    bump(byType, p.vendor_type ?? 'unknown', isReady, blocked)
    bump(byCountry, p.country ?? 'unknown', isReady, blocked)
  }

  const sortDesc = (a: Bucket, z: Bucket) => z.count - a.count

  return c.json({
    by_type: [...byType.values()].sort(sortDesc),
    by_country: [...byCountry.values()].sort(sortDesc),
  })
})

export default router
