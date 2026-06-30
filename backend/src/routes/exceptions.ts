import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { exceptions, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const assignSchema = z.object({
  assignee: z.string().min(1),
})

const resolveSchema = z.object({
  resolution_note: z.string().min(1),
})

const waiveSchema = z.object({
  resolution_note: z.string().min(1),
})

// GET / — list exceptions (?status) for the current user
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const status = c.req.query('status')

  const conditions = [eq(exceptions.user_id, userId)]
  if (status) conditions.push(eq(exceptions.status, status))

  const rows = await db
    .select()
    .from(exceptions)
    .where(and(...conditions))
    .orderBy(desc(exceptions.created_at))

  return c.json(rows)
})

// Shared loader: fetch an owned exception or null
async function loadOwned(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.id, id), eq(exceptions.user_id, userId)))
  return row ?? null
}

// POST /:id/assign — assign to a user (body: assignee)
router.post('/:id/assign', authMiddleware, zValidator('json', assignSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { assignee } = c.req.valid('json')

  const existing = await loadOwned(userId, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(exceptions)
    .set({ assignee, updated_at: new Date() })
    .where(and(eq(exceptions.id, id), eq(exceptions.user_id, userId)))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: existing.payee_id,
    action: 'exception.assign',
    entity_type: 'exception',
    entity_id: id,
    detail: `Assigned to ${assignee}`,
    metadata: { assignee },
  })

  return c.json(updated)
})

// POST /:id/resolve — resolve with note
router.post('/:id/resolve', authMiddleware, zValidator('json', resolveSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { resolution_note } = c.req.valid('json')

  const existing = await loadOwned(userId, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(exceptions)
    .set({ status: 'resolved', resolution_note, updated_at: new Date() })
    .where(and(eq(exceptions.id, id), eq(exceptions.user_id, userId)))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: existing.payee_id,
    action: 'exception.resolve',
    entity_type: 'exception',
    entity_id: id,
    detail: resolution_note,
    metadata: { resolution_note },
  })

  return c.json(updated)
})

// POST /:id/waive — waive with note
router.post('/:id/waive', authMiddleware, zValidator('json', waiveSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { resolution_note } = c.req.valid('json')

  const existing = await loadOwned(userId, id)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(exceptions)
    .set({ status: 'waived', resolution_note, updated_at: new Date() })
    .where(and(eq(exceptions.id, id), eq(exceptions.user_id, userId)))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: existing.payee_id,
    action: 'exception.waive',
    entity_type: 'exception',
    entity_id: id,
    detail: resolution_note,
    metadata: { resolution_note },
  })

  return c.json(updated)
})

export default router
