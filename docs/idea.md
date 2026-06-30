# W8/W9 Collection Portal

## Overview

W8/W9 Collection Portal is a tax-form readiness system of record. It collects, validates, and keeps current every payee's W-9 and W-8 series form (W-8BEN, W-8BEN-E, W-8ECI, W-8IMY) before the first payment goes out. It pairs a self-serve payee portal (which picks the right form from a guided entity/residency questionnaire) with a real-time readiness ledger that shows green/yellow/red state and the total dollars and payees blocked by missing or invalid documents.

The product owns the full lifecycle of the tax form as a validated, expiring, recertifiable artifact: it picks the right form, validates it field by field, tracks its three-year expiry clock, runs automated re-request campaigns, and gates payments behind a readiness check. It is a compliance system, not an invoice or sourcing tool.

All features are FREE for signed-in users. Stripe billing is optional and returns 503 when unconfigured. A built-in sample-data seeder makes the product demoable out of the box.

## Problem

Every US business that pays non-employees must hold a valid W-9 or W-8 series form before payment, or face 24% backup withholding liability and IRS penalties. The reality is messy:

- The correct form depends on the payee's entity type and residency (US person vs foreign individual vs foreign entity vs flow-through entity).
- W-8 forms expire on a three-year clock (end of the third calendar year after signing), so a form that was valid last year may be invalid now.
- Treaty benefit claims (reduced withholding) require specific lines (country, article, rate, type of income) to be filled correctly and consistently.
- Chapter 3 (NRA withholding) and Chapter 4 (FATCA) status fields must be consistent with the declared entity type.
- TINs (SSN/EIN/ITIN) must be structurally valid and consistent with the entity type.
- Most AP teams chase forms over email and spreadsheets and discover gaps only during 1099 season, when it is too late and penalties have already accrued.

The cost of getting this wrong is direct: backup withholding the company must remit, B-notices from the IRS, penalties for missing/incorrect TINs, and frantic remediation in Q1.

## Target Users

- **AP Managers** at mid-market companies who own the vendor payment process and are accountable when a payment goes out without a valid form on file.
- **Controllers** who own backup-withholding and B-notice risk and must certify 1099 readiness.
- **Tax / Compliance analysts** who review forms, resolve validation exceptions, and manage treaty claims.
- **Payees / vendors** (external) who fill out the self-serve portal to submit their form.

The buyer is the AP Manager or Controller at a multi-vendor US company on the hook at 1099 season. Demand is driven by a hard compliance trigger (backup withholding, B-notices, penalties), recurs annually and at every new vendor, and the buyer pool is essentially every multi-vendor US company.

## Why This Is NOT an Existing Project

Near-neighbors and why they do not solve this:

- **AP / invoice platforms (Bill.com, Tipalti, AvidXchange):** treat the tax form as a one-time checkbox at onboarding. They do not model the form as an expiring, recertifiable artifact, do not run a field-level validation engine across the W-8 series, and do not present a payment-block readiness ledger that quantifies blocked dollars.
- **Procurement / supplier platforms (Coupa, SAP Ariba):** focus on sourcing, POs, and supplier records. The tax form is a metadata attachment, not a validated lifecycle object with an expiry clock and treaty-claim checking.
- **E-signature / form tools (DocuSign, PandaDoc):** capture a signature on a PDF but perform no tax-domain validation (entity-vs-classification consistency, chapter 3/4 fields, treaty lines, TIN structure) and no expiry tracking or recertification campaigns.
- **1099 e-file tools (Track1099, Tax1099):** operate at year-end on the filing itself. They assume you already hold valid W-9/W-8 forms; they do not collect, validate, or keep them current through the year.
- **TIN matching services:** check a single TIN against the IRS database but do not own the whole form lifecycle, the W-8 series, treaty claims, expiry, or the payment gate.

This product is the readiness system of record for the W-9/W-8 lifecycle itself: form selection, field-level validation, the three-year expiry clock, automated recertification campaigns, and a payment-block gate with quantified blocked dollars. No competitor owns that artifact end to end.

## Major Features

### 1. Self-Serve Payee Portal with Guided Form Selection
- Public, tokenized portal link per payee (no login required for the payee).
- Guided questionnaire: US person vs foreign; individual vs entity; entity classification; flow-through status.
- Deterministic form-selection engine that recommends W-9, W-8BEN, W-8BEN-E, W-8ECI, or W-8IMY from the answers.
- Branching question flow with explanations for each branch.
- Resume-later support; portal session state persisted.
- Submission writes a form record with all captured fields.

### 2. Field-Level Validation Engine
- Name/TIN structure checks (SSN ###-##-####, EIN ##-#######, ITIN range), TIN type vs entity type consistency.
- Entity-type vs federal tax classification consistency (e.g. LLC + classification box).
- Chapter 3 status (NRA withholding) and Chapter 4 (FATCA) status field presence and consistency.
- Treaty-claim line validation (country, article/paragraph, rate, income type) for W-8BEN/BEN-E.
- Signature and date presence, signer capacity, and date-not-in-future checks.
- Each check produces a typed validation result (pass/warning/error) with a human-readable message.
- Per-form validation report with overall verdict.

### 3. Form Selection Recommendation Engine
- Standalone endpoint that takes questionnaire answers and returns the recommended form type plus rationale.
- Rule catalog browsable in the dashboard (which answers map to which form).
- Used by both the payee portal and AP staff doing manual triage.

### 4. Form Expiry & Recertification Clock
- Per-form `valid_through` date computed from form type and signature date (W-8: end of third calendar year; W-9: no expiry unless circumstances change).
- Readiness states derived from days-to-expiry: valid, expiring-soon (within configurable window), expired.
- Dashboard list of forms by expiry bucket.
- Recompute endpoint to refresh expiry state across the roster.

### 5. Recertification Campaigns
- Create a campaign targeting a set of payees (e.g. all expiring within 90 days, or all missing forms).
- Campaign tracks invited/opened/submitted/completed counts.
- Per-payee campaign membership with status.
- Manual "send reminder" action that records a reminder event.
- Campaign detail view with progress.

### 6. Payment-Block Gate & Readiness Ledger
- Each payee has a computed readiness state: green (valid form on file), yellow (expiring soon or warning-level validation), red (missing/expired/invalid).
- Aggregate ledger: total payees and total dollars blocked, grouped by reason.
- Payment-eligibility check endpoint: given a payee, return blocked/allowed plus reasons.
- Readiness summary cards on the dashboard.

### 7. Payee Roster Management
- CRUD for payees (vendor name, legal name, contact email, country, expected annual spend, vendor type).
- Per-payee detail page aggregating forms, validations, readiness, and history.
- Search and filter by readiness state, country, vendor type.

### 8. Bulk Vendor-Roster Import
- Paste/upload CSV-style rows of vendors.
- Import preview with row-level parse results.
- Gap reconciliation: match imported vendors against existing payees, flag new vs existing vs conflicting.
- Commit import to create payees.

### 9. Immutable Document Version History
- Every form submission creates an immutable version record (never updated in place).
- Version history per payee showing each form, who submitted, when, and validation verdict at the time.
- Supersession: a new valid form supersedes the prior one without deleting it.

### 10. Sample Payee-Book Seeder
- One-click seed of a realistic sample roster (mix of US and foreign payees, valid/expiring/expired/missing forms).
- Idempotent seed on empty database at startup.
- Demoability: every screen has data immediately.

### 11. Validation Exception Queue
- A worklist of forms that produced warnings or errors.
- Assign, resolve, or waive an exception with a note.
- Exception status tracked (open, resolved, waived).

### 12. TIN Structure & Matching Checks
- Structural TIN validation per type.
- Recorded TIN-check result per form (structural verdict; external IRS matching stubbed for now).
- Flag mismatched name/TIN pairs for the exception queue.

### 13. Treaty Benefit Management
- Catalog of treaty countries and example article/rate references.
- Per-form treaty claim record (country, article, rate, income type).
- Treaty-claim validation against the catalog.

### 14. Chapter 3 / Chapter 4 (FATCA) Status Tracking
- Capture and store chapter 3 (NRA withholding) and chapter 4 (FATCA) statuses per W-8 form.
- Consistency checks between declared statuses and entity classification.
- Reporting of payees by chapter 4 status.

### 15. Withholding Rate Determination
- Given a payee's form, treaty claim, and income type, compute the applicable withholding rate (default 30% / 24% backup; reduced by valid treaty claim).
- Withholding preview per payee.
- Aggregate exposure: total potential backup withholding across blocked payees.

### 16. B-Notice / Compliance Risk Tracking
- Record B-notices received per payee (first/second notice).
- Risk register surfacing payees at risk of backup withholding.
- Compliance status per payee.

### 17. Audit Trail & Activity Log
- Append-only activity log of all material actions (form submitted, validated, exception resolved, payee created, campaign sent).
- Filterable activity feed.
- Per-payee activity timeline.

### 18. Reminders & Notifications
- In-app notification list per user (form submitted, validation failed, expiry approaching).
- Mark-read / mark-all-read.
- Generated by domain events.

### 19. Reporting & 1099 Readiness Report
- 1099 readiness report: counts of payees ready/not-ready, blocked dollars, expiring forms.
- Exportable summary (JSON).
- Breakdown by vendor type and country.

### 20. Analytics & Dashboard Metrics
- Aggregate metrics: total payees, forms on file, readiness distribution, validation pass rate, blocked dollars over time.
- Trend of submissions and expirations.
- Headline cards for the main dashboard.

### 21. Document Request Links
- Generate a per-payee secure request link (tokenized) that opens the payee portal pre-bound to that payee.
- Track link status (sent, opened, submitted).
- Regenerate/revoke a link.

### 22. Settings & Organization Configuration
- Organization-level settings: expiring-soon window (days), default withholding rate, fiscal/1099 year.
- Billing/plan view (free plan; Stripe optional).
- User profile.

## Data Model (Tables)

- `payees` — vendor/payee roster.
- `forms` — submitted W-9/W-8 form records (immutable versions).
- `form_fields` — captured field values per form (jsonb on forms for the primary blob, this table for normalized line items).
- `validations` — validation run results per form.
- `validation_checks` — individual check results within a validation.
- `questionnaire_sessions` — payee portal questionnaire state and answers.
- `form_recommendations` — recorded form-selection recommendations.
- `expiry_records` — computed expiry/readiness state per form.
- `campaigns` — recertification campaigns.
- `campaign_targets` — per-payee membership in a campaign.
- `readiness_states` — computed readiness per payee.
- `roster_imports` — bulk import batches.
- `import_rows` — per-row parse/reconciliation results.
- `document_versions` — immutable version history entries.
- `exceptions` — validation exception queue items.
- `tin_checks` — TIN structural/matching check results.
- `treaty_claims` — treaty benefit claims per form.
- `treaty_catalog` — reference catalog of treaty countries/articles/rates.
- `chapter_statuses` — chapter 3/4 status records per form.
- `withholding_determinations` — computed withholding rate per payee.
- `bnotices` — B-notice records per payee.
- `request_links` — tokenized document request links.
- `activity_log` — append-only audit trail.
- `notifications` — per-user in-app notifications.
- `org_settings` — per-user/org configuration.
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription.

## API Surface (high level)

- `/api/v1/payees` — CRUD, detail, search.
- `/api/v1/forms` — list, detail, submit, validate.
- `/api/v1/validations` — list, detail, re-run.
- `/api/v1/questionnaire` — start, answer, recommend form, submit.
- `/api/v1/recommendations` — recommend form, rule catalog.
- `/api/v1/expiry` — list by bucket, recompute.
- `/api/v1/campaigns` — CRUD, targets, send reminder.
- `/api/v1/readiness` — ledger, per-payee state, payment-eligibility check.
- `/api/v1/imports` — preview, commit, list.
- `/api/v1/versions` — version history per payee.
- `/api/v1/exceptions` — queue, assign/resolve/waive.
- `/api/v1/tin` — check, results.
- `/api/v1/treaties` — claims, catalog.
- `/api/v1/chapters` — chapter 3/4 statuses.
- `/api/v1/withholding` — determine, exposure.
- `/api/v1/bnotices` — record, risk register.
- `/api/v1/activity` — feed.
- `/api/v1/notifications` — list, mark read.
- `/api/v1/reports` — 1099 readiness report.
- `/api/v1/analytics` — dashboard metrics.
- `/api/v1/links` — request links.
- `/api/v1/settings` — org settings.
- `/api/v1/seed` — sample seeder.
- `/api/v1/billing` — plan, checkout, portal, webhook.

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (static).
5. `/portal/[token]` — public payee portal (questionnaire + form submission, tokenized, no login).

Dashboard (auth-gated under `/dashboard`):
6. `/dashboard` — overview with readiness cards and metrics.
7. `/dashboard/payees` — payee roster list.
8. `/dashboard/payees/[id]` — payee detail (forms, readiness, history, withholding, B-notices).
9. `/dashboard/forms` — all submitted forms.
10. `/dashboard/forms/[id]` — form detail with validation report.
11. `/dashboard/validations` — validation runs list.
12. `/dashboard/exceptions` — validation exception queue.
13. `/dashboard/expiry` — expiry clock / forms by bucket.
14. `/dashboard/campaigns` — recertification campaigns list.
15. `/dashboard/campaigns/[id]` — campaign detail with targets/progress.
16. `/dashboard/readiness` — payment-block readiness ledger.
17. `/dashboard/imports` — bulk roster import + reconciliation.
18. `/dashboard/treaties` — treaty catalog and claims.
19. `/dashboard/chapters` — chapter 3/4 status tracking.
20. `/dashboard/withholding` — withholding determinations and exposure.
21. `/dashboard/bnotices` — B-notice risk register.
22. `/dashboard/links` — document request links.
23. `/dashboard/reports` — 1099 readiness report.
24. `/dashboard/activity` — audit trail / activity feed.
25. `/dashboard/notifications` — notifications.
26. `/dashboard/settings` — org settings + billing.
