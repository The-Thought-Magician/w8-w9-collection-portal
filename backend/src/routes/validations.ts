import { Hono } from 'hono'
import { db } from '../db/index.js'
import { validations, validation_checks, forms, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { persistValidation } from './forms.js'

const router = new Hono()

// GET / — list validation runs (?form_id)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const formId = c.req.query('form_id')
  const conds = [eq(validations.user_id, userId)]
  if (formId) conds.push(eq(validations.form_id, formId))
  const rows = await db
    .select()
    .from(validations)
    .where(and(...conds))
    .orderBy(desc(validations.created_at))
  return c.json(rows)
})

// GET /:id — validation detail incl. checks
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [validation] = await db.select().from(validations).where(eq(validations.id, id))
  if (!validation) return c.json({ error: 'Not found' }, 404)
  if (validation.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const checks = await db
    .select()
    .from(validation_checks)
    .where(eq(validation_checks.validation_id, id))
    .orderBy(validation_checks.created_at)
  return c.json({ validation, checks })
})

// POST /:id/rerun — re-run validation for the same form
router.post('/:id/rerun', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [prior] = await db.select().from(validations).where(eq(validations.id, id))
  if (!prior) return c.json({ error: 'Not found' }, 404)
  if (prior.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [form] = await db.select().from(forms).where(eq(forms.id, prior.form_id))
  if (!form) return c.json({ error: 'Form not found' }, 404)
  if (form.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { validation } = await persistValidation(userId, form)
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: form.payee_id,
    action: 'validation.rerun',
    entity_type: 'validation',
    entity_id: validation.id,
    detail: `Re-ran validation; verdict ${validation.verdict}`,
  })
  return c.json(validation)
})

export default router
