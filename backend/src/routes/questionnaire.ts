import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  questionnaire_sessions,
  form_recommendations,
  payees,
  forms,
  document_versions,
  activity_log,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { recommendForm, type RecommendAnswers } from './recommendations.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Public payee portal — no login. Sessions are addressed by an opaque token.
// A payee answers the guided questionnaire, gets a recommended form, then
// submits the completed form which creates an immutable form + version record.
// ---------------------------------------------------------------------------

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

function coerceAnswers(raw: unknown): RecommendAnswers {
  const a = (raw ?? {}) as Record<string, unknown>
  return {
    is_us_person: typeof a.is_us_person === 'boolean' ? a.is_us_person : undefined,
    entity_kind: typeof a.entity_kind === 'string' ? a.entity_kind : undefined,
    has_us_effectively_connected_income:
      typeof a.has_us_effectively_connected_income === 'boolean'
        ? a.has_us_effectively_connected_income
        : undefined,
    is_intermediary: typeof a.is_intermediary === 'boolean' ? a.is_intermediary : undefined,
    country: typeof a.country === 'string' ? a.country : undefined,
  }
}

const startSchema = z
  .object({
    payee_id: z.string().optional(),
    answers: z.record(z.string(), z.unknown()).optional(),
  })
  .optional()

// POST /start — public — start a session (optional ?token to bind to existing,
// optional payee_id in body to bind a payee). Returns the session.
router.post('/start', zValidator('json', startSchema), async (c) => {
  const body = c.req.valid('json') ?? {}
  const existingToken = c.req.query('token')

  // If a token is supplied and the session exists, return it (resume).
  if (existingToken) {
    const [found] = await db
      .select()
      .from(questionnaire_sessions)
      .where(eq(questionnaire_sessions.token, existingToken))
    if (found) return c.json(found)
  }

  // Validate payee binding if requested.
  let payeeId: string | null = null
  if (body.payee_id) {
    const [p] = await db.select().from(payees).where(eq(payees.id, body.payee_id))
    if (!p) return c.json({ error: 'Payee not found' }, 404)
    payeeId = p.id
  }

  const token = existingToken && existingToken.length >= 8 ? existingToken : newToken()
  const [session] = await db
    .insert(questionnaire_sessions)
    .values({
      payee_id: payeeId,
      token,
      status: 'in_progress',
      answers: (body.answers ?? {}) as Record<string, unknown>,
    })
    .returning()
  return c.json(session, 201)
})

// GET /:token — public — fetch session state by token.
router.get('/:token', async (c) => {
  const token = c.req.param('token')
  const [session] = await db
    .select()
    .from(questionnaire_sessions)
    .where(eq(questionnaire_sessions.token, token))
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json(session)
})

const answerSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
})

// POST /:token/answer — public — persist answers (merged into the session).
router.post('/:token/answer', zValidator('json', answerSchema), async (c) => {
  const token = c.req.param('token')
  const { answers } = c.req.valid('json')
  const [session] = await db
    .select()
    .from(questionnaire_sessions)
    .where(eq(questionnaire_sessions.token, token))
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.status !== 'in_progress') {
    return c.json({ error: 'Session is not editable' }, 409)
  }
  const merged = { ...(session.answers ?? {}), ...answers }
  const [updated] = await db
    .update(questionnaire_sessions)
    .set({ answers: merged, updated_at: new Date() })
    .where(eq(questionnaire_sessions.token, token))
    .returning()
  return c.json(updated)
})

// POST /:token/recommend — public — compute the recommended form from answers
// and persist both the session's recommended_form and a recommendation record.
router.post('/:token/recommend', async (c) => {
  const token = c.req.param('token')
  const [session] = await db
    .select()
    .from(questionnaire_sessions)
    .where(eq(questionnaire_sessions.token, token))
  if (!session) return c.json({ error: 'Not found' }, 404)

  const answers = coerceAnswers(session.answers)
  const rec = recommendForm(answers)

  await db
    .update(questionnaire_sessions)
    .set({ recommended_form: rec.recommended_form, updated_at: new Date() })
    .where(eq(questionnaire_sessions.token, token))

  await db.insert(form_recommendations).values({
    session_id: session.id,
    payee_id: session.payee_id ?? null,
    recommended_form: rec.recommended_form,
    rationale: rec.rationale,
    answers: (session.answers ?? {}) as Record<string, unknown>,
  })

  return c.json(rec)
})

const submitSchema = z.object({
  form_type: z.string().min(1).optional(),
  signer_name: z.string().min(1),
  signer_capacity: z.string().optional(),
  signature_date: z.string().optional(),
  tin: z.string().optional(),
  tin_type: z.string().optional(),
  entity_classification: z.string().optional(),
  chapter3_status: z.string().optional(),
  chapter4_status: z.string().optional(),
  treaty_country: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})

// POST /:token/submit — public — submit the completed form via the portal.
// Creates a form + an immutable document version, supersedes the prior version
// for the same payee, and marks the session completed.
router.post('/:token/submit', zValidator('json', submitSchema), async (c) => {
  const token = c.req.param('token')
  const [session] = await db
    .select()
    .from(questionnaire_sessions)
    .where(eq(questionnaire_sessions.token, token))
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (!session.payee_id) {
    return c.json({ error: 'Session is not bound to a payee' }, 400)
  }

  const [payee] = await db.select().from(payees).where(eq(payees.id, session.payee_id))
  if (!payee) return c.json({ error: 'Payee not found' }, 404)

  const body = c.req.valid('json')

  // Recommend if the portal did not pin a form_type explicitly.
  const rec = recommendForm(coerceAnswers(session.answers))
  const formType = body.form_type ?? session.recommended_form ?? rec.recommended_form

  // W-8 forms are valid through the end of the 3rd calendar year after signing;
  // W-9 forms do not expire on a fixed schedule.
  const signedAt = body.signature_date ? new Date(body.signature_date) : new Date()
  const validThrough =
    formType === 'W-9'
      ? null
      : new Date(Date.UTC(signedAt.getUTCFullYear() + 3, 11, 31, 23, 59, 59))

  // Determine the next version number for this payee.
  const priorForms = await db.select().from(forms).where(eq(forms.payee_id, payee.id))
  const nextVersion =
    priorForms.reduce((max, f) => (f.version > max ? f.version : max), 0) + 1

  // Mark prior non-superseded forms as superseded.
  for (const pf of priorForms) {
    if (pf.status !== 'superseded') {
      await db.update(forms).set({ status: 'superseded' }).where(eq(forms.id, pf.id))
    }
  }

  const [form] = await db
    .insert(forms)
    .values({
      user_id: payee.user_id,
      payee_id: payee.id,
      form_type: formType,
      status: 'submitted',
      signer_name: body.signer_name,
      signer_capacity: body.signer_capacity ?? null,
      signature_date: signedAt,
      tin: body.tin ?? null,
      tin_type: body.tin_type ?? null,
      entity_classification: body.entity_classification ?? null,
      chapter3_status: body.chapter3_status ?? null,
      chapter4_status: body.chapter4_status ?? null,
      treaty_country: body.treaty_country ?? null,
      data: (body.data ?? {}) as Record<string, unknown>,
      valid_through: validThrough,
      version: nextVersion,
      submitted_via: 'portal',
    })
    .returning()

  // Immutable version snapshot.
  await db.insert(document_versions).values({
    user_id: payee.user_id,
    payee_id: payee.id,
    form_id: form.id,
    version: nextVersion,
    form_type: formType,
    verdict: null,
    submitted_by: body.signer_name,
    snapshot: { form, answers: session.answers ?? {} } as Record<string, unknown>,
  })

  // Record the recommendation that backed this submission.
  await db.insert(form_recommendations).values({
    session_id: session.id,
    payee_id: payee.id,
    recommended_form: formType,
    rationale: rec.rationale,
    answers: (session.answers ?? {}) as Record<string, unknown>,
  })

  // Complete the session and stamp the payee compliance state.
  await db
    .update(questionnaire_sessions)
    .set({ status: 'completed', recommended_form: formType, updated_at: new Date() })
    .where(eq(questionnaire_sessions.token, token))

  await db
    .update(payees)
    .set({ compliance_status: 'collected', updated_at: new Date() })
    .where(eq(payees.id, payee.id))

  // Audit trail.
  await db.insert(activity_log).values({
    user_id: payee.user_id,
    payee_id: payee.id,
    action: 'form_submitted_via_portal',
    entity_type: 'form',
    entity_id: form.id,
    detail: `${formType} submitted by ${body.signer_name}`,
    metadata: { token, version: nextVersion } as Record<string, unknown>,
  })

  return c.json({ form, recommendation: rec }, 201)
})

export default router
