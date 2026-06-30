import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { request_links, payees, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All link operations are tenant-scoped writes/reads; require auth.
router.use('*', authMiddleware)

const createSchema = z.object({
  payee_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET /
// List the current user's request links (newest first).
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(request_links)
    .where(eq(request_links.user_id, userId))
    .orderBy(desc(request_links.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /
// Generate a tokenized document-request link for a payee the user owns.
// ---------------------------------------------------------------------------
router.post('/', zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { payee_id } = c.req.valid('json')

  // Ownership check: the payee must belong to the requesting user.
  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, payee_id), eq(payees.user_id, userId)))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)

  const token = crypto.randomUUID().replace(/-/g, '')

  const [link] = await db
    .insert(request_links)
    .values({
      user_id: userId,
      payee_id,
      token,
      status: 'sent',
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id,
    action: 'request_link.created',
    entity_type: 'request_link',
    entity_id: link.id,
    detail: `Generated document request link for ${payee.vendor_name}`,
    metadata: { token },
  })

  return c.json(link, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/revoke
// Revoke a request link (owner only).
// ---------------------------------------------------------------------------
router.post('/:id/revoke', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(request_links)
    .where(eq(request_links.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(request_links)
    .set({ status: 'revoked' })
    .where(eq(request_links.id, id))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: existing.payee_id,
    action: 'request_link.revoked',
    entity_type: 'request_link',
    entity_id: id,
    detail: 'Revoked document request link',
    metadata: {},
  })

  return c.json(updated)
})

export default router
