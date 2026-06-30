import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  campaigns,
  campaign_targets,
  payees,
  expiry_records,
  forms,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  filter_kind: z.enum(['expiring', 'missing', 'all', 'custom']).optional().default('expiring'),
  payee_ids: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'active', 'completed']).optional(),
})

const remindSchema = z.object({
  payee_id: z.string().min(1),
})

// Resolve the payee ids that match a campaign filter for a given user.
async function resolveTargetPayees(
  userId: string,
  filterKind: string,
  explicitIds?: string[],
): Promise<string[]> {
  if (filterKind === 'custom') {
    if (!explicitIds || explicitIds.length === 0) return []
    // Restrict to payees actually owned by the user.
    const owned = await db
      .select({ id: payees.id })
      .from(payees)
      .where(and(eq(payees.user_id, userId), inArray(payees.id, explicitIds)))
    return owned.map((p) => p.id)
  }

  if (filterKind === 'all') {
    const all = await db
      .select({ id: payees.id })
      .from(payees)
      .where(eq(payees.user_id, userId))
    return all.map((p) => p.id)
  }

  if (filterKind === 'expiring') {
    // Payees with at least one expiry record in the expiring_soon / expired buckets.
    const rows = await db
      .select({ payee_id: expiry_records.payee_id, bucket: expiry_records.bucket })
      .from(expiry_records)
      .where(eq(expiry_records.user_id, userId))
    const ids = new Set<string>()
    for (const r of rows) {
      if (r.bucket === 'expiring_soon' || r.bucket === 'expired') ids.add(r.payee_id)
    }
    return [...ids]
  }

  // filterKind === 'missing' — payees with no forms on file.
  const all = await db
    .select({ id: payees.id })
    .from(payees)
    .where(eq(payees.user_id, userId))
  const withForms = await db
    .select({ payee_id: forms.payee_id })
    .from(forms)
    .where(eq(forms.user_id, userId))
  const haveForms = new Set(withForms.map((f) => f.payee_id))
  return all.map((p) => p.id).filter((id) => !haveForms.has(id))
}

// GET / — list current user's campaigns
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.user_id, userId))
    .orderBy(desc(campaigns.created_at))
  return c.json(rows)
})

// GET /:id — campaign detail incl. targets
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))
  if (!campaign) return c.json({ error: 'Not found' }, 404)
  if (campaign.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const targetRows = await db
    .select({
      id: campaign_targets.id,
      campaign_id: campaign_targets.campaign_id,
      payee_id: campaign_targets.payee_id,
      status: campaign_targets.status,
      reminder_count: campaign_targets.reminder_count,
      last_reminder_at: campaign_targets.last_reminder_at,
      created_at: campaign_targets.created_at,
      vendor_name: payees.vendor_name,
      contact_email: payees.contact_email,
      readiness_state: payees.readiness_state,
    })
    .from(campaign_targets)
    .leftJoin(payees, eq(campaign_targets.payee_id, payees.id))
    .where(eq(campaign_targets.campaign_id, id))
    .orderBy(desc(campaign_targets.created_at))

  return c.json({ campaign, targets: targetRows })
})

// POST / — create campaign + populate targets from filter
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const targetIds = await resolveTargetPayees(userId, body.filter_kind, body.payee_ids)

  const [campaign] = await db
    .insert(campaigns)
    .values({
      user_id: userId,
      name: body.name,
      description: body.description ?? null,
      filter_kind: body.filter_kind,
      status: 'draft',
      invited_count: targetIds.length,
    })
    .returning()

  if (targetIds.length > 0) {
    await db
      .insert(campaign_targets)
      .values(
        targetIds.map((pid) => ({
          campaign_id: campaign.id,
          payee_id: pid,
          status: 'invited',
        })),
      )
      .onConflictDoNothing()
  }

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'campaign.created',
    entity_type: 'campaign',
    entity_id: campaign.id,
    detail: `Created campaign "${campaign.name}" with ${targetIds.length} target(s)`,
    metadata: { filter_kind: body.filter_kind, target_count: targetIds.length },
  })

  return c.json(campaign, 201)
})

// POST /:id/remind — send reminder to a target
router.post('/:id/remind', authMiddleware, zValidator('json', remindSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { payee_id } = c.req.valid('json')

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))
  if (!campaign) return c.json({ error: 'Not found' }, 404)
  if (campaign.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [target] = await db
    .select()
    .from(campaign_targets)
    .where(and(eq(campaign_targets.campaign_id, id), eq(campaign_targets.payee_id, payee_id)))
  if (!target) return c.json({ error: 'Target not found' }, 404)

  const [updated] = await db
    .update(campaign_targets)
    .set({
      reminder_count: target.reminder_count + 1,
      last_reminder_at: new Date(),
    })
    .where(eq(campaign_targets.id, target.id))
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    payee_id,
    action: 'campaign.reminder_sent',
    entity_type: 'campaign',
    entity_id: campaign.id,
    detail: `Reminder #${updated.reminder_count} sent for campaign "${campaign.name}"`,
    metadata: { reminder_count: updated.reminder_count },
  })

  return c.json({ target: updated })
})

// PUT /:id — update campaign (status/name/description)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))
  if (!campaign) return c.json({ error: 'Not found' }, 404)
  if (campaign.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(campaigns)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      updated_at: new Date(),
    })
    .where(eq(campaigns.id, id))
    .returning()

  return c.json(updated)
})

export default router
