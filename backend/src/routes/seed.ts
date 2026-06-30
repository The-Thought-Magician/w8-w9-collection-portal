import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  payees,
  forms,
  expiry_records,
  readiness_states,
  validations,
  validation_checks,
  activity_log,
  notifications,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const DAY_MS = 86_400_000

/** Compute days remaining + bucket from a valid_through date relative to now. */
function bucketFor(validThrough: Date | null, expiringSoonDays = 90): {
  days_remaining: number | null
  bucket: string
} {
  if (!validThrough) return { days_remaining: null, bucket: 'no_expiry' }
  const days = Math.round((validThrough.getTime() - Date.now()) / DAY_MS)
  let bucket = 'valid'
  if (days < 0) bucket = 'expired'
  else if (days <= expiringSoonDays) bucket = 'expiring_soon'
  return { days_remaining: days, bucket }
}

interface SamplePayee {
  vendor_name: string
  legal_name: string
  contact_email: string
  country: string
  is_us_person: boolean
  vendor_type: string
  expected_annual_spend_cents: number
  external_ref: string
  notes: string
  readiness_state: string
  compliance_status: string
  // Form spec (optional — some payees have no form on file)
  form?: {
    form_type: string
    status: string
    signer_name: string
    signer_capacity: string
    tin: string | null
    tin_type: string | null
    entity_classification: string | null
    chapter3_status: string | null
    chapter4_status: string | null
    treaty_country: string | null
    // days from now until valid_through; null = no expiry (W-9)
    validThroughDays: number | null
    verdict: 'pass' | 'warning' | 'error'
  }
}

const SAMPLE_PAYEES: SamplePayee[] = [
  {
    vendor_name: 'Acme Consulting LLC',
    legal_name: 'Acme Consulting LLC',
    contact_email: 'ap@acmeconsulting.example',
    country: 'US',
    is_us_person: true,
    vendor_type: 'business',
    expected_annual_spend_cents: 12_000_00,
    external_ref: 'VND-1001',
    notes: 'Domestic professional services vendor.',
    readiness_state: 'green',
    compliance_status: 'compliant',
    form: {
      form_type: 'W-9',
      status: 'valid',
      signer_name: 'Jane Acme',
      signer_capacity: 'Managing Member',
      tin: '94-3217654',
      tin_type: 'EIN',
      entity_classification: 'LLC',
      chapter3_status: null,
      chapter4_status: null,
      treaty_country: null,
      validThroughDays: null,
      verdict: 'pass',
    },
  },
  {
    vendor_name: 'Brightline Studios',
    legal_name: 'Brightline Studios Inc',
    contact_email: 'finance@brightline.example',
    country: 'US',
    is_us_person: true,
    vendor_type: 'business',
    expected_annual_spend_cents: 4_500_00,
    external_ref: 'VND-1002',
    notes: 'Creative agency, US corporation.',
    readiness_state: 'green',
    compliance_status: 'compliant',
    form: {
      form_type: 'W-9',
      status: 'valid',
      signer_name: 'Marcus Reed',
      signer_capacity: 'CFO',
      tin: '81-4456120',
      tin_type: 'EIN',
      entity_classification: 'C Corporation',
      chapter3_status: null,
      chapter4_status: null,
      treaty_country: null,
      validThroughDays: null,
      verdict: 'pass',
    },
  },
  {
    vendor_name: 'Helena Vogel',
    legal_name: 'Helena Vogel',
    contact_email: 'helena.vogel@example.de',
    country: 'DE',
    is_us_person: false,
    vendor_type: 'individual',
    expected_annual_spend_cents: 2_800_00,
    external_ref: 'VND-1003',
    notes: 'German freelance designer claiming treaty benefits.',
    readiness_state: 'green',
    compliance_status: 'compliant',
    form: {
      form_type: 'W-8BEN',
      status: 'valid',
      signer_name: 'Helena Vogel',
      signer_capacity: 'Individual',
      tin: null,
      tin_type: 'FOREIGN',
      entity_classification: null,
      chapter3_status: 'Individual',
      chapter4_status: null,
      treaty_country: 'DE',
      validThroughDays: 45,
      verdict: 'warning',
    },
  },
  {
    vendor_name: 'Nordwind GmbH',
    legal_name: 'Nordwind Software GmbH',
    contact_email: 'billing@nordwind.example.de',
    country: 'DE',
    is_us_person: false,
    vendor_type: 'business',
    expected_annual_spend_cents: 18_000_00,
    external_ref: 'VND-1004',
    notes: 'German software vendor, FATCA chapter 4 status required.',
    readiness_state: 'yellow',
    compliance_status: 'review',
    form: {
      form_type: 'W-8BEN-E',
      status: 'submitted',
      signer_name: 'Klaus Berger',
      signer_capacity: 'Geschäftsführer',
      tin: null,
      tin_type: 'FOREIGN',
      entity_classification: 'Corporation',
      chapter3_status: 'Corporation',
      chapter4_status: 'Active NFFE',
      treaty_country: 'DE',
      validThroughDays: 1090,
      verdict: 'warning',
    },
  },
  {
    vendor_name: 'Sato Logistics',
    legal_name: 'Sato Logistics K.K.',
    contact_email: 'accounts@sato-logistics.example.jp',
    country: 'JP',
    is_us_person: false,
    vendor_type: 'business',
    expected_annual_spend_cents: 9_200_00,
    external_ref: 'VND-1005',
    notes: 'Japanese logistics partner with US-effectively-connected income.',
    readiness_state: 'yellow',
    compliance_status: 'review',
    form: {
      form_type: 'W-8ECI',
      status: 'submitted',
      signer_name: 'Akira Sato',
      signer_capacity: 'President',
      tin: '98-7654321',
      tin_type: 'EIN',
      entity_classification: 'Corporation',
      chapter3_status: 'Corporation',
      chapter4_status: null,
      treaty_country: 'JP',
      validThroughDays: -10,
      verdict: 'error',
    },
  },
  {
    vendor_name: 'Riverstone Partners',
    legal_name: 'Riverstone Partners LP',
    contact_email: 'tax@riverstone.example',
    country: 'US',
    is_us_person: true,
    vendor_type: 'partnership',
    expected_annual_spend_cents: 33_500_00,
    external_ref: 'VND-1006',
    notes: 'Domestic partnership, intermediary structure.',
    readiness_state: 'yellow',
    compliance_status: 'review',
    form: {
      form_type: 'W-8IMY',
      status: 'submitted',
      signer_name: 'Dana Cole',
      signer_capacity: 'General Partner',
      tin: '45-0091234',
      tin_type: 'EIN',
      entity_classification: 'Partnership',
      chapter3_status: 'Partnership',
      chapter4_status: 'Participating FFI',
      treaty_country: null,
      validThroughDays: 30,
      verdict: 'warning',
    },
  },
  {
    vendor_name: 'Priya Nair',
    legal_name: 'Priya Nair',
    contact_email: 'priya.nair@example.in',
    country: 'IN',
    is_us_person: false,
    vendor_type: 'individual',
    expected_annual_spend_cents: 1_500_00,
    external_ref: 'VND-1007',
    notes: 'Indian contractor, no documentation on file yet.',
    readiness_state: 'red',
    compliance_status: 'none',
  },
  {
    vendor_name: 'Summit Hardware Co',
    legal_name: 'Summit Hardware Company',
    contact_email: 'ar@summithardware.example',
    country: 'US',
    is_us_person: true,
    vendor_type: 'business',
    expected_annual_spend_cents: 7_800_00,
    external_ref: 'VND-1008',
    notes: 'Domestic supplier, awaiting W-9.',
    readiness_state: 'red',
    compliance_status: 'none',
  },
]

// POST / — seed a sample payee book for the current user (idempotent: skips if user already has payees)
router.post('/', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const existing = await db.select({ id: payees.id }).from(payees).where(eq(payees.user_id, userId)).limit(1)
  if (existing.length > 0) {
    return c.json({ created: 0, message: 'Sample data already present; skipped.' })
  }

  let created = 0
  for (const sp of SAMPLE_PAYEES) {
    const [payee] = await db
      .insert(payees)
      .values({
        user_id: userId,
        vendor_name: sp.vendor_name,
        legal_name: sp.legal_name,
        contact_email: sp.contact_email,
        country: sp.country,
        is_us_person: sp.is_us_person,
        vendor_type: sp.vendor_type,
        expected_annual_spend_cents: sp.expected_annual_spend_cents,
        external_ref: sp.external_ref,
        notes: sp.notes,
        readiness_state: sp.readiness_state,
        compliance_status: sp.compliance_status,
      })
      .returning()
    created += 1

    await db.insert(activity_log).values({
      user_id: userId,
      payee_id: payee.id,
      action: 'payee.created',
      entity_type: 'payee',
      entity_id: payee.id,
      detail: `Seeded sample payee ${sp.vendor_name}`,
      metadata: { source: 'seed' },
    })

    if (sp.form) {
      const f = sp.form
      const validThrough = f.validThroughDays === null ? null : new Date(Date.now() + f.validThroughDays * DAY_MS)
      const signatureDate = new Date(Date.now() - 30 * DAY_MS)

      const [form] = await db
        .insert(forms)
        .values({
          user_id: userId,
          payee_id: payee.id,
          form_type: f.form_type,
          status: f.status,
          signer_name: f.signer_name,
          signer_capacity: f.signer_capacity,
          signature_date: signatureDate,
          tin: f.tin,
          tin_type: f.tin_type,
          entity_classification: f.entity_classification,
          chapter3_status: f.chapter3_status,
          chapter4_status: f.chapter4_status,
          treaty_country: f.treaty_country,
          data: { seeded: true },
          valid_through: validThrough,
          version: 1,
          submitted_via: 'import',
        })
        .returning()

      // Expiry record
      const { days_remaining, bucket } = bucketFor(validThrough)
      await db.insert(expiry_records).values({
        user_id: userId,
        form_id: form.id,
        payee_id: payee.id,
        valid_through: validThrough,
        days_remaining,
        bucket,
      })

      // Validation run + checks
      const errorCount = f.verdict === 'error' ? 1 : 0
      const warningCount = f.verdict === 'warning' ? 1 : 0
      const [validation] = await db
        .insert(validations)
        .values({
          user_id: userId,
          form_id: form.id,
          payee_id: payee.id,
          verdict: f.verdict,
          error_count: errorCount,
          warning_count: warningCount,
          summary:
            f.verdict === 'pass'
              ? 'All checks passed'
              : f.verdict === 'warning'
                ? 'Form valid with advisories'
                : 'Form has blocking errors',
        })
        .returning()

      const checks: { check_key: string; severity: string; message: string }[] = [
        { check_key: 'signature_present', severity: 'pass', message: 'Signature and date present.' },
        {
          check_key: 'tin_present',
          severity: f.tin || f.tin_type === 'FOREIGN' ? 'pass' : 'error',
          message: f.tin || f.tin_type === 'FOREIGN' ? 'TIN provided or foreign exemption.' : 'Missing TIN.',
        },
      ]
      if (f.verdict === 'warning') {
        checks.push({
          check_key: 'expiry_horizon',
          severity: 'warning',
          message: 'Form is approaching its validity expiration.',
        })
      }
      if (f.verdict === 'error') {
        checks.push({
          check_key: 'form_expired',
          severity: 'error',
          message: 'Form validity period has lapsed; recertification required.',
        })
      }
      for (const ch of checks) {
        await db.insert(validation_checks).values({
          validation_id: validation.id,
          check_key: ch.check_key,
          severity: ch.severity,
          message: ch.message,
        })
      }
    }

    // Readiness state (one per payee)
    const blocked = sp.readiness_state === 'red'
    await db.insert(readiness_states).values({
      user_id: userId,
      payee_id: payee.id,
      state: sp.readiness_state,
      reason:
        sp.readiness_state === 'green'
          ? 'Valid documentation on file'
          : sp.readiness_state === 'yellow'
            ? 'Documentation needs review or is expiring'
            : 'Missing or expired documentation',
      blocked_amount_cents: blocked ? sp.expected_annual_spend_cents : 0,
      is_payment_blocked: blocked,
    })
  }

  await db.insert(notifications).values({
    user_id: userId,
    kind: 'info',
    title: 'Sample payee book loaded',
    body: `Seeded ${created} sample payees so you can explore the portal.`,
    link: '/dashboard/payees',
  })

  return c.json({ created })
})

// GET /status — whether the user has any payees
router.get('/status', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db.select({ id: payees.id }).from(payees).where(eq(payees.user_id, userId)).limit(1)
  return c.json({ seeded: rows.length > 0 })
})

export default router
