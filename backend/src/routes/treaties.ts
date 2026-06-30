import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { treaty_catalog, treaty_claims, payees, forms } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET /catalog — public — treaty country catalog
// ---------------------------------------------------------------------------
router.get('/catalog', async (c) => {
  const rows = await db.select().from(treaty_catalog).orderBy(treaty_catalog.country)
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /claims — auth — list treaty claims (?payee_id)
// ---------------------------------------------------------------------------
router.get('/claims', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')
  const conds = [eq(treaty_claims.user_id, userId)]
  if (payeeId) conds.push(eq(treaty_claims.payee_id, payeeId))
  const rows = await db
    .select()
    .from(treaty_claims)
    .where(and(...conds))
    .orderBy(desc(treaty_claims.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /claims — auth — record + validate a treaty claim
// ---------------------------------------------------------------------------
const claimSchema = z.object({
  form_id: z.string().min(1),
  payee_id: z.string().min(1),
  country: z.string().min(1),
  article: z.string().optional(),
  income_type: z.string().optional().default('royalties'),
  rate: z.number().optional(),
})

router.post('/claims', authMiddleware, zValidator('json', claimSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership checks: payee + form must belong to the current user.
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

  // Validation logic: cross-reference the claim against the treaty catalog and form data.
  const country = body.country.toUpperCase()
  const [catalogEntry] = await db
    .select()
    .from(treaty_catalog)
    .where(eq(treaty_catalog.country, country))

  let is_valid = true
  const issues: string[] = []

  if (!catalogEntry) {
    is_valid = false
    issues.push(`No treaty on file for country ${country}`)
  }

  // A US person cannot claim a treaty benefit.
  if (payee.is_us_person) {
    is_valid = false
    issues.push('US persons are not eligible for treaty benefits')
  }

  // The form's treaty country (if set) must match the claimed country.
  if (form.treaty_country && form.treaty_country.toUpperCase() !== country) {
    is_valid = false
    issues.push(`Form treaty country (${form.treaty_country}) does not match claimed country (${country})`)
  }

  // Treaty benefits require a foreign W-8 form, not a W-9.
  if (form.form_type === 'W-9') {
    is_valid = false
    issues.push('Treaty benefits cannot be claimed on a W-9; a W-8 series form is required')
  }

  // Resolve the applied rate: prefer the explicit claim rate, fall back to catalog.
  const resolvedRate =
    body.rate !== undefined && body.rate !== null
      ? body.rate
      : catalogEntry?.rate ?? null

  // If the income type is specified and the catalog tracks a specific type, check alignment.
  if (catalogEntry?.income_type && body.income_type && catalogEntry.income_type !== body.income_type) {
    issues.push(
      `Claimed income type (${body.income_type}) differs from catalog default (${catalogEntry.income_type})`,
    )
  }

  const message = is_valid
    ? `Treaty claim valid: ${country}${
        resolvedRate !== null ? ` @ ${resolvedRate}%` : ''
      }${catalogEntry?.article ? ` (Article ${catalogEntry.article})` : ''}${
        issues.length ? `. Notes: ${issues.join('; ')}` : ''
      }`
    : `Treaty claim invalid: ${issues.join('; ')}`

  const [claim] = await db
    .insert(treaty_claims)
    .values({
      user_id: userId,
      form_id: body.form_id,
      payee_id: body.payee_id,
      country,
      article: body.article ?? catalogEntry?.article ?? null,
      rate: resolvedRate,
      income_type: body.income_type ?? catalogEntry?.income_type ?? 'royalties',
      is_valid,
      message,
    })
    .returning()

  return c.json(claim, 201)
})

export default router
