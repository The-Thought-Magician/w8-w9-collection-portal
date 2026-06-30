import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  // payees
  `CREATE TABLE IF NOT EXISTS payees (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    vendor_name text NOT NULL,
    legal_name text,
    contact_email text,
    country text NOT NULL DEFAULT 'US',
    is_us_person boolean NOT NULL DEFAULT true,
    vendor_type text NOT NULL DEFAULT 'individual',
    expected_annual_spend_cents integer NOT NULL DEFAULT 0,
    external_ref text,
    notes text,
    readiness_state text NOT NULL DEFAULT 'red',
    compliance_status text NOT NULL DEFAULT 'none',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // forms
  `CREATE TABLE IF NOT EXISTS forms (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    form_type text NOT NULL,
    status text NOT NULL DEFAULT 'submitted',
    signer_name text,
    signer_capacity text,
    signature_date timestamptz,
    tin text,
    tin_type text,
    entity_classification text,
    chapter3_status text,
    chapter4_status text,
    treaty_country text,
    data jsonb DEFAULT '{}'::jsonb,
    valid_through timestamptz,
    version integer NOT NULL DEFAULT 1,
    submitted_via text NOT NULL DEFAULT 'portal',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // form_fields
  `CREATE TABLE IF NOT EXISTS form_fields (
    id text PRIMARY KEY,
    form_id text NOT NULL REFERENCES forms(id),
    field_key text NOT NULL,
    field_value text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // validations
  `CREATE TABLE IF NOT EXISTS validations (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    form_id text NOT NULL REFERENCES forms(id),
    payee_id text NOT NULL REFERENCES payees(id),
    verdict text NOT NULL DEFAULT 'pass',
    error_count integer NOT NULL DEFAULT 0,
    warning_count integer NOT NULL DEFAULT 0,
    summary text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // validation_checks
  `CREATE TABLE IF NOT EXISTS validation_checks (
    id text PRIMARY KEY,
    validation_id text NOT NULL REFERENCES validations(id),
    check_key text NOT NULL,
    severity text NOT NULL DEFAULT 'pass',
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // questionnaire_sessions
  `CREATE TABLE IF NOT EXISTS questionnaire_sessions (
    id text PRIMARY KEY,
    payee_id text REFERENCES payees(id),
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'in_progress',
    answers jsonb DEFAULT '{}'::jsonb,
    recommended_form text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // form_recommendations
  `CREATE TABLE IF NOT EXISTS form_recommendations (
    id text PRIMARY KEY,
    session_id text REFERENCES questionnaire_sessions(id),
    payee_id text REFERENCES payees(id),
    recommended_form text NOT NULL,
    rationale text NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // expiry_records
  `CREATE TABLE IF NOT EXISTS expiry_records (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    form_id text NOT NULL REFERENCES forms(id),
    payee_id text NOT NULL REFERENCES payees(id),
    valid_through timestamptz,
    days_remaining integer,
    bucket text NOT NULL DEFAULT 'valid',
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  // campaigns
  `CREATE TABLE IF NOT EXISTS campaigns (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    description text,
    filter_kind text NOT NULL DEFAULT 'expiring',
    status text NOT NULL DEFAULT 'draft',
    invited_count integer NOT NULL DEFAULT 0,
    opened_count integer NOT NULL DEFAULT 0,
    submitted_count integer NOT NULL DEFAULT 0,
    completed_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // campaign_targets
  `CREATE TABLE IF NOT EXISTS campaign_targets (
    id text PRIMARY KEY,
    campaign_id text NOT NULL REFERENCES campaigns(id),
    payee_id text NOT NULL REFERENCES payees(id),
    status text NOT NULL DEFAULT 'invited',
    reminder_count integer NOT NULL DEFAULT 0,
    last_reminder_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, payee_id)
  )`,

  // readiness_states
  `CREATE TABLE IF NOT EXISTS readiness_states (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id) UNIQUE,
    state text NOT NULL DEFAULT 'red',
    reason text,
    blocked_amount_cents integer NOT NULL DEFAULT 0,
    is_payment_blocked boolean NOT NULL DEFAULT true,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  // roster_imports
  `CREATE TABLE IF NOT EXISTS roster_imports (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    filename text,
    status text NOT NULL DEFAULT 'preview',
    total_rows integer NOT NULL DEFAULT 0,
    new_count integer NOT NULL DEFAULT 0,
    existing_count integer NOT NULL DEFAULT 0,
    conflict_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // import_rows
  `CREATE TABLE IF NOT EXISTS import_rows (
    id text PRIMARY KEY,
    import_id text NOT NULL REFERENCES roster_imports(id),
    row_index integer NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb,
    reconcile_status text NOT NULL DEFAULT 'new',
    message text,
    matched_payee_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // document_versions
  `CREATE TABLE IF NOT EXISTS document_versions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    form_id text NOT NULL REFERENCES forms(id),
    version integer NOT NULL,
    form_type text NOT NULL,
    verdict text,
    superseded_by text,
    submitted_by text,
    snapshot jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // exceptions
  `CREATE TABLE IF NOT EXISTS exceptions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    form_id text REFERENCES forms(id),
    validation_id text REFERENCES validations(id),
    kind text NOT NULL DEFAULT 'validation',
    severity text NOT NULL DEFAULT 'error',
    message text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    assignee text,
    resolution_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // tin_checks
  `CREATE TABLE IF NOT EXISTS tin_checks (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    form_id text NOT NULL REFERENCES forms(id),
    payee_id text NOT NULL REFERENCES payees(id),
    tin_type text,
    structural_valid boolean NOT NULL DEFAULT false,
    name_tin_match text NOT NULL DEFAULT 'unchecked',
    message text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // treaty_claims
  `CREATE TABLE IF NOT EXISTS treaty_claims (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    form_id text NOT NULL REFERENCES forms(id),
    payee_id text NOT NULL REFERENCES payees(id),
    country text NOT NULL,
    article text,
    rate real,
    income_type text,
    is_valid boolean NOT NULL DEFAULT false,
    message text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // treaty_catalog
  `CREATE TABLE IF NOT EXISTS treaty_catalog (
    id text PRIMARY KEY,
    country text NOT NULL UNIQUE,
    article text,
    income_type text,
    rate real,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // chapter_statuses
  `CREATE TABLE IF NOT EXISTS chapter_statuses (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    form_id text NOT NULL REFERENCES forms(id),
    payee_id text NOT NULL REFERENCES payees(id),
    chapter3_status text,
    chapter4_status text,
    is_consistent boolean NOT NULL DEFAULT true,
    message text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // withholding_determinations
  `CREATE TABLE IF NOT EXISTS withholding_determinations (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    form_id text REFERENCES forms(id),
    income_type text NOT NULL DEFAULT 'royalties',
    base_rate real NOT NULL DEFAULT 30,
    applied_rate real NOT NULL DEFAULT 30,
    treaty_applied boolean NOT NULL DEFAULT false,
    estimated_withholding_cents integer NOT NULL DEFAULT 0,
    rationale text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // bnotices
  `CREATE TABLE IF NOT EXISTS bnotices (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    notice_kind text NOT NULL DEFAULT 'first',
    received_date timestamptz,
    status text NOT NULL DEFAULT 'open',
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // request_links
  `CREATE TABLE IF NOT EXISTS request_links (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text NOT NULL REFERENCES payees(id),
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'sent',
    opened_at timestamptz,
    submitted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // activity_log
  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    payee_id text,
    action text NOT NULL,
    entity_type text,
    entity_id text,
    detail text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // notifications
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text,
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // org_settings
  `CREATE TABLE IF NOT EXISTS org_settings (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    org_name text NOT NULL DEFAULT 'My Organization',
    expiring_soon_days integer NOT NULL DEFAULT 90,
    default_withholding_rate real NOT NULL DEFAULT 30,
    backup_withholding_rate real NOT NULL DEFAULT 24,
    tax_year integer NOT NULL DEFAULT 2026,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // plans
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // subscriptions
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // indexes on FKs / workspace columns
  `CREATE INDEX IF NOT EXISTS idx_payees_user ON payees(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_forms_user ON forms(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_forms_payee ON forms(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_validations_user ON validations(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_validations_form ON validations(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_validations_payee ON validations(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_validation_checks_validation ON validation_checks(validation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qs_payee ON questionnaire_sessions(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_form_rec_payee ON form_recommendations(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expiry_user ON expiry_records(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expiry_form ON expiry_records(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expiry_payee ON expiry_records(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_campaign_targets_campaign ON campaign_targets(campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_campaign_targets_payee ON campaign_targets(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_readiness_user ON readiness_states(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_readiness_payee ON readiness_states(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_user ON roster_imports(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_rows_import ON import_rows(import_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_versions_payee ON document_versions(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_versions_form ON document_versions(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exceptions_user ON exceptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exceptions_payee ON exceptions(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tin_checks_form ON tin_checks(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tin_checks_payee ON tin_checks(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_treaty_claims_form ON treaty_claims(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_treaty_claims_payee ON treaty_claims(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chapter_statuses_form ON chapter_statuses(form_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chapter_statuses_payee ON chapter_statuses(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_withholding_user ON withholding_determinations(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_withholding_payee ON withholding_determinations(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bnotices_user ON bnotices(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bnotices_payee ON bnotices(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_request_links_user ON request_links(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_request_links_payee ON request_links(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_payee ON activity_log(payee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_org_settings_user ON org_settings(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete: ensured all tables and indexes exist')
}
