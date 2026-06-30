import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  withholding_determinations,
  payees,
  forms,
  treaty_catalog,
  org_settings,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Default statutory non-resident withholding rate (Chapter 3) absent a treaty.
const DEFAULT_NRA_RATE = 30
// Default backup-withholding rate (Chapter 61) for US persons with TIN issues.
const DEFAULT_BACKUP_RATE = 24

async function getSettings(userId: string) {
  const [existing] = await db.select().from(org_settings).where(eq(org_settings.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(org_settings).values({ user_id: userId }).returning()
  return created
}

// ---------------------------------------------------------------------------
// GET / — auth — list withholding determinations
// ---------------------------------------------------------------------------
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')
  const conds = [eq(withholding_determinations.user_id, userId)]
  if (payeeId) conds.push(eq(withholding_determinations.payee_id, payeeId))
  const rows = await db
    .select()
    .from(withholding_determinations)
    .where(and(...conds))
    .orderBy(desc(withholding_determinations.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /determine — auth — compute withholding rate for a payee
// ---------------------------------------------------------------------------
const determineSchema = z.object({
  payee_id: z.string().min(1),
  form_id: z.string().optional(),
  income_type: z.string().optional().default('royalties'),
  amount_cents: z.number().int().nonnegative().optional(),
})

router.post('/determine', authMiddleware, zValidator('json', determineSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [payee] = await db
    .select()
    .from(payees)
    .where(and(eq(payees.id, body.payee_id), eq(payees.user_id, userId)))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)

  // Resolve the form, if supplied (must be owned).
  let form: typeof forms.$inferSelect | undefined
  if (body.form_id) {
    const [f] = await db
      .select()
      .from(forms)
      .where(and(eq(forms.id, body.form_id), eq(forms.user_id, userId)))
    if (!f) return c.json({ error: 'Form not found' }, 404)
    form = f
  }

  const settings = await getSettings(userId)
  const incomeType = body.income_type ?? 'royalties'
  const rationaleParts: string[] = []

  let base_rate: number
  let applied_rate: number
  let treaty_applied = false

  if (payee.is_us_person) {
    // US persons are not subject to NRA withholding. They may be subject to
    // backup withholding if they lack a valid W-9 / TIN on file.
    base_rate = 0
    const hasValidW9 = !!form && form.form_type === 'W-9' && !!form.tin
    if (hasValidW9) {
      applied_rate = 0
      rationaleParts.push('US person with a valid W-9 and TIN on file: no withholding required.')
    } else {
      applied_rate = settings.backup_withholding_rate ?? DEFAULT_BACKUP_RATE
      rationaleParts.push(
        `US person without a valid W-9/TIN on file: backup withholding at ${applied_rate}% applies.`,
      )
    }
  } else {
    // Foreign person: statutory NRA rate, reducible by an applicable treaty.
    base_rate = settings.default_withholding_rate ?? DEFAULT_NRA_RATE
    applied_rate = base_rate
    rationaleParts.push(`Foreign person: statutory ${base_rate}% Chapter 3 withholding applies by default.`)

    const treatyCountry = (form?.treaty_country ?? payee.country)?.toUpperCase()
    if (treatyCountry) {
      const [entry] = await db
        .select()
        .from(treaty_catalog)
        .where(eq(treaty_catalog.country, treatyCountry))
      // A treaty rate only applies on a valid W-8 form (not a W-9, not missing).
      const eligibleForm = !form || (form.form_type !== 'W-9')
      if (entry && entry.rate !== null && entry.rate < base_rate && eligibleForm) {
        // If the catalog tracks an income type, only apply when it matches.
        const incomeMatches = !entry.income_type || entry.income_type === incomeType
        if (incomeMatches) {
          applied_rate = entry.rate
          treaty_applied = true
          rationaleParts.push(
            `Treaty (${treatyCountry}${entry.article ? `, Article ${entry.article}` : ''}) reduces the rate to ${entry.rate}% for ${incomeType}.`,
          )
        } else {
          rationaleParts.push(
            `Treaty exists for ${treatyCountry} but covers ${entry.income_type}, not ${incomeType}; statutory rate retained.`,
          )
        }
      } else if (entry && !eligibleForm) {
        rationaleParts.push('A valid W-8 form is required to claim treaty benefits; statutory rate retained.')
      }
    }
  }

  // Estimate the withholding dollars over a base amount: explicit amount wins,
  // otherwise fall back to the payee's expected annual spend.
  const baseAmountCents = body.amount_cents ?? payee.expected_annual_spend_cents ?? 0
  const estimated_withholding_cents = Math.round((baseAmountCents * applied_rate) / 100)

  const [determination] = await db
    .insert(withholding_determinations)
    .values({
      user_id: userId,
      payee_id: body.payee_id,
      form_id: body.form_id ?? null,
      income_type: incomeType,
      base_rate,
      applied_rate,
      treaty_applied,
      estimated_withholding_cents,
      rationale: rationaleParts.join(' '),
    })
    .returning()

  return c.json(determination, 201)
})

// ---------------------------------------------------------------------------
// GET /exposure — auth — aggregate potential backup-withholding exposure
// ---------------------------------------------------------------------------
router.get('/exposure', authMiddleware, async (c) => {
  const userId = getUserId(c)

  // Backup-withholding exposure = the dollar amount at risk for US persons who
  // do not have a valid W-9 / TIN on file, computed at the backup-withholding rate.
  const settings = await getSettings(userId)
  const backupRate = settings.backup_withholding_rate ?? DEFAULT_BACKUP_RATE

  const allPayees = await db.select().from(payees).where(eq(payees.user_id, userId))
  const userForms = await db.select().from(forms).where(eq(forms.user_id, userId))

  // A payee is "covered" if they have at least one W-9 with a TIN on file.
  const coveredPayeeIds = new Set(
    userForms.filter((f) => f.form_type === 'W-9' && !!f.tin).map((f) => f.payee_id),
  )

  let total_exposure_cents = 0
  let count = 0
  const at_risk: Array<{
    payee_id: string
    vendor_name: string
    expected_annual_spend_cents: number
    exposure_cents: number
  }> = []

  for (const p of allPayees) {
    if (!p.is_us_person) continue // backup withholding only applies to US persons
    if (coveredPayeeIds.has(p.id)) continue // has a valid W-9 → not exposed
    const exposure = Math.round((p.expected_annual_spend_cents * backupRate) / 100)
    total_exposure_cents += exposure
    count += 1
    at_risk.push({
      payee_id: p.id,
      vendor_name: p.vendor_name,
      expected_annual_spend_cents: p.expected_annual_spend_cents,
      exposure_cents: exposure,
    })
  }

  at_risk.sort((a, b) => b.exposure_cents - a.exposure_cents)

  return c.json({ total_exposure_cents, count, backup_rate: backupRate, at_risk })
})

export default router
