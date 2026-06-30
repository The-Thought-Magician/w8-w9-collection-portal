import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { org_settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const settingsSchema = z.object({
  org_name: z.string().min(1).max(200).optional(),
  expiring_soon_days: z.number().int().min(1).max(3650).optional(),
  default_withholding_rate: z.number().min(0).max(100).optional(),
  backup_withholding_rate: z.number().min(0).max(100).optional(),
  tax_year: z.number().int().min(2000).max(2200).optional(),
})

/** Fetch the current user's org settings, auto-creating a default row if none exists. */
async function getOrCreateSettings(userId: string) {
  const [existing] = await db.select().from(org_settings).where(eq(org_settings.user_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(org_settings)
    .values({ user_id: userId })
    .onConflictDoNothing({ target: org_settings.user_id })
    .returning()
  if (created) return created
  // Conflict race: another request inserted first — read it back.
  const [row] = await db.select().from(org_settings).where(eq(org_settings.user_id, userId))
  return row
}

// GET / — get org settings (auto-create default)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const settings = await getOrCreateSettings(userId)
  return c.json(settings)
})

// PUT / — update org settings
router.put('/', authMiddleware, zValidator('json', settingsSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  // Ensure a row exists for this user before updating.
  await getOrCreateSettings(userId)
  const [updated] = await db
    .update(org_settings)
    .set({ ...body, updated_at: new Date() })
    .where(eq(org_settings.user_id, userId))
    .returning()
  return c.json(updated)
})

export default router
