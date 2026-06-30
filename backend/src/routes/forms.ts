import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  forms,
  form_fields,
  payees,
  validations,
  validation_checks,
  expiry_records,
  document_versions,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const FORM_TYPES = ['W-9', 'W-8BEN', 'W-8BEN-E', 'W-8ECI', 'W-8IMY'] as const

const formSchema = z.object({
  payee_id: z.string().min(1),
  form_type: z.enum(FORM_TYPES),
  signer_name: z.string().optional(),
  signer_capacity: z.string().optional(),
  signature_date: z.string().optional(),
  tin: z.string().optional(),
  tin_type: z.enum(['SSN', 'EIN', 'ITIN', 'FOREIGN']).optional(),
  entity_classification: z.string().optional(),
  chapter3_status: z.string().optional(),
  chapter4_status: z.string().optional(),
  treaty_country: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional().default({}),
  submitted_via: z.enum(['portal', 'manual', 'import']).optional().default('manual'),
  fields: z.array(z.object({ field_key: z.string(), field_value: z.string().nullable().optional() })).optional().default([]),
})

// ---------------------------------------------------------------------------
// Validation engine — pure structural/consistency checks over a form record.
// Returns the checks; the caller persists a validations row + checks rows.
// ---------------------------------------------------------------------------

export interface FormLike {
  id: string
  form_type: string
  signer_name: string | null
  signature_date: Date | null
  tin: string | null
  tin_type: string | null
  chapter3_status: string | null
  chapter4_status: string | null
  treaty_country: string | null
  valid_through: Date | null
}

export interface EngineCheck {
  check_key: string
  severity: 'pass' | 'warning' | 'error'
  message: string
}

const DIGITS = (s: string) => s.replace(/\D/g, '')

/** Structurally validate a US TIN by type. */
function tinStructuralValid(tinType: string | null, tin: string | null): boolean {
  if (!tin) return false
  const d = DIGITS(tin)
  if (tinType === 'SSN' || tinType === 'ITIN') return d.length === 9
  if (tinType === 'EIN') return d.length === 9
  if (tinType === 'FOREIGN') return tin.trim().length >= 1
  return d.length === 9
}

export function runValidationEngine(form: FormLike): EngineCheck[] {
  const checks: EngineCheck[] = []
  const isW9 = form.form_type === 'W-9'
  const isW8 = form.form_type.startsWith('W-8')

  // 1. Form type recognized
  if (!isW9 && !isW8) {
    checks.push({ check_key: 'form_type', severity: 'error', message: `Unrecognized form type ${form.form_type}` })
  } else {
    checks.push({ check_key: 'form_type', severity: 'pass', message: `Form type ${form.form_type} recognized` })
  }

  // 2. Signature present
  if (!form.signer_name || form.signer_name.trim() === '') {
    checks.push({ check_key: 'signature', severity: 'error', message: 'Signer name is missing' })
  } else {
    checks.push({ check_key: 'signature', severity: 'pass', message: 'Signer name present' })
  }

  // 3. Signature date present
  if (!form.signature_date) {
    checks.push({ check_key: 'signature_date', severity: 'warning', message: 'Signature date is missing' })
  } else {
    checks.push({ check_key: 'signature_date', severity: 'pass', message: 'Signature date present' })
  }

  // 4. TIN presence + structure
  if (isW9) {
    if (!form.tin) {
      checks.push({ check_key: 'tin', severity: 'error', message: 'W-9 requires a TIN' })
    } else if (!tinStructuralValid(form.tin_type, form.tin)) {
      checks.push({ check_key: 'tin', severity: 'error', message: `TIN is not structurally valid for type ${form.tin_type ?? 'unknown'}` })
    } else {
      checks.push({ check_key: 'tin', severity: 'pass', message: 'TIN is structurally valid' })
    }
    // W-9 must be a US person: SSN/EIN/ITIN
    if (form.tin_type === 'FOREIGN') {
      checks.push({ check_key: 'tin_type', severity: 'error', message: 'W-9 cannot use a FOREIGN TIN type' })
    }
  } else if (isW8) {
    // W-8 foreign TINs are optional but if present should be FOREIGN
    if (form.tin && form.tin_type && form.tin_type !== 'FOREIGN' && form.tin_type !== 'EIN') {
      checks.push({ check_key: 'tin_type', severity: 'warning', message: 'W-8 forms generally carry a foreign TIN' })
    } else {
      checks.push({ check_key: 'tin', severity: 'pass', message: 'TIN acceptable for W-8' })
    }
  }

  // 5. Chapter 3 / Chapter 4 consistency for W-8 entity forms
  if (form.form_type === 'W-8BEN-E' || form.form_type === 'W-8IMY') {
    if (!form.chapter3_status) {
      checks.push({ check_key: 'chapter3', severity: 'warning', message: 'Chapter 3 status not specified on entity form' })
    } else {
      checks.push({ check_key: 'chapter3', severity: 'pass', message: 'Chapter 3 status present' })
    }
    if (!form.chapter4_status) {
      checks.push({ check_key: 'chapter4', severity: 'warning', message: 'Chapter 4 (FATCA) status not specified on entity form' })
    } else {
      checks.push({ check_key: 'chapter4', severity: 'pass', message: 'Chapter 4 status present' })
    }
  }

  // 6. Treaty claim consistency
  if (form.treaty_country && isW9) {
    checks.push({ check_key: 'treaty', severity: 'error', message: 'Treaty claims are not valid on a W-9' })
  } else if (form.treaty_country) {
    checks.push({ check_key: 'treaty', severity: 'pass', message: `Treaty claim for ${form.treaty_country}` })
  }

  // 7. Expiry — W-8 forms expire (3rd year end); flag if already expired
  if (form.valid_through) {
    const now = Date.now()
    if (form.valid_through.getTime() < now) {
      checks.push({ check_key: 'expiry', severity: 'error', message: 'Form is past its valid-through date' })
    } else {
      checks.push({ check_key: 'expiry', severity: 'pass', message: 'Form is within its validity period' })
    }
  }

  return checks
}

function summarize(checks: EngineCheck[]): { verdict: 'pass' | 'warning' | 'error'; error_count: number; warning_count: number; summary: string } {
  const error_count = checks.filter((c) => c.severity === 'error').length
  const warning_count = checks.filter((c) => c.severity === 'warning').length
  const verdict = error_count > 0 ? 'error' : warning_count > 0 ? 'warning' : 'pass'
  const summary =
    verdict === 'pass'
      ? 'All checks passed'
      : `${error_count} error(s), ${warning_count} warning(s)`
  return { verdict, error_count, warning_count, summary }
}

/** Persist a validation run for a form (engine + checks + exceptions skipped here). */
export async function persistValidation(userId: string, form: FormLike & { user_id: string; payee_id: string }) {
  const checks = runValidationEngine(form)
  const { verdict, error_count, warning_count, summary } = summarize(checks)
  const [validation] = await db
    .insert(validations)
    .values({
      user_id: userId,
      form_id: form.id,
      payee_id: form.payee_id,
      verdict,
      error_count,
      warning_count,
      summary,
    })
    .returning()
  for (const ck of checks) {
    await db.insert(validation_checks).values({
      validation_id: validation.id,
      check_key: ck.check_key,
      severity: ck.severity,
      message: ck.message,
    })
  }
  // Reflect verdict on the form status.
  const newStatus = verdict === 'error' ? 'invalid' : 'valid'
  await db.update(forms).set({ status: newStatus }).where(eq(forms.id, form.id))
  return { validation, checks }
}

/** Compute the W-8 valid-through (Dec 31 of the 3rd year after signature). W-9s do not expire. */
function computeValidThrough(formType: string, signatureDate: Date | null): Date | null {
  if (formType === 'W-9') return null
  const base = signatureDate ?? new Date()
  return new Date(Date.UTC(base.getUTCFullYear() + 3, 11, 31, 23, 59, 59))
}

function bucketFor(validThrough: Date | null, expiringSoonDays = 90): string {
  if (!validThrough) return 'no_expiry'
  const days = Math.floor((validThrough.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'expired'
  if (days <= expiringSoonDays) return 'expiring_soon'
  return 'valid'
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list forms (?payee_id)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const payeeId = c.req.query('payee_id')
  const conds = [eq(forms.user_id, userId)]
  if (payeeId) conds.push(eq(forms.payee_id, payeeId))
  const rows = await db
    .select()
    .from(forms)
    .where(and(...conds))
    .orderBy(desc(forms.created_at))
  return c.json(rows)
})

// GET /:id — form detail incl. fields
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [form] = await db.select().from(forms).where(eq(forms.id, id))
  if (!form) return c.json({ error: 'Not found' }, 404)
  if (form.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const fields = await db.select().from(form_fields).where(eq(form_fields.form_id, id)).orderBy(form_fields.created_at)
  return c.json({ form, fields })
})

// POST / — submit a form; creates version + expiry record
router.post('/', authMiddleware, zValidator('json', formSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership of the payee.
  const [payee] = await db.select().from(payees).where(eq(payees.id, body.payee_id))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)
  if (payee.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const signatureDate = body.signature_date ? new Date(body.signature_date) : null
  const validThrough = computeValidThrough(body.form_type, signatureDate)

  // Supersede prior forms of the same type for this payee; compute next version.
  const priorSameType = await db
    .select()
    .from(forms)
    .where(and(eq(forms.payee_id, body.payee_id), eq(forms.form_type, body.form_type)))
    .orderBy(desc(forms.version))
  const nextVersion = (priorSameType[0]?.version ?? 0) + 1

  const [form] = await db
    .insert(forms)
    .values({
      user_id: userId,
      payee_id: body.payee_id,
      form_type: body.form_type,
      status: 'submitted',
      signer_name: body.signer_name ?? null,
      signer_capacity: body.signer_capacity ?? null,
      signature_date: signatureDate,
      tin: body.tin ?? null,
      tin_type: body.tin_type ?? null,
      entity_classification: body.entity_classification ?? null,
      chapter3_status: body.chapter3_status ?? null,
      chapter4_status: body.chapter4_status ?? null,
      treaty_country: body.treaty_country ?? null,
      data: body.data ?? {},
      valid_through: validThrough,
      version: nextVersion,
      submitted_via: body.submitted_via ?? 'manual',
    })
    .returning()

  // Mark older same-type forms as superseded.
  for (const old of priorSameType) {
    if (old.status !== 'superseded') {
      await db.update(forms).set({ status: 'superseded' }).where(eq(forms.id, old.id))
      await db.update(document_versions).set({ superseded_by: form.id }).where(eq(document_versions.form_id, old.id))
    }
  }

  // Persist provided fields.
  if (body.fields && body.fields.length > 0) {
    for (const f of body.fields) {
      await db.insert(form_fields).values({ form_id: form.id, field_key: f.field_key, field_value: f.field_value ?? null })
    }
  }

  // Immutable version snapshot.
  await db.insert(document_versions).values({
    user_id: userId,
    payee_id: body.payee_id,
    form_id: form.id,
    version: nextVersion,
    form_type: body.form_type,
    verdict: null,
    submitted_by: body.signer_name ?? userId,
    snapshot: { ...form } as Record<string, unknown>,
  })

  // Expiry record.
  await db.insert(expiry_records).values({
    user_id: userId,
    form_id: form.id,
    payee_id: body.payee_id,
    valid_through: validThrough,
    days_remaining: validThrough ? Math.floor((validThrough.getTime() - Date.now()) / 86_400_000) : null,
    bucket: bucketFor(validThrough),
  })

  // Activity.
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: body.payee_id,
    action: 'form.submitted',
    entity_type: 'form',
    entity_id: form.id,
    detail: `Submitted ${body.form_type} v${nextVersion}`,
  })

  return c.json(form, 201)
})

// POST /:id/validate — run the validation engine on a form
router.post('/:id/validate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [form] = await db.select().from(forms).where(eq(forms.id, id))
  if (!form) return c.json({ error: 'Not found' }, 404)
  if (form.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { validation } = await persistValidation(userId, form)
  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: form.payee_id,
    action: 'form.validated',
    entity_type: 'validation',
    entity_id: validation.id,
    detail: `Validation verdict: ${validation.verdict}`,
  })
  return c.json(validation)
})

// DELETE /:id — delete a form (owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [form] = await db.select().from(forms).where(eq(forms.id, id))
  if (!form) return c.json({ error: 'Not found' }, 404)
  if (form.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Remove dependent rows first to satisfy FK constraints.
  const vRows = await db.select().from(validations).where(eq(validations.form_id, id))
  for (const v of vRows) {
    await db.delete(validation_checks).where(eq(validation_checks.validation_id, v.id))
  }
  await db.delete(validations).where(eq(validations.form_id, id))
  await db.delete(form_fields).where(eq(form_fields.form_id, id))
  await db.delete(expiry_records).where(eq(expiry_records.form_id, id))
  await db.delete(document_versions).where(eq(document_versions.form_id, id))
  await db.delete(forms).where(eq(forms.id, id))

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id: form.payee_id,
    action: 'form.deleted',
    entity_type: 'form',
    entity_id: id,
    detail: `Deleted ${form.form_type}`,
  })
  return c.json({ success: true })
})

export default router
