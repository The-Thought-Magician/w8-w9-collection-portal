import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Payees
// ---------------------------------------------------------------------------
export const payees = pgTable('payees', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  vendor_name: text('vendor_name').notNull(),
  legal_name: text('legal_name'),
  contact_email: text('contact_email'),
  country: text('country').notNull().default('US'),
  is_us_person: boolean('is_us_person').default(true).notNull(),
  vendor_type: text('vendor_type').notNull().default('individual'),
  expected_annual_spend_cents: integer('expected_annual_spend_cents').default(0).notNull(),
  external_ref: text('external_ref'),
  notes: text('notes'),
  readiness_state: text('readiness_state').notNull().default('red'),
  compliance_status: text('compliance_status').notNull().default('none'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Forms (immutable submitted W-9 / W-8 records)
// ---------------------------------------------------------------------------
export const forms = pgTable('forms', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  form_type: text('form_type').notNull(), // W-9 | W-8BEN | W-8BEN-E | W-8ECI | W-8IMY
  status: text('status').notNull().default('submitted'), // submitted | valid | invalid | superseded | expired
  signer_name: text('signer_name'),
  signer_capacity: text('signer_capacity'),
  signature_date: timestamp('signature_date'),
  tin: text('tin'),
  tin_type: text('tin_type'), // SSN | EIN | ITIN | FOREIGN
  entity_classification: text('entity_classification'),
  chapter3_status: text('chapter3_status'),
  chapter4_status: text('chapter4_status'),
  treaty_country: text('treaty_country'),
  data: jsonb('data').$type<Record<string, unknown>>().default({}),
  valid_through: timestamp('valid_through'),
  version: integer('version').default(1).notNull(),
  submitted_via: text('submitted_via').notNull().default('portal'), // portal | manual | import
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Normalized form line-item fields
// ---------------------------------------------------------------------------
export const form_fields = pgTable('form_fields', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  form_id: text('form_id').notNull().references(() => forms.id),
  field_key: text('field_key').notNull(),
  field_value: text('field_value'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Validations (one run per form)
// ---------------------------------------------------------------------------
export const validations = pgTable('validations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  form_id: text('form_id').notNull().references(() => forms.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  verdict: text('verdict').notNull().default('pass'), // pass | warning | error
  error_count: integer('error_count').default(0).notNull(),
  warning_count: integer('warning_count').default(0).notNull(),
  summary: text('summary'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const validation_checks = pgTable('validation_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  validation_id: text('validation_id').notNull().references(() => validations.id),
  check_key: text('check_key').notNull(),
  severity: text('severity').notNull().default('pass'), // pass | warning | error
  message: text('message').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Questionnaire sessions (payee portal)
// ---------------------------------------------------------------------------
export const questionnaire_sessions = pgTable('questionnaire_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payee_id: text('payee_id').references(() => payees.id),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('in_progress'), // in_progress | completed | abandoned
  answers: jsonb('answers').$type<Record<string, unknown>>().default({}),
  recommended_form: text('recommended_form'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Form recommendations (recorded form-selection outputs)
// ---------------------------------------------------------------------------
export const form_recommendations = pgTable('form_recommendations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  session_id: text('session_id').references(() => questionnaire_sessions.id),
  payee_id: text('payee_id').references(() => payees.id),
  recommended_form: text('recommended_form').notNull(),
  rationale: text('rationale').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Expiry records (computed readiness per form)
// ---------------------------------------------------------------------------
export const expiry_records = pgTable('expiry_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  form_id: text('form_id').notNull().references(() => forms.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  valid_through: timestamp('valid_through'),
  days_remaining: integer('days_remaining'),
  bucket: text('bucket').notNull().default('valid'), // valid | expiring_soon | expired | no_expiry
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Recertification campaigns
// ---------------------------------------------------------------------------
export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  filter_kind: text('filter_kind').notNull().default('expiring'), // expiring | missing | all | custom
  status: text('status').notNull().default('draft'), // draft | active | completed
  invited_count: integer('invited_count').default(0).notNull(),
  opened_count: integer('opened_count').default(0).notNull(),
  submitted_count: integer('submitted_count').default(0).notNull(),
  completed_count: integer('completed_count').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const campaign_targets = pgTable('campaign_targets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  campaign_id: text('campaign_id').notNull().references(() => campaigns.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  status: text('status').notNull().default('invited'), // invited | opened | submitted | completed
  reminder_count: integer('reminder_count').default(0).notNull(),
  last_reminder_at: timestamp('last_reminder_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.campaign_id, t.payee_id)])

// ---------------------------------------------------------------------------
// Readiness states (computed payment-block state per payee)
// ---------------------------------------------------------------------------
export const readiness_states = pgTable('readiness_states', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id).unique(),
  state: text('state').notNull().default('red'), // green | yellow | red
  reason: text('reason'),
  blocked_amount_cents: integer('blocked_amount_cents').default(0).notNull(),
  is_payment_blocked: boolean('is_payment_blocked').default(true).notNull(),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Bulk roster imports
// ---------------------------------------------------------------------------
export const roster_imports = pgTable('roster_imports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  filename: text('filename'),
  status: text('status').notNull().default('preview'), // preview | committed
  total_rows: integer('total_rows').default(0).notNull(),
  new_count: integer('new_count').default(0).notNull(),
  existing_count: integer('existing_count').default(0).notNull(),
  conflict_count: integer('conflict_count').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const import_rows = pgTable('import_rows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  import_id: text('import_id').notNull().references(() => roster_imports.id),
  row_index: integer('row_index').notNull(),
  raw: jsonb('raw').$type<Record<string, unknown>>().default({}),
  reconcile_status: text('reconcile_status').notNull().default('new'), // new | existing | conflict | error
  message: text('message'),
  matched_payee_id: text('matched_payee_id'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Immutable document version history
// ---------------------------------------------------------------------------
export const document_versions = pgTable('document_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  form_id: text('form_id').notNull().references(() => forms.id),
  version: integer('version').notNull(),
  form_type: text('form_type').notNull(),
  verdict: text('verdict'),
  superseded_by: text('superseded_by'),
  submitted_by: text('submitted_by'),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Validation exception queue
// ---------------------------------------------------------------------------
export const exceptions = pgTable('exceptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  form_id: text('form_id').references(() => forms.id),
  validation_id: text('validation_id').references(() => validations.id),
  kind: text('kind').notNull().default('validation'), // validation | tin_mismatch | expiry | bnotice
  severity: text('severity').notNull().default('error'), // warning | error
  message: text('message').notNull(),
  status: text('status').notNull().default('open'), // open | resolved | waived
  assignee: text('assignee'),
  resolution_note: text('resolution_note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// TIN checks
// ---------------------------------------------------------------------------
export const tin_checks = pgTable('tin_checks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  form_id: text('form_id').notNull().references(() => forms.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  tin_type: text('tin_type'),
  structural_valid: boolean('structural_valid').default(false).notNull(),
  name_tin_match: text('name_tin_match').notNull().default('unchecked'), // match | mismatch | unchecked
  message: text('message'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Treaty claims + catalog
// ---------------------------------------------------------------------------
export const treaty_claims = pgTable('treaty_claims', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  form_id: text('form_id').notNull().references(() => forms.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  country: text('country').notNull(),
  article: text('article'),
  rate: real('rate'),
  income_type: text('income_type'),
  is_valid: boolean('is_valid').default(false).notNull(),
  message: text('message'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const treaty_catalog = pgTable('treaty_catalog', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  country: text('country').notNull().unique(),
  article: text('article'),
  income_type: text('income_type'),
  rate: real('rate'),
  notes: text('notes'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Chapter 3 / Chapter 4 (FATCA) statuses
// ---------------------------------------------------------------------------
export const chapter_statuses = pgTable('chapter_statuses', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  form_id: text('form_id').notNull().references(() => forms.id),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  chapter3_status: text('chapter3_status'),
  chapter4_status: text('chapter4_status'),
  is_consistent: boolean('is_consistent').default(true).notNull(),
  message: text('message'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Withholding determinations
// ---------------------------------------------------------------------------
export const withholding_determinations = pgTable('withholding_determinations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  form_id: text('form_id').references(() => forms.id),
  income_type: text('income_type').notNull().default('royalties'),
  base_rate: real('base_rate').notNull().default(30),
  applied_rate: real('applied_rate').notNull().default(30),
  treaty_applied: boolean('treaty_applied').default(false).notNull(),
  estimated_withholding_cents: integer('estimated_withholding_cents').default(0).notNull(),
  rationale: text('rationale'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// B-notices
// ---------------------------------------------------------------------------
export const bnotices = pgTable('bnotices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  notice_kind: text('notice_kind').notNull().default('first'), // first | second
  received_date: timestamp('received_date'),
  status: text('status').notNull().default('open'), // open | resolved
  note: text('note'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Tokenized document request links
// ---------------------------------------------------------------------------
export const request_links = pgTable('request_links', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id').notNull().references(() => payees.id),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('sent'), // sent | opened | submitted | revoked
  opened_at: timestamp('opened_at'),
  submitted_at: timestamp('submitted_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Append-only activity log
// ---------------------------------------------------------------------------
export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  payee_id: text('payee_id'),
  action: text('action').notNull(),
  entity_type: text('entity_type'),
  entity_id: text('entity_id'),
  detail: text('detail'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull().default('info'),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Organization settings (per user)
// ---------------------------------------------------------------------------
export const org_settings = pgTable('org_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  org_name: text('org_name').notNull().default('My Organization'),
  expiring_soon_days: integer('expiring_soon_days').default(90).notNull(),
  default_withholding_rate: real('default_withholding_rate').default(30).notNull(),
  backup_withholding_rate: real('backup_withholding_rate').default(24).notNull(),
  tax_year: integer('tax_year').default(2026).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing: plans + subscriptions
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
