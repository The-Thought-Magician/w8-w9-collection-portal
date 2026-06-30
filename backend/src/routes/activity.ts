import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET / — append-only audit trail for the current user (optional ?payee_id filter)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')

  const where = payeeId
    ? and(eq(activity_log.user_id, userId), eq(activity_log.payee_id, payeeId))
    : eq(activity_log.user_id, userId)

  const limitRaw = parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200

  const rows = await db
    .select()
    .from(activity_log)
    .where(where)
    .orderBy(desc(activity_log.created_at))
    .limit(limit)

  return c.json(rows)
})

export default router
