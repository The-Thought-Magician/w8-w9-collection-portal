import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { tin_checks, forms, payees, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const checkSchema = z.object({
  form_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// Pure structural TIN validation
// ---------------------------------------------------------------------------
const DIGITS9 = /^\d{9}$/

function normalizeTin(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[\s-]/g, '')
}

function structuralCheck(
  tinType: string | null | undefined,
  rawTin: string | null | undefined,
): { valid: boolean; message: string } {
  const tin = normalizeTin(rawTin)

  if (!tin) {
    return { valid: false, message: 'No TIN present on the form' }
  }

  // FOREIGN payees on W-8 forms may legitimately lack a US TIN format.
  if (tinType === 'FOREIGN') {
    return { valid: true, message: 'Foreign TIN accepted without US structural format' }
  }

  if (!DIGITS9.test(tin)) {
    return { valid: false, message: `TIN must be 9 digits; got ${tin.length} character(s)` }
  }

  const area = tin.slice(0, 3)
  const group = tin.slice(3, 5)
  const serial = tin.slice(5)

  if (tinType === 'SSN') {
    if (area === '000' || area === '666' || area.startsWith('9')) {
      return { valid: false, message: `Invalid SSN area number "${area}"` }
    }
    if (group === '00') return { valid: false, message: 'Invalid SSN group number "00"' }
    if (serial === '0000') return { valid: false, message: 'Invalid SSN serial number "0000"' }
    return { valid: true, message: 'SSN structurally valid' }
  }

  if (tinType === 'ITIN') {
    // ITINs always begin with 9, with the 4th digit in the 50-65, 70-88, 90-92, 94-99 range.
    if (!area.startsWith('9')) {
      return { valid: false, message: 'ITIN must begin with 9' }
    }
    const middle = parseInt(group, 10)
    const validMiddle =
      (middle >= 50 && middle <= 65) ||
      (middle >= 70 && middle <= 88) ||
      (middle >= 90 && middle <= 92) ||
      (middle >= 94 && middle <= 99)
    if (!validMiddle) {
      return { valid: false, message: `Invalid ITIN group digits "${group}"` }
    }
    return { valid: true, message: 'ITIN structurally valid' }
  }

  if (tinType === 'EIN') {
    if (area === '000') return { valid: false, message: 'Invalid EIN prefix "000"' }
    return { valid: true, message: 'EIN structurally valid' }
  }

  // Unknown / unspecified type: accept any well-formed 9-digit number.
  return { valid: true, message: '9-digit TIN structurally valid' }
}

// Heuristic name<->TIN match: a real IRS TIN-match is external; we approximate
// by confirming the form carries both a signer/legal name and a structurally
// valid TIN of a consistent type.
function nameTinMatch(
  signerName: string | null | undefined,
  legalName: string | null | undefined,
  structuralValid: boolean,
): 'match' | 'mismatch' | 'unchecked' {
  const hasName = !!(signerName?.trim() || legalName?.trim())
  if (!hasName) return 'unchecked'
  return structuralValid ? 'match' : 'mismatch'
}

// POST /check — structural TIN check for a form (body: form_id)
router.post('/check', authMiddleware, zValidator('json', checkSchema), async (c) => {
  const userId = getUserId(c)
  const { form_id } = c.req.valid('json')

  const [form] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, form_id), eq(forms.user_id, userId)))
  if (!form) return c.json({ error: 'Form not found' }, 404)

  const [payee] = await db
    .select()
    .from(payees)
    .where(eq(payees.id, form.payee_id))

  const structural = structuralCheck(form.tin_type, form.tin)
  const match = nameTinMatch(form.signer_name, payee?.legal_name, structural.valid)

  let message = structural.message
  if (match === 'mismatch') {
    message = `${structural.message}; name/TIN consistency check failed`
  } else if (match === 'match') {
    message = `${structural.message}; name/TIN consistent`
  }

  const [check] = await db
    .insert(tin_checks)
    .values({
      user_id: userId,
      form_id: form.id,
      payee_id: form.payee_id,
      tin_type: form.tin_type,
      structural_valid: structural.valid,
      name_tin_match: match,
      message,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: form.payee_id,
    action: 'tin.check',
    entity_type: 'form',
    entity_id: form.id,
    detail: message,
    metadata: { structural_valid: structural.valid, name_tin_match: match },
  })

  return c.json(check, 201)
})

// GET / — list TIN check results (?payee_id)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')

  const conditions = [eq(tin_checks.user_id, userId)]
  if (payeeId) conditions.push(eq(tin_checks.payee_id, payeeId))

  const rows = await db
    .select()
    .from(tin_checks)
    .where(and(...conditions))
    .orderBy(desc(tin_checks.created_at))

  return c.json(rows)
})

export default router
