import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  expiry_records,
  forms,
  payees,
  readiness_states,
  org_settings,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { nextFirings } from '../lib/cron.js'

const router = new Hono()

// Whole router is auth-gated.
router.use('*', authMiddleware)

const DAY_MS = 86_400_000

type Bucket = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry'

function classify(validThrough: Date | null, soonDays: number): { bucket: Bucket; daysRemaining: number | null } {
  if (!validThrough) return { bucket: 'no_expiry', daysRemaining: null }
  const now = Date.now()
  const diffDays = Math.floor((validThrough.getTime() - now) / DAY_MS)
  if (diffDays < 0) return { bucket: 'expired', daysRemaining: diffDays }
  if (diffDays <= soonDays) return { bucket: 'expiring_soon', daysRemaining: diffDays }
  return { bucket: 'valid', daysRemaining: diffDays }
}

async function getSoonDays(userId: string): Promise<number> {
  const [settings] = await db
    .select()
    .from(org_settings)
    .where(eq(org_settings.user_id, userId))
  return settings?.expiring_soon_days ?? 90
}

// GET / — list expiry records (optionally filtered by ?bucket).
router.get('/', async (c) => {
  const userId = getUserId(c)
  const bucket = c.req.query('bucket')
  const rows = bucket
    ? await db
        .select()
        .from(expiry_records)
        .where(and(eq(expiry_records.user_id, userId), eq(expiry_records.bucket, bucket)))
        .orderBy(desc(expiry_records.computed_at))
    : await db
        .select()
        .from(expiry_records)
        .where(eq(expiry_records.user_id, userId))
        .orderBy(desc(expiry_records.computed_at))
  return c.json(rows)
})

// GET /buckets — counts per bucket.
router.get('/buckets', async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(expiry_records)
    .where(eq(expiry_records.user_id, userId))
  const counts = { valid: 0, expiring_soon: 0, expired: 0, no_expiry: 0 }
  for (const r of rows) {
    const b = (r.bucket as Bucket) ?? 'valid'
    if (b in counts) counts[b] += 1
  }
  return c.json(counts)
})

// POST /recompute — recompute expiry + readiness across the whole roster.
// Rebuilds the user's expiry_records from current (non-superseded) forms,
// reclassifies each form's bucket, refreshes readiness_states for blocked
// payees, and returns a suggested annual recertification firing timeline.
router.post('/recompute', async (c) => {
  const userId = getUserId(c)
  const soonDays = await getSoonDays(userId)

  const userForms = await db.select().from(forms).where(eq(forms.user_id, userId))
  const userPayees = await db.select().from(payees).where(eq(payees.user_id, userId))
  const payeeById = new Map(userPayees.map((p) => [p.id, p]))

  // Wipe the user's existing expiry records, then rebuild from current forms.
  await db.delete(expiry_records).where(eq(expiry_records.user_id, userId))

  // Track the most-urgent bucket per payee for readiness.
  const bucketRank: Record<Bucket, number> = {
    expired: 3,
    expiring_soon: 2,
    valid: 1,
    no_expiry: 0,
  }
  const payeeWorst = new Map<string, { bucket: Bucket; hasForm: boolean }>()

  let updated = 0
  for (const f of userForms) {
    // Only consider forms that are the live record (not superseded/invalid).
    if (f.status === 'superseded') continue
    const { bucket, daysRemaining } = classify(f.valid_through, soonDays)
    await db.insert(expiry_records).values({
      user_id: userId,
      form_id: f.id,
      payee_id: f.payee_id,
      valid_through: f.valid_through,
      days_remaining: daysRemaining,
      bucket,
    })
    updated += 1

    const prev = payeeWorst.get(f.payee_id)
    if (!prev || bucketRank[bucket] > bucketRank[prev.bucket]) {
      payeeWorst.set(f.payee_id, { bucket, hasForm: true })
    }
  }

  // Refresh readiness for every payee in the roster.
  for (const payee of userPayees) {
    const worst = payeeWorst.get(payee.id)
    let state: 'green' | 'yellow' | 'red'
    let reason: string
    let blocked: boolean

    if (!worst || !worst.hasForm) {
      state = 'red'
      reason = 'No valid form on file'
      blocked = true
    } else if (worst.bucket === 'expired') {
      state = 'red'
      reason = 'Form on file has expired'
      blocked = true
    } else if (worst.bucket === 'expiring_soon') {
      state = 'yellow'
      reason = `Form expires within ${soonDays} days`
      blocked = false
    } else {
      state = 'green'
      reason = 'Valid form on file'
      blocked = false
    }

    const blockedCents = blocked ? payee.expected_annual_spend_cents : 0

    const [existing] = await db
      .select()
      .from(readiness_states)
      .where(eq(readiness_states.payee_id, payee.id))
    if (existing) {
      await db
        .update(readiness_states)
        .set({
          user_id: userId,
          state,
          reason,
          blocked_amount_cents: blockedCents,
          is_payment_blocked: blocked,
          computed_at: new Date(),
        })
        .where(eq(readiness_states.payee_id, payee.id))
    } else {
      await db.insert(readiness_states).values({
        user_id: userId,
        payee_id: payee.id,
        state,
        reason,
        blocked_amount_cents: blockedCents,
        is_payment_blocked: blocked,
      })
    }

    // Mirror the readiness signal onto the payee row for fast roster filters.
    const readinessColor = state
    await db
      .update(payees)
      .set({ readiness_state: readinessColor, updated_at: new Date() })
      .where(eq(payees.id, payee.id))
  }

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: null,
    action: 'expiry_recomputed',
    entity_type: 'expiry',
    entity_id: null,
    detail: `Recomputed ${updated} expiry record(s) across ${userPayees.length} payee(s)`,
    metadata: { updated, payees: userPayees.length } as Record<string, unknown>,
  })

  // Suggested recertification cadence: annual sweep on Jan 2nd at 09:00 UTC.
  const recertTimeline = nextFirings('cron', '0 9 2 1 *', 'UTC', new Date().toISOString(), 3)

  return c.json({ updated, payees_evaluated: userPayees.length, recert_timeline: recertTimeline })
})

export default router
