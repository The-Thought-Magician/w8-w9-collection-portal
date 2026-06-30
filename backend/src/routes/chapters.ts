import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { chapter_statuses, payees, forms } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Known Chapter 3 (income-tax withholding) statuses.
const CHAPTER3_STATUSES = new Set([
  'U.S. Person',
  'Individual',
  'Corporation',
  'Partnership',
  'Estate',
  'Trust',
  'Government',
  'Tax-Exempt Organization',
  'Private Foundation',
  'Central Bank of Issue',
])

// Known Chapter 4 (FATCA) statuses.
const CHAPTER4_STATUSES = new Set([
  'U.S. Person',
  'Participating FFI',
  'Reporting Model 1 FFI',
  'Reporting Model 2 FFI',
  'Nonparticipating FFI',
  'Registered Deemed-Compliant FFI',
  'Certified Deemed-Compliant FFI',
  'Active NFFE',
  'Passive NFFE',
  'Exempt Beneficial Owner',
  'Territory Financial Institution',
])

// ---------------------------------------------------------------------------
// GET / — auth — list chapter 3/4 status records (?payee_id)
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')
  const conds = [eq(chapter_statuses.user_id, userId)]
  if (payeeId) conds.push(eq(chapter_statuses.payee_id, payeeId))
  const rows = await db
    .select()
    .from(chapter_statuses)
    .where(and(...conds))
    .orderBy(desc(chapter_statuses.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /summary — auth — payees grouped by chapter4 status
// ---------------------------------------------------------------------------
router.get('/summary', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(chapter_statuses)
    .where(eq(chapter_statuses.user_id, userId))
    .orderBy(desc(chapter_statuses.created_at))

  // Group by chapter4 status, counting distinct payees (latest record wins per payee).
  const latestByPayee = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (!latestByPayee.has(r.payee_id)) latestByPayee.set(r.payee_id, r)
  }

  const by_chapter4: Record<string, number> = {}
  for (const r of latestByPayee.values()) {
    const key = r.chapter4_status ?? 'Unspecified'
    by_chapter4[key] = (by_chapter4[key] ?? 0) + 1
  }

  return c.json({ by_chapter4 })
})

// ---------------------------------------------------------------------------
// POST / — auth — record + consistency-check chapter statuses for a form
// ---------------------------------------------------------------------------
const chapterSchema = z.object({
  form_id: z.string().min(1),
  payee_id: z.string().min(1),
  chapter3_status: z.string().optional(),
  chapter4_status: z.string().optional(),
})

router.post('/', authMiddleware, zValidator('json', chapterSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership checks.
  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, body.payee_id), eq(payees.user_id, userId)))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)

  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, body.form_id), eq(forms.user_id, userId)))
  if (!form) return c.json({ error: 'Form not found' }, 404)

  const ch3 = body.chapter3_status ?? null
  const ch4 = body.chapter4_status ?? null

  // Consistency checks across chapter 3 and chapter 4 statuses.
  let is_consistent = true
  const issues: string[] = []

  if (ch3 && !CHAPTER3_STATUSES.has(ch3)) {
    issues.push(`Unrecognized Chapter 3 status: ${ch3}`)
  }
  if (ch4 && !CHAPTER4_STATUSES.has(ch4)) {
    issues.push(`Unrecognized Chapter 4 status: ${ch4}`)
  }

  // A U.S. person must be consistent across both chapters.
  const ch3IsUs = ch3 === 'U.S. Person'
  const ch4IsUs = ch4 === 'U.S. Person'
  if (ch3IsUs !== ch4IsUs && ch3 && ch4) {
    is_consistent = false
    issues.push('U.S. Person status is inconsistent between Chapter 3 and Chapter 4')
  }

  // The payee record's US-person flag must match a U.S. Person classification.
  if (payee.is_us_person && (ch3 ? !ch3IsUs : false)) {
    is_consistent = false
    issues.push('Payee is marked as a U.S. person but Chapter 3 status is not "U.S. Person"')
  }
  if (!payee.is_us_person && (ch4IsUs || ch3IsUs)) {
    is_consistent = false
    issues.push('Payee is marked as a foreign person but a U.S. Person status was supplied')
  }

  // FFI statuses (Chapter 4) are only valid for entities, not individuals.
  if (ch4 && ch4.includes('FFI') && ch3 === 'Individual') {
    is_consistent = false
    issues.push('FFI Chapter 4 statuses are not valid for an Individual (Chapter 3)')
  }

  // W-9 forms should carry a U.S. Person classification.
  if (form.form_type === 'W-9' && ch3 && !ch3IsUs) {
    is_consistent = false
    issues.push('A W-9 should reflect a U.S. Person Chapter 3 status')
  }

  if (issues.length > 0 && is_consistent) {
    // Warnings only (unrecognized values) without hard inconsistency still flag.
    is_consistent = false
  }

  const message = is_consistent
    ? `Chapter statuses consistent: Ch3=${ch3 ?? 'n/a'}, Ch4=${ch4 ?? 'n/a'}`
    : issues.join('; ')

  const [record] = await db
    .insert(chapter_statuses)
    .values({
      user_id: userId,
      form_id: body.form_id,
      payee_id: body.payee_id,
      chapter3_status: ch3,
      chapter4_status: ch4,
      is_consistent,
      message,
    })
    .returning()

  return c.json(record, 201)
})

export default router
