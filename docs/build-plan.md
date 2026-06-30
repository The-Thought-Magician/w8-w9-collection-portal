# W8/W9 Collection Portal — Build Contract (Authoritative)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are BINDING. Every api method is implemented by exactly one route endpoint and consumed by at least one page.

Stack: Hono 4.12.27 backend (mounted under `/api/v1`), Next.js 16 frontend, Neon Postgres via drizzle-orm, auth via `@neondatabase/auth@0.4.2-beta` (proxy.ts only). Backend trusts `X-User-Id`; handlers use `getUserId(c)`. Public reads / auth-gated writes with zod + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

---

## (a) Tables (columns)

1. **payees** — id, user_id, vendor_name, legal_name, contact_email, country, is_us_person, vendor_type, expected_annual_spend_cents, external_ref, notes, readiness_state, compliance_status, created_at, updated_at
2. **forms** — id, user_id, payee_id→payees, form_type, status, signer_name, signer_capacity, signature_date, tin, tin_type, entity_classification, chapter3_status, chapter4_status, treaty_country, data(jsonb), valid_through, version, submitted_via, created_at
3. **form_fields** — id, form_id→forms, field_key, field_value, created_at
4. **validations** — id, user_id, form_id→forms, payee_id→payees, verdict, error_count, warning_count, summary, created_at
5. **validation_checks** — id, validation_id→validations, check_key, severity, message, created_at
6. **questionnaire_sessions** — id, payee_id→payees, token(unique), status, answers(jsonb), recommended_form, created_at, updated_at
7. **form_recommendations** — id, session_id→questionnaire_sessions, payee_id→payees, recommended_form, rationale, answers(jsonb), created_at
8. **expiry_records** — id, user_id, form_id→forms, payee_id→payees, valid_through, days_remaining, bucket, computed_at
9. **campaigns** — id, user_id, name, description, filter_kind, status, invited_count, opened_count, submitted_count, completed_count, created_at, updated_at
10. **campaign_targets** — id, campaign_id→campaigns, payee_id→payees, status, reminder_count, last_reminder_at, created_at; UNIQUE(campaign_id, payee_id)
11. **readiness_states** — id, user_id, payee_id→payees(unique), state, reason, blocked_amount_cents, is_payment_blocked, computed_at
12. **roster_imports** — id, user_id, filename, status, total_rows, new_count, existing_count, conflict_count, created_at
13. **import_rows** — id, import_id→roster_imports, row_index, raw(jsonb), reconcile_status, message, matched_payee_id, created_at
14. **document_versions** — id, user_id, payee_id→payees, form_id→forms, version, form_type, verdict, superseded_by, submitted_by, snapshot(jsonb), created_at
15. **exceptions** — id, user_id, payee_id→payees, form_id→forms, validation_id→validations, kind, severity, message, status, assignee, resolution_note, created_at, updated_at
16. **tin_checks** — id, user_id, form_id→forms, payee_id→payees, tin_type, structural_valid, name_tin_match, message, created_at
17. **treaty_claims** — id, user_id, form_id→forms, payee_id→payees, country, article, rate(real), income_type, is_valid, message, created_at
18. **treaty_catalog** — id, country(unique), article, income_type, rate(real), notes, created_at
19. **chapter_statuses** — id, user_id, form_id→forms, payee_id→payees, chapter3_status, chapter4_status, is_consistent, message, created_at
20. **withholding_determinations** — id, user_id, payee_id→payees, form_id→forms, income_type, base_rate(real), applied_rate(real), treaty_applied, estimated_withholding_cents, rationale, created_at
21. **bnotices** — id, user_id, payee_id→payees, notice_kind, received_date, status, note, created_at
22. **request_links** — id, user_id, payee_id→payees, token(unique), status, opened_at, submitted_at, created_at
23. **activity_log** — id, user_id, payee_id, action, entity_type, entity_id, detail, metadata(jsonb), created_at
24. **notifications** — id, user_id, kind, title, body, link, is_read, created_at
25. **org_settings** — id, user_id(unique), org_name, expiring_soon_days, default_withholding_rate(real), backup_withholding_rate(real), tax_year, created_at, updated_at
26. **plans** — id('free'/'pro'), name, price_cents, created_at
27. **subscriptions** — id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend Route Files (mount under /api/v1)

### payees.ts → `/payees`
- GET `/` — auth — list current user's payees (filter ?state=&country=&type=) — Payee[]
- GET `/:id` — auth — payee detail (owner) — Payee
- POST `/` — auth — create payee (zod) — Payee (201)
- PUT `/:id` — auth — update payee (owner) — Payee
- DELETE `/:id` — auth — delete payee (owner) — { success }

### forms.ts → `/forms`
- GET `/` — auth — list forms (?payee_id) — Form[]
- GET `/:id` — auth — form detail incl. fields — { form, fields }
- POST `/` — auth — submit a form (manual/import); creates version + expiry record (zod) — Form (201)
- POST `/:id/validate` — auth — run validation engine on a form — Validation
- DELETE `/:id` — auth — delete a form (owner) — { success }

### validations.ts → `/validations`
- GET `/` — auth — list validation runs (?form_id) — Validation[]
- GET `/:id` — auth — validation detail incl. checks — { validation, checks }
- POST `/:id/rerun` — auth — re-run validation for the same form — Validation

### questionnaire.ts → `/questionnaire`
- POST `/start` — public — start a session (optional ?token to bind payee); returns session — Session
- GET `/:token` — public — fetch session state by token — Session
- POST `/:token/answer` — public — persist answers (zod) — Session
- POST `/:token/recommend` — public — compute recommended form from answers — { recommended_form, rationale }
- POST `/:token/submit` — public — submit the completed form via portal; creates form+version — { form, recommendation }

### recommendations.ts → `/recommendations`
- POST `/` — public — recommend a form from raw answers (zod) — { recommended_form, rationale }
- GET `/rules` — public — browse the form-selection rule catalog — Rule[]

### expiry.ts → `/expiry`
- GET `/` — auth — list expiry records by bucket (?bucket) — ExpiryRecord[]
- GET `/buckets` — auth — counts per bucket — { valid, expiring_soon, expired, no_expiry }
- POST `/recompute` — auth — recompute expiry/readiness across roster — { updated }

### campaigns.ts → `/campaigns`
- GET `/` — auth — list campaigns — Campaign[]
- GET `/:id` — auth — campaign detail incl. targets — { campaign, targets }
- POST `/` — auth — create campaign + populate targets from filter (zod) — Campaign (201)
- POST `/:id/remind` — auth — send reminder to a target (body: payee_id) — { target }
- PUT `/:id` — auth — update campaign status (owner) — Campaign

### readiness.ts → `/readiness`
- GET `/ledger` — auth — aggregate ledger: blocked payees/dollars grouped by reason — { total_blocked_payees, total_blocked_cents, by_reason, distribution }
- GET `/payee/:id` — auth — readiness state for one payee — ReadinessState
- POST `/check` — auth — payment-eligibility check (body: payee_id) — { allowed, reasons }
- POST `/recompute` — auth — recompute readiness for all payees — { updated }

### imports.ts → `/imports`
- GET `/` — auth — list import batches — Import[]
- POST `/preview` — auth — parse rows + reconcile against existing payees (zod) — { import, rows }
- POST `/:id/commit` — auth — commit preview, creating new payees — { created }

### versions.ts → `/versions`
- GET `/payee/:id` — auth — immutable version history for a payee — DocumentVersion[]

### exceptions.ts → `/exceptions`
- GET `/` — auth — list exceptions (?status) — Exception[]
- POST `/:id/assign` — auth — assign to a user (body: assignee) — Exception
- POST `/:id/resolve` — auth — resolve with note (zod) — Exception
- POST `/:id/waive` — auth — waive with note (zod) — Exception

### tin.ts → `/tin`
- POST `/check` — auth — structural TIN check for a form (body: form_id) — TinCheck
- GET `/` — auth — list TIN check results (?payee_id) — TinCheck[]

### treaties.ts → `/treaties`
- GET `/catalog` — public — treaty country catalog — TreatyCatalog[]
- GET `/claims` — auth — list treaty claims (?payee_id) — TreatyClaim[]
- POST `/claims` — auth — record + validate a treaty claim (zod) — TreatyClaim (201)

### chapters.ts → `/chapters`
- GET `/` — auth — list chapter 3/4 status records (?payee_id) — ChapterStatus[]
- POST `/` — auth — record + consistency-check chapter statuses for a form (zod) — ChapterStatus (201)
- GET `/summary` — auth — payees grouped by chapter4 status — { by_chapter4 }

### withholding.ts → `/withholding`
- GET `/` — auth — list withholding determinations — Determination[]
- POST `/determine` — auth — compute withholding rate for a payee (zod) — Determination
- GET `/exposure` — auth — aggregate potential backup-withholding exposure — { total_exposure_cents, count }

### bnotices.ts → `/bnotices`
- GET `/` — auth — list B-notices + risk register — { notices, at_risk }
- POST `/` — auth — record a B-notice (zod) — Bnotice (201)
- PUT `/:id` — auth — update B-notice status (owner) — Bnotice

### activity.ts → `/activity`
- GET `/` — auth — activity feed (?payee_id) — Activity[]

### notifications.ts → `/notifications`
- GET `/` — auth — list current user's notifications — Notification[]
- POST `/:id/read` — auth — mark one read — Notification
- POST `/read-all` — auth — mark all read — { updated }

### reports.ts → `/reports`
- GET `/1099-readiness` — auth — 1099 readiness report (ready/not-ready counts, blocked dollars, expiring) — Report
- GET `/breakdown` — auth — breakdown by vendor type and country — { by_type, by_country }

### analytics.ts → `/analytics`
- GET `/metrics` — auth — headline dashboard metrics — { total_payees, forms_on_file, readiness_distribution, validation_pass_rate, blocked_cents }
- GET `/trends` — auth — submissions and expirations over time — { submissions, expirations }

### links.ts → `/links`
- GET `/` — auth — list request links — RequestLink[]
- POST `/` — auth — generate a tokenized link for a payee (zod) — RequestLink (201)
- POST `/:id/revoke` — auth — revoke a link — RequestLink

### settings.ts → `/settings`
- GET `/` — auth — get org settings (auto-create default) — OrgSettings
- PUT `/` — auth — update org settings (zod) — OrgSettings

### seed.ts → `/seed`
- POST `/` — auth — seed a sample payee book for the current user — { created }
- GET `/status` — auth — whether the user has any payees — { seeded }

### billing.ts → `/billing`
- GET `/plan` — auth — current subscription + plan + stripeEnabled — { subscription, plan, stripeEnabled }
- POST `/checkout` — auth — Stripe checkout (503 if unconfigured) — { url } | 503
- POST `/portal` — auth — Stripe billing portal (503 if unconfigured) — { url } | 503
- POST `/webhook` — public — Stripe webhook (503 if unconfigured) — { received } | 503

Total route files: **26** (payees, forms, validations, questionnaire, recommendations, expiry, campaigns, readiness, imports, versions, exceptions, tin, treaties, chapters, withholding, bnotices, activity, notifications, reports, analytics, links, settings, seed, billing) = 24 domain files. Note: seed.ts and billing.ts included. Mounted in index.ts under the child `api` router.

---

## (c) lib/api.ts methods (relative `/api/proxy/...` path + verb)

```
// payees
listPayees(q?)                  GET    /api/proxy/payees
getPayee(id)                    GET    /api/proxy/payees/:id
createPayee(body)               POST   /api/proxy/payees
updatePayee(id, body)           PUT    /api/proxy/payees/:id
deletePayee(id)                 DELETE /api/proxy/payees/:id
// forms
listForms(q?)                   GET    /api/proxy/forms
getForm(id)                     GET    /api/proxy/forms/:id
submitForm(body)                POST   /api/proxy/forms
validateForm(id)                POST   /api/proxy/forms/:id/validate
deleteForm(id)                  DELETE /api/proxy/forms/:id
// validations
listValidations(q?)             GET    /api/proxy/validations
getValidation(id)               GET    /api/proxy/validations/:id
rerunValidation(id)             POST   /api/proxy/validations/:id/rerun
// questionnaire (public)
startQuestionnaire(body)        POST   /api/proxy/questionnaire/start
getQuestionnaire(token)         GET    /api/proxy/questionnaire/:token
answerQuestionnaire(token,body) POST   /api/proxy/questionnaire/:token/answer
recommendFromSession(token,b)   POST   /api/proxy/questionnaire/:token/recommend
submitQuestionnaire(token,body) POST   /api/proxy/questionnaire/:token/submit
// recommendations (public)
recommendForm(body)             POST   /api/proxy/recommendations
getRecommendationRules()        GET    /api/proxy/recommendations/rules
// expiry
listExpiry(q?)                  GET    /api/proxy/expiry
getExpiryBuckets()              GET    /api/proxy/expiry/buckets
recomputeExpiry()               POST   /api/proxy/expiry/recompute
// campaigns
listCampaigns()                 GET    /api/proxy/campaigns
getCampaign(id)                 GET    /api/proxy/campaigns/:id
createCampaign(body)            POST   /api/proxy/campaigns
remindCampaignTarget(id,body)   POST   /api/proxy/campaigns/:id/remind
updateCampaign(id, body)        PUT    /api/proxy/campaigns/:id
// readiness
getReadinessLedger()            GET    /api/proxy/readiness/ledger
getPayeeReadiness(id)           GET    /api/proxy/readiness/payee/:id
checkPaymentEligibility(body)   POST   /api/proxy/readiness/check
recomputeReadiness()            POST   /api/proxy/readiness/recompute
// imports
listImports()                   GET    /api/proxy/imports
previewImport(body)             POST   /api/proxy/imports/preview
commitImport(id)                POST   /api/proxy/imports/:id/commit
// versions
getPayeeVersions(id)            GET    /api/proxy/versions/payee/:id
// exceptions
listExceptions(q?)              GET    /api/proxy/exceptions
assignException(id, body)       POST   /api/proxy/exceptions/:id/assign
resolveException(id, body)      POST   /api/proxy/exceptions/:id/resolve
waiveException(id, body)        POST   /api/proxy/exceptions/:id/waive
// tin
checkTin(body)                  POST   /api/proxy/tin/check
listTinChecks(q?)               GET    /api/proxy/tin
// treaties
getTreatyCatalog()              GET    /api/proxy/treaties/catalog
listTreatyClaims(q?)            GET    /api/proxy/treaties/claims
createTreatyClaim(body)         POST   /api/proxy/treaties/claims
// chapters
listChapters(q?)                GET    /api/proxy/chapters
createChapterStatus(body)       POST   /api/proxy/chapters
getChapterSummary()             GET    /api/proxy/chapters/summary
// withholding
listWithholding()               GET    /api/proxy/withholding
determineWithholding(body)      POST   /api/proxy/withholding/determine
getWithholdingExposure()        GET    /api/proxy/withholding/exposure
// bnotices
listBnotices()                  GET    /api/proxy/bnotices
createBnotice(body)             POST   /api/proxy/bnotices
updateBnotice(id, body)         PUT    /api/proxy/bnotices/:id
// activity
listActivity(q?)                GET    /api/proxy/activity
// notifications
listNotifications()             GET    /api/proxy/notifications
markNotificationRead(id)        POST   /api/proxy/notifications/:id/read
markAllNotificationsRead()      POST   /api/proxy/notifications/read-all
// reports
get1099Readiness()              GET    /api/proxy/reports/1099-readiness
getReportBreakdown()            GET    /api/proxy/reports/breakdown
// analytics
getMetrics()                    GET    /api/proxy/analytics/metrics
getTrends()                     GET    /api/proxy/analytics/trends
// links
listLinks()                     GET    /api/proxy/links
createLink(body)                POST   /api/proxy/links
revokeLink(id)                  POST   /api/proxy/links/:id/revoke
// settings
getSettings()                   GET    /api/proxy/settings
updateSettings(body)            PUT    /api/proxy/settings
// seed
seedSample()                    POST   /api/proxy/seed
getSeedStatus()                 GET    /api/proxy/seed/status
// billing
getBillingPlan()                GET    /api/proxy/billing/plan
startCheckout()                 POST   /api/proxy/billing/checkout
openBillingPortal()             POST   /api/proxy/billing/portal
```

(72 api methods. Webhook is server-to-server, not in lib/api.ts.)

---

## (d) Pages (URL · file under web/ · kind · api methods · renders)

### Public
1. `/` · `app/page.tsx` · public · (none) · static landing: hero, the 5 flagship features, CTA to sign-up.
2. `/auth/sign-in` · `app/auth/sign-in/page.tsx` · public · (authClient) · email/password sign-in.
3. `/auth/sign-up` · `app/auth/sign-up/page.tsx` · public · (authClient) · email/password sign-up.
4. `/pricing` · `app/pricing/page.tsx` · public · (none) · static pricing (free plan, pro coming soon).
5. `/portal/[token]` · `app/portal/[token]/page.tsx` · public · getQuestionnaire, startQuestionnaire, answerQuestionnaire, recommendFromSession, submitQuestionnaire, getTreatyCatalog · guided payee questionnaire + form submission, no login.

### Dashboard (auth-gated, wrapped by `app/dashboard/layout.tsx` → DashboardLayout)
6. `/dashboard` · `app/dashboard/page.tsx` · dashboard · getMetrics, getReadinessLedger, getTrends, getSeedStatus, seedSample · overview cards (readiness distribution, blocked dollars, forms on file), seed button.
7. `/dashboard/payees` · `app/dashboard/payees/page.tsx` · dashboard · listPayees, createPayee, deletePayee · roster table with filters + add payee.
8. `/dashboard/payees/[id]` · `app/dashboard/payees/[id]/page.tsx` · dashboard · getPayee, updatePayee, listForms, getPayeeReadiness, getPayeeVersions, listWithholding, listBnotices, checkPaymentEligibility · payee detail: forms, readiness, version history, withholding, B-notices.
9. `/dashboard/forms` · `app/dashboard/forms/page.tsx` · dashboard · listForms, submitForm, validateForm · all submitted forms + manual submit.
10. `/dashboard/forms/[id]` · `app/dashboard/forms/[id]/page.tsx` · dashboard · getForm, validateForm, checkTin · form detail + validation report + TIN check.
11. `/dashboard/validations` · `app/dashboard/validations/page.tsx` · dashboard · listValidations, getValidation, rerunValidation · validation runs list + detail drawer.
12. `/dashboard/exceptions` · `app/dashboard/exceptions/page.tsx` · dashboard · listExceptions, assignException, resolveException, waiveException · exception worklist.
13. `/dashboard/expiry` · `app/dashboard/expiry/page.tsx` · dashboard · listExpiry, getExpiryBuckets, recomputeExpiry · forms by expiry bucket + recompute.
14. `/dashboard/campaigns` · `app/dashboard/campaigns/page.tsx` · dashboard · listCampaigns, createCampaign · recertification campaigns list + create.
15. `/dashboard/campaigns/[id]` · `app/dashboard/campaigns/[id]/page.tsx` · dashboard · getCampaign, remindCampaignTarget, updateCampaign · campaign detail with targets/progress.
16. `/dashboard/readiness` · `app/dashboard/readiness/page.tsx` · dashboard · getReadinessLedger, recomputeReadiness, checkPaymentEligibility · payment-block ledger.
17. `/dashboard/imports` · `app/dashboard/imports/page.tsx` · dashboard · listImports, previewImport, commitImport · bulk roster import + reconciliation.
18. `/dashboard/treaties` · `app/dashboard/treaties/page.tsx` · dashboard · getTreatyCatalog, listTreatyClaims, createTreatyClaim · treaty catalog + claims.
19. `/dashboard/chapters` · `app/dashboard/chapters/page.tsx` · dashboard · listChapters, createChapterStatus, getChapterSummary · chapter 3/4 status tracking.
20. `/dashboard/withholding` · `app/dashboard/withholding/page.tsx` · dashboard · listWithholding, determineWithholding, getWithholdingExposure · withholding determinations + exposure.
21. `/dashboard/bnotices` · `app/dashboard/bnotices/page.tsx` · dashboard · listBnotices, createBnotice, updateBnotice · B-notice risk register.
22. `/dashboard/links` · `app/dashboard/links/page.tsx` · dashboard · listLinks, createLink, revokeLink, listPayees · document request links.
23. `/dashboard/reports` · `app/dashboard/reports/page.tsx` · dashboard · get1099Readiness, getReportBreakdown · 1099 readiness report.
24. `/dashboard/activity` · `app/dashboard/activity/page.tsx` · dashboard · listActivity · audit trail feed.
25. `/dashboard/notifications` · `app/dashboard/notifications/page.tsx` · dashboard · listNotifications, markNotificationRead, markAllNotificationsRead · notifications.
26. `/dashboard/settings` · `app/dashboard/settings/page.tsx` · dashboard · getSettings, updateSettings, getBillingPlan, startCheckout, openBillingPortal · org settings + billing.

Total: **26 pages** (5 public + 21 dashboard).

Recommendation engine API (recommendForm, getRecommendationRules) is consumed by the public portal page (5) via recommendFromSession path; getRecommendationRules surfaced inside `/portal/[token]` as an explainer; recommendForm used by manual triage on `/dashboard/forms`. (Both recommendation methods are consumed.)

---

## (e) DashboardLayout sidebar nav sections

```
Overview
  - Dashboard            /dashboard
Payees & Forms
  - Payees               /dashboard/payees
  - Forms                /dashboard/forms
  - Validations          /dashboard/validations
  - Exceptions           /dashboard/exceptions
Lifecycle
  - Expiry Clock         /dashboard/expiry
  - Campaigns            /dashboard/campaigns
  - Request Links        /dashboard/links
  - Imports              /dashboard/imports
Compliance
  - Readiness Ledger     /dashboard/readiness
  - Withholding          /dashboard/withholding
  - Treaties             /dashboard/treaties
  - Chapter 3/4          /dashboard/chapters
  - B-Notices            /dashboard/bnotices
Insights
  - Reports              /dashboard/reports
  - Activity             /dashboard/activity
  - Notifications        /dashboard/notifications
Account
  - Settings             /dashboard/settings
```

Note `/dashboard/payees/[id]`, `/dashboard/forms/[id]`, `/dashboard/campaigns/[id]` are detail pages reached by drill-down, not top-level nav entries.
