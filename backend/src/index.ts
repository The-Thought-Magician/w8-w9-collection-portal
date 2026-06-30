import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, treaty_catalog } from './db/schema.js'

import payeesRoutes from './routes/payees.js'
import formsRoutes from './routes/forms.js'
import validationsRoutes from './routes/validations.js'
import questionnaireRoutes from './routes/questionnaire.js'
import recommendationsRoutes from './routes/recommendations.js'
import expiryRoutes from './routes/expiry.js'
import campaignsRoutes from './routes/campaigns.js'
import readinessRoutes from './routes/readiness.js'
import importsRoutes from './routes/imports.js'
import versionsRoutes from './routes/versions.js'
import exceptionsRoutes from './routes/exceptions.js'
import tinRoutes from './routes/tin.js'
import treatiesRoutes from './routes/treaties.js'
import chaptersRoutes from './routes/chapters.js'
import withholdingRoutes from './routes/withholding.js'
import bnoticesRoutes from './routes/bnotices.js'
import activityRoutes from './routes/activity.js'
import notificationsRoutes from './routes/notifications.js'
import reportsRoutes from './routes/reports.js'
import analyticsRoutes from './routes/analytics.js'
import linksRoutes from './routes/links.js'
import settingsRoutes from './routes/settings.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://w8-w9-collection-portal.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

const seedPlans = [
  { id: 'free', name: 'Free', price_cents: 0 },
  { id: 'pro', name: 'Pro', price_cents: 4900 },
]

const seedTreaties = [
  { country: 'GB', article: '12', income_type: 'royalties', rate: 0, notes: 'US-UK treaty: royalties 0%' },
  { country: 'CA', article: 'XII', income_type: 'royalties', rate: 0, notes: 'US-Canada treaty: royalties 0%' },
  { country: 'DE', article: '12', income_type: 'royalties', rate: 0, notes: 'US-Germany treaty: royalties 0%' },
  { country: 'IN', article: '12', income_type: 'royalties', rate: 15, notes: 'US-India treaty: royalties 15%' },
  { country: 'FR', article: '12', income_type: 'royalties', rate: 0, notes: 'US-France treaty: royalties 0%' },
  { country: 'JP', article: '12', income_type: 'royalties', rate: 0, notes: 'US-Japan treaty: royalties 0%' },
  { country: 'AU', article: '12', income_type: 'royalties', rate: 5, notes: 'US-Australia treaty: royalties 5%' },
  { country: 'IE', article: '12', income_type: 'royalties', rate: 0, notes: 'US-Ireland treaty: royalties 0%' },
  { country: 'NL', article: '12', income_type: 'royalties', rate: 0, notes: 'US-Netherlands treaty: royalties 0%' },
  { country: 'CN', article: '11', income_type: 'royalties', rate: 10, notes: 'US-China treaty: royalties 10%' },
]

async function seedIfEmpty() {
  // Plans (idempotent: count-then-insert).
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    for (const p of seedPlans) {
      await db.insert(plans).values(p as any)
    }
    console.log('Seeded plans')
  }
  // Global treaty catalog demo rows.
  const existingTreaties = await db.select().from(treaty_catalog).limit(1)
  if (existingTreaties.length === 0) {
    for (const t of seedTreaties) {
      await db.insert(treaty_catalog).values(t as any)
    }
    console.log('Seeded treaty catalog')
  }
}

const api = new Hono()
api.route('/payees', payeesRoutes)
api.route('/forms', formsRoutes)
api.route('/validations', validationsRoutes)
api.route('/questionnaire', questionnaireRoutes)
api.route('/recommendations', recommendationsRoutes)
api.route('/expiry', expiryRoutes)
api.route('/campaigns', campaignsRoutes)
api.route('/readiness', readinessRoutes)
api.route('/imports', importsRoutes)
api.route('/versions', versionsRoutes)
api.route('/exceptions', exceptionsRoutes)
api.route('/tin', tinRoutes)
api.route('/treaties', treatiesRoutes)
api.route('/chapters', chaptersRoutes)
api.route('/withholding', withholdingRoutes)
api.route('/bnotices', bnoticesRoutes)
api.route('/activity', activityRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/reports', reportsRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/links', linksRoutes)
api.route('/settings', settingsRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check detects
// a live service immediately, THEN run migrate() and seedIfEmpty() (both
// idempotent). Never block serve() on a slow/cold DB connection.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
