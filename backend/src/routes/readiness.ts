import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  readiness_states,
  payees,
  forms,
  expiry_records,
  bnotices,
  tin_checks,
  org_settings,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const checkSchema = z.object({
  payee_id: z.string().min(1),
})

// Pure readiness evaluation for a single payee. Returns the computed state,
// reason, blocked dollars and whether payment is blocked.
async function evaluatePayee(userId: string, payee: typeof payees.$inferSelect) {
  const reasons: string[] = []

  // 1. Is there a current (non-superseded, non-expired) form on file?
  const payeeForms = await db
    .select()
    .from(forms)
    .where(and(eq(forms.user_id, userId), eq(forms.payee_id, payee.id)))
    .orderBy(desc(forms.created_at))

  const liveForms = payeeForms.filter((f) => f.status !== 'superseded')
  if (liveForms.length === 0) {
    reasons.push('no_form_on_file')
  } else {
    const hasInvalid = liveForms.some((f) => f.status === 'invalid')
    if (hasInvalid) reasons.push('form_invalid')
    const hasExpired = liveForms.some((f) => f.status === 'expired')
    if (hasExpired) reasons.push('form_expired')
  }

  // 2. Expiry buckets: any expired form blocks; expiring_soon is a warning.
  const expiry = await db
    .select()
    .from(expiry_records)
    .where(and(eq(expiry_records.user_id, userId), eq(expiry_records.payee_id, payee.id)))
  const anyExpired = expiry.some((e) => e.bucket === 'expired')
  const anyExpiringSoon = expiry.some((e) => e.bucket === 'expiring_soon')
  if (anyExpired && !reasons.includes('form_expired')) reasons.push('form_expired')

  // 3. Open B-notices block payment.
  const openBnotices = await db
    .select()
    .from(bnotices)
    .where(and(eq(bnotices.user_id, userId), eq(bnotices.payee_id, payee.id), eq(bnotices.status, 'open')))
  if (openBnotices.length > 0) reasons.push('open_bnotice')

  // 4. TIN mismatch blocks payment.
  const tinResults = await db
    .select()
    .from(tin_checks)
    .where(and(eq(tin_checks.user_id, userId), eq(tin_checks.payee_id, payee.id)))
    .orderBy(desc(tin_checks.created_at))
  if (tinResults.length > 0) {
    const latest = tinResults[0]
    if (latest.name_tin_match === 'mismatch' || !latest.structural_valid) {
      reasons.push('tin_mismatch')
    }
  }

  const blocked = reasons.length > 0
  const blockedAmountCents = blocked ? payee.expected_annual_spend_cents : 0

  let state: 'green' | 'yellow' | 'red'
  let reason: string
  if (blocked) {
    state = 'red'
    reason = reasons.join(', ')
  } else if (anyExpiringSoon) {
    state = 'yellow'
    reason = 'expiring_soon'
  } else {
    state = 'green'
    reason = 'ready'
  }

  return {
    state,
    reason,
    reasons: blocked ? reasons : state === 'yellow' ? ['expiring_soon'] : [],
    is_payment_blocked: blocked,
    blocked_amount_cents: blockedAmountCents,
  }
}

// Upsert the computed state into readiness_states and mirror onto the payee row.
async function persistState(
  userId: string,
  payeeId: string,
  evald: { state: string; reason: string; is_payment_blocked: boolean; blocked_amount_cents: number },
) {
  await db
    .insert(readiness_states)
    .values({
      user_id: userId,
      payee_id: payeeId,
      state: evald.state,
      reason: evald.reason,
      blocked_amount_cents: evald.blocked_amount_cents,
      is_payment_blocked: evald.is_payment_blocked,
      computed_at: new Date(),
    })
    .onConflictDoUpdate({
      target: readiness_states.payee_id,
      set: {
        user_id: userId,
        state: evald.state,
        reason: evald.reason,
        blocked_amount_cents: evald.blocked_amount_cents,
        is_payment_blocked: evald.is_payment_blocked,
        computed_at: new Date(),
      },
    })

  await db
    .update(payees)
    .set({ readiness_state: evald.state, updated_at: new Date() })
    .where(eq(payees.id, payeeId))
}

// GET /ledger — aggregate blocked payees/dollars grouped by reason
router.get('/ledger', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const states = await db
    .select()
    .from(readiness_states)
    .where(eq(readiness_states.user_id, userId))

  let totalBlockedPayees = 0
  let totalBlockedCents = 0
  const byReason: Record<string, { count: number; blocked_cents: number }> = {}
  const distribution: Record<string, number> = { green: 0, yellow: 0, red: 0 }

  for (const s of states) {
    distribution[s.state] = (distribution[s.state] ?? 0) + 1
    if (!s.is_payment_blocked) continue
    totalBlockedPayees += 1
    totalBlockedCents += s.blocked_amount_cents
    // A payee may have multiple reasons stored comma-separated.
    const reasons = (s.reason ?? 'unknown').split(',').map((r) => r.trim()).filter(Boolean)
    for (const r of reasons.length ? reasons : ['unknown']) {
      if (!byReason[r]) byReason[r] = { count: 0, blocked_cents: 0 }
      byReason[r].count += 1
      byReason[r].blocked_cents += s.blocked_amount_cents
    }
  }

  const byReasonArr = Object.entries(byReason)
    .map(([reason, v]) => ({ reason, count: v.count, blocked_cents: v.blocked_cents }))
    .sort((a, b) => b.blocked_cents - a.blocked_cents)

  return c.json({
    total_blocked_payees: totalBlockedPayees,
    total_blocked_cents: totalBlockedCents,
    by_reason: byReasonArr,
    distribution,
  })
})

// GET /payee/:id — readiness state for one payee
router.get('/payee/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [payee] = await db.select().from(payees).where(eq(payees.id, id))
  if (!payee) return c.json({ error: 'Not found' }, 404)
  if (payee.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  let [state] = await db
    .select()
    .from(readiness_states)
    .where(eq(readiness_states.payee_id, id))

  if (!state) {
    // Compute on demand if never computed.
    const evald = await evaluatePayee(userId, payee)
    await persistState(userId, id, evald)
    ;[state] = await db.select().from(readiness_states).where(eq(readiness_states.payee_id, id))
  }

  return c.json(state)
})

// POST /check — payment-eligibility check
router.post('/check', authMiddleware, zValidator('json', checkSchema), async (c) => {
  const userId = getUserId(c)
  const { payee_id } = c.req.valid('json')

  const [payee] = await db.select().from(payees).where(eq(payees.id, payee_id))
  if (!payee) return c.json({ error: 'Not found' }, 404)
  if (payee.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const evald = await evaluatePayee(userId, payee)
  await persistState(userId, payee_id, evald)

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id,
    action: 'readiness.checked',
    entity_type: 'payee',
    entity_id: payee_id,
    detail: evald.is_payment_blocked
      ? `Payment blocked: ${evald.reason}`
      : 'Payment allowed',
    metadata: { state: evald.state, reasons: evald.reasons },
  })

  return c.json({
    allowed: !evald.is_payment_blocked,
    state: evald.state,
    reasons: evald.reasons,
    blocked_amount_cents: evald.blocked_amount_cents,
  })
})

// POST /recompute — recompute readiness for all payees
router.post('/recompute', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // Honor org expiring-soon settings indirectly via expiry_records already computed.
  await db.select().from(org_settings).where(eq(org_settings.user_id, userId))

  const allPayees = await db.select().from(payees).where(eq(payees.user_id, userId))
  let updated = 0
  for (const payee of allPayees) {
    const evald = await evaluatePayee(userId, payee)
    await persistState(userId, payee.id, evald)
    updated += 1
  }

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'readiness.recomputed',
    entity_type: 'readiness',
    detail: `Recomputed readiness for ${updated} payee(s)`,
    metadata: { updated },
  })

  return c.json({ updated })
})

export default router
