import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { bnotices, payees, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  payee_id: z.string().min(1),
  notice_kind: z.enum(['first', 'second']).optional().default('first'),
  received_date: z.string().datetime().optional(),
  status: z.enum(['open', 'resolved']).optional().default('open'),
  note: z.string().optional(),
})

const updateSchema = z.object({
  notice_kind: z.enum(['first', 'second']).optional(),
  received_date: z.string().datetime().nullable().optional(),
  status: z.enum(['open', 'resolved']).optional(),
  note: z.string().nullable().optional(),
})

// GET / — list B-notices + at-risk register (payees with open B-notices or two notices)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const notices = await db
    .select()
    .from(bnotices)
    .where(eq(bnotices.user_id, userId))
    .orderBy(desc(bnotices.created_at))

  // Build at-risk register: aggregate open notices per payee.
  // Two B-notices in 3 years → mandatory backup withholding; one open notice → at risk.
  const byPayee = new Map<
    string,
    { payee_id: string; first_count: number; second_count: number; open_count: number; total: number }
  >()
  for (const n of notices) {
    let agg = byPayee.get(n.payee_id)
    if (!agg) {
      agg = { payee_id: n.payee_id, first_count: 0, second_count: 0, open_count: 0, total: 0 }
      byPayee.set(n.payee_id, agg)
    }
    agg.total += 1
    if (n.notice_kind === 'second') agg.second_count += 1
    else agg.first_count += 1
    if (n.status === 'open') agg.open_count += 1
  }

  const payeeRows = await db.select().from(payees).where(eq(payees.user_id, userId))
  const payeeById = new Map(payeeRows.map((p) => [p.id, p]))

  const at_risk = [...byPayee.values()]
    .filter((a) => a.open_count > 0 || a.total >= 2)
    .map((a) => {
      const p = payeeById.get(a.payee_id)
      const mandatoryWithholding = a.total >= 2 || a.second_count > 0
      return {
        payee_id: a.payee_id,
        vendor_name: p?.vendor_name ?? null,
        notice_count: a.total,
        first_count: a.first_count,
        second_count: a.second_count,
        open_count: a.open_count,
        backup_withholding_required: mandatoryWithholding,
        risk_level: mandatoryWithholding ? 'high' : a.open_count > 0 ? 'medium' : 'low',
      }
    })
    .sort((x, y) => y.notice_count - x.notice_count)

  return c.json({ notices, at_risk })
})

// POST / — record a B-notice
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership: payee must belong to the user.
  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, body.payee_id), eq(payees.user_id, userId)))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)

  const [created] = await db
    .insert(bnotices)
    .values({
      user_id: userId,
      payee_id: body.payee_id,
      notice_kind: body.notice_kind,
      received_date: body.received_date ? new Date(body.received_date) : null,
      status: body.status,
      note: body.note ?? null,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: body.payee_id,
    action: 'bnotice.created',
    entity_type: 'bnotice',
    entity_id: created.id,
    detail: `${body.notice_kind === 'second' ? 'Second' : 'First'} B-notice recorded for ${payee.vendor_name}`,
    metadata: { notice_kind: body.notice_kind, status: body.status },
  })

  return c.json(created, 201)
})

// PUT /:id — update a B-notice status (owner)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(bnotices)
    .where(and(eq(bnotices.id, id), eq(bnotices.user_id, userId)))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const patch: Partial<typeof bnotices.$inferInsert> = {}
  if (body.notice_kind !== undefined) patch.notice_kind = body.notice_kind
  if (body.status !== undefined) patch.status = body.status
  if (body.note !== undefined) patch.note = body.note
  if (body.received_date !== undefined) {
    patch.received_date = body.received_date ? new Date(body.received_date) : null
  }

  const [updated] = await db
    .update(bnotices)
    .set(patch)
    .where(and(eq(bnotices.id, id), eq(bnotices.user_id, userId)))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: updated.payee_id,
    action: 'bnotice.updated',
    entity_type: 'bnotice',
    entity_id: updated.id,
    detail: `B-notice updated${body.status ? ` to ${body.status}` : ''}`,
    metadata: { status: updated.status, notice_kind: updated.notice_kind },
  })

  return c.json(updated)
})

export default router
