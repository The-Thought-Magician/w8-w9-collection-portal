import { Hono } from 'hono'
import { db } from '../db/index.js'
import { document_versions, payees } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET /payee/:id — immutable version history for a payee (owner only)
router.get('/payee/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.param('id')

  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, payeeId), eq(payees.user_id, userId)))
  if (!payee) return c.json({ error: 'Not found' }, 404)

  const versions = await db
    .select()
    .from(document_versions)
    .where(and(eq(document_versions.payee_id, payeeId), eq(document_versions.user_id, userId)))
    .orderBy(desc(document_versions.version), desc(document_versions.created_at))

  return c.json(versions)
})

export default router
