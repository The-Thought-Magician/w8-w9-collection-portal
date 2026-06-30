import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET / — list current user's notifications (newest first)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// POST /:id/read — mark one notification read (owner)
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
    .returning()

  return c.json(updated)
})

// POST /read-all — mark all of the user's notifications read
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const updated = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
    .returning({ id: notifications.id })
  return c.json({ updated: updated.length })
})

export default router
