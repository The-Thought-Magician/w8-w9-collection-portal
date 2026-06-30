import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { payees, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const payeeSchema = z.object({
  vendor_name: z.string().min(1),
  legal_name: z.string().optional(),
  contact_email: z.string().email().optional().or(z.literal('')),
  country: z.string().min(1).default('US'),
  is_us_person: z.boolean().optional().default(true),
  vendor_type: z.string().min(1).default('individual'),
  expected_annual_spend_cents: z.number().int().nonnegative().optional().default(0),
  external_ref: z.string().optional(),
  notes: z.string().optional(),
  readiness_state: z.string().optional(),
  compliance_status: z.string().optional(),
})

// GET / — list current user's payees, optional ?state= &country= &type=
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const state = c.req.query('state')
  const country = c.req.query('country')
  const type = c.req.query('type')

  const conds = [eq(payees.user_id, userId)]
  if (state) conds.push(eq(payees.readiness_state, state))
  if (country) conds.push(eq(payees.country, country))
  if (type) conds.push(eq(payees.vendor_type, type))

  const rows = await db
    .select()
    .from(payees)
    .where(and(...conds))
    .orderBy(desc(payees.created_at))
  return c.json(rows)
})

// GET /:id — payee detail (owner)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [row] = await db.select().from(payees).where(eq(payees.id, id))
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  return c.json(row)
})

// POST / — create payee
router.post('/', authMiddleware, zValidator('json', payeeSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const values = {
    user_id: userId,
    vendor_name: body.vendor_name,
    legal_name: body.legal_name ?? null,
    contact_email: body.contact_email ? body.contact_email : null,
    country: body.country ?? 'US',
    is_us_person: body.is_us_person ?? true,
    vendor_type: body.vendor_type ?? 'individual',
    expected_annual_spend_cents: body.expected_annual_spend_cents ?? 0,
    external_ref: body.external_ref ?? null,
    notes: body.notes ?? null,
    ...(body.readiness_state ? { readiness_state: body.readiness_state } : {}),
    ...(body.compliance_status ? { compliance_status: body.compliance_status } : {}),
  }
  const [created] = await db.insert(payees).values(values).returning()
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: created.id,
    action: 'payee.created',
    entity_type: 'payee',
    entity_id: created.id,
    detail: `Created payee ${created.vendor_name}`,
  })
  return c.json(created, 201)
})

// PUT /:id — update payee (owner)
router.put('/:id', authMiddleware, zValidator('json', payeeSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(payees).where(eq(payees.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  for (const k of [
    'vendor_name',
    'legal_name',
    'country',
    'is_us_person',
    'vendor_type',
    'expected_annual_spend_cents',
    'external_ref',
    'notes',
    'readiness_state',
    'compliance_status',
  ] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (body.contact_email !== undefined) patch.contact_email = body.contact_email ? body.contact_email : null

  const [updated] = await db.update(payees).set(patch).where(eq(payees.id, id)).returning()
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: id,
    action: 'payee.updated',
    entity_type: 'payee',
    entity_id: id,
    detail: `Updated payee ${updated.vendor_name}`,
  })
  return c.json(updated)
})

// DELETE /:id — delete payee (owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(payees).where(eq(payees.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(payees).where(eq(payees.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: id,
    action: 'payee.deleted',
    entity_type: 'payee',
    entity_id: id,
    detail: `Deleted payee ${existing.vendor_name}`,
  })
  return c.json({ success: true })
})

export default router
