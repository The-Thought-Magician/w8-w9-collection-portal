import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { roster_imports, import_rows, payees, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const rowSchema = z.object({
  vendor_name: z.string().min(1),
  legal_name: z.string().optional(),
  contact_email: z.string().optional(),
  country: z.string().optional(),
  is_us_person: z.boolean().optional(),
  vendor_type: z.string().optional(),
  expected_annual_spend_cents: z.number().int().optional(),
  external_ref: z.string().optional(),
  notes: z.string().optional(),
})

const previewSchema = z.object({
  filename: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

// Normalize an arbitrary inbound row into a canonical payee-shaped object.
function normalizeRow(raw: Record<string, unknown>) {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      for (const actual of Object.keys(raw)) {
        if (actual.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, '')) {
          return raw[actual]
        }
      }
    }
    return undefined
  }
  const str = (v: unknown): string | undefined =>
    v === undefined || v === null || v === '' ? undefined : String(v)

  const vendorName = str(get('vendor_name', 'vendorname', 'name', 'vendor'))
  const countryRaw = str(get('country', 'countrycode'))
  const country = countryRaw ? countryRaw.toUpperCase() : undefined
  const isUsRaw = get('is_us_person', 'isusperson', 'usperson', 'us')
  let isUsPerson: boolean | undefined
  if (typeof isUsRaw === 'boolean') isUsPerson = isUsRaw
  else if (typeof isUsRaw === 'string') isUsPerson = /^(true|yes|y|1|us)$/i.test(isUsRaw)
  else if (country) isUsPerson = country === 'US'

  const spendRaw = get('expected_annual_spend_cents', 'expectedannualspendcents', 'spend_cents', 'annualspend')
  let spendCents: number | undefined
  if (typeof spendRaw === 'number' && Number.isFinite(spendRaw)) spendCents = Math.round(spendRaw)
  else if (typeof spendRaw === 'string' && spendRaw.trim() !== '') {
    const n = Number(spendRaw.replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n)) spendCents = Math.round(n)
  }

  return {
    vendor_name: vendorName,
    legal_name: str(get('legal_name', 'legalname')),
    contact_email: str(get('contact_email', 'email', 'contactemail')),
    country,
    is_us_person: isUsPerson,
    vendor_type: str(get('vendor_type', 'vendortype', 'type')),
    expected_annual_spend_cents: spendCents,
    external_ref: str(get('external_ref', 'externalref', 'ref', 'id')),
    notes: str(get('notes', 'note')),
  }
}

// GET / — list import batches
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(roster_imports)
    .where(eq(roster_imports.user_id, userId))
    .orderBy(desc(roster_imports.created_at))
  return c.json(rows)
})

// POST /preview — parse rows + reconcile against existing payees
router.post('/preview', authMiddleware, zValidator('json', previewSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const existing = await db
    .select({
      id: payees.id,
      vendor_name: payees.vendor_name,
      external_ref: payees.external_ref,
      contact_email: payees.contact_email,
    })
    .from(payees)
    .where(eq(payees.user_id, userId))

  const byRef = new Map<string, string>()
  const byEmail = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const p of existing) {
    if (p.external_ref) byRef.set(p.external_ref.toLowerCase(), p.id)
    if (p.contact_email) byEmail.set(p.contact_email.toLowerCase(), p.id)
    byName.set(p.vendor_name.toLowerCase(), p.id)
  }

  let newCount = 0
  let existingCount = 0
  let conflictCount = 0

  const evaluated = body.rows.map((raw, idx) => {
    const norm = normalizeRow(raw)
    let reconcile_status: 'new' | 'existing' | 'conflict' | 'error' = 'new'
    let message: string | null = null
    let matched: string | null = null

    if (!norm.vendor_name) {
      reconcile_status = 'error'
      message = 'Missing vendor_name'
    } else {
      const refMatch = norm.external_ref ? byRef.get(norm.external_ref.toLowerCase()) : undefined
      const emailMatch = norm.contact_email ? byEmail.get(norm.contact_email.toLowerCase()) : undefined
      const nameMatch = byName.get(norm.vendor_name.toLowerCase())

      const matches = new Set<string>()
      if (refMatch) matches.add(refMatch)
      if (emailMatch) matches.add(emailMatch)
      if (nameMatch) matches.add(nameMatch)

      if (matches.size === 0) {
        reconcile_status = 'new'
      } else if (matches.size === 1) {
        reconcile_status = 'existing'
        matched = [...matches][0]
        message = 'Matches an existing payee'
      } else {
        reconcile_status = 'conflict'
        matched = refMatch ?? emailMatch ?? nameMatch ?? null
        message = 'Ambiguous: matched multiple existing payees'
      }
    }

    if (reconcile_status === 'new') newCount += 1
    else if (reconcile_status === 'existing') existingCount += 1
    else if (reconcile_status === 'conflict') conflictCount += 1

    return { idx, raw, norm, reconcile_status, message, matched }
  })

  const [batch] = await db
    .insert(roster_imports)
    .values({
      user_id: userId,
      filename: body.filename ?? null,
      status: 'preview',
      total_rows: body.rows.length,
      new_count: newCount,
      existing_count: existingCount,
      conflict_count: conflictCount,
    })
    .returning()

  const insertedRows = await db
    .insert(import_rows)
    .values(
      evaluated.map((e) => ({
        import_id: batch.id,
        row_index: e.idx,
        raw: { ...e.raw, _normalized: e.norm } as Record<string, unknown>,
        reconcile_status: e.reconcile_status,
        message: e.message,
        matched_payee_id: e.matched,
      })),
    )
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'import.previewed',
    entity_type: 'roster_import',
    entity_id: batch.id,
    detail: `Previewed ${body.rows.length} row(s): ${newCount} new, ${existingCount} existing, ${conflictCount} conflict`,
    metadata: { new_count: newCount, existing_count: existingCount, conflict_count: conflictCount },
  })

  return c.json({ import: batch, rows: insertedRows })
})

// POST /:id/commit — commit preview, creating new payees
router.post('/:id/commit', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [batch] = await db.select().from(roster_imports).where(eq(roster_imports.id, id))
  if (!batch) return c.json({ error: 'Not found' }, 404)
  if (batch.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  if (batch.status === 'committed') return c.json({ error: 'Import already committed' }, 409)

  const rows = await db
    .select()
    .from(import_rows)
    .where(and(eq(import_rows.import_id, id), eq(import_rows.reconcile_status, 'new')))

  let created = 0
  for (const row of rows) {
    const raw = (row.raw ?? {}) as Record<string, unknown>
    const norm = (raw._normalized as ReturnType<typeof normalizeRow> | undefined) ?? normalizeRow(raw)
    if (!norm.vendor_name) continue

    const [payee] = await db
      .insert(payees)
      .values({
        user_id: userId,
        vendor_name: norm.vendor_name,
        legal_name: norm.legal_name ?? null,
        contact_email: norm.contact_email ?? null,
        country: norm.country ?? 'US',
        is_us_person: norm.is_us_person ?? true,
        vendor_type: norm.vendor_type ?? 'individual',
        expected_annual_spend_cents: norm.expected_annual_spend_cents ?? 0,
        external_ref: norm.external_ref ?? null,
        notes: norm.notes ?? null,
      })
      .returning()

    await db
      .update(import_rows)
      .set({ matched_payee_id: payee.id })
      .where(eq(import_rows.id, row.id))

    created += 1
  }

  await db
    .update(roster_imports)
    .set({ status: 'committed' })
    .where(eq(roster_imports.id, id))

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'import.committed',
    entity_type: 'roster_import',
    entity_id: id,
    detail: `Committed import, created ${created} new payee(s)`,
    metadata: { created },
  })

  return c.json({ created })
})

export default router
