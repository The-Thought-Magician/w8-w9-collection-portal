// W8W9CollectionPortal — same-origin relative API client.
// Every method maps 1:1 to a backend /api/v1/<path> endpoint via the /api/proxy/<path> route,
// which injects the X-User-Id header after resolving the Neon Auth session server-side.

type Query = Record<string, string | number | boolean | undefined | null>

function qs(q?: Query): string {
  if (!q) return ''
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

async function http<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(typeof message === 'string' ? message : `Request failed (${res.status})`)
  }
  return data as T
}

function get<T = any>(path: string): Promise<T> {
  return http<T>(path)
}

function send<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return http<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const api = {
  // payees
  listPayees: (q?: Query) => get(`payees${qs(q)}`),
  getPayee: (id: string) => get(`payees/${id}`),
  createPayee: (body: unknown) => send('POST', 'payees', body),
  updatePayee: (id: string, body: unknown) => send('PUT', `payees/${id}`, body),
  deletePayee: (id: string) => send('DELETE', `payees/${id}`),

  // forms
  listForms: (q?: Query) => get(`forms${qs(q)}`),
  getForm: (id: string) => get(`forms/${id}`),
  submitForm: (body: unknown) => send('POST', 'forms', body),
  validateForm: (id: string) => send('POST', `forms/${id}/validate`),
  deleteForm: (id: string) => send('DELETE', `forms/${id}`),

  // validations
  listValidations: (q?: Query) => get(`validations${qs(q)}`),
  getValidation: (id: string) => get(`validations/${id}`),
  rerunValidation: (id: string) => send('POST', `validations/${id}/rerun`),

  // questionnaire (public)
  startQuestionnaire: (body: unknown) => send('POST', 'questionnaire/start', body),
  getQuestionnaire: (token: string) => get(`questionnaire/${token}`),
  answerQuestionnaire: (token: string, body: unknown) => send('POST', `questionnaire/${token}/answer`, body),
  recommendFromSession: (token: string, body: unknown) => send('POST', `questionnaire/${token}/recommend`, body),
  submitQuestionnaire: (token: string, body: unknown) => send('POST', `questionnaire/${token}/submit`, body),

  // recommendations (public)
  recommendForm: (body: unknown) => send('POST', 'recommendations', body),
  getRecommendationRules: () => get('recommendations/rules'),

  // expiry
  listExpiry: (q?: Query) => get(`expiry${qs(q)}`),
  getExpiryBuckets: () => get('expiry/buckets'),
  recomputeExpiry: () => send('POST', 'expiry/recompute'),

  // campaigns
  listCampaigns: () => get('campaigns'),
  getCampaign: (id: string) => get(`campaigns/${id}`),
  createCampaign: (body: unknown) => send('POST', 'campaigns', body),
  remindCampaignTarget: (id: string, body: unknown) => send('POST', `campaigns/${id}/remind`, body),
  updateCampaign: (id: string, body: unknown) => send('PUT', `campaigns/${id}`, body),

  // readiness
  getReadinessLedger: () => get('readiness/ledger'),
  getPayeeReadiness: (id: string) => get(`readiness/payee/${id}`),
  checkPaymentEligibility: (body: unknown) => send('POST', 'readiness/check', body),
  recomputeReadiness: () => send('POST', 'readiness/recompute'),

  // imports
  listImports: () => get('imports'),
  previewImport: (body: unknown) => send('POST', 'imports/preview', body),
  commitImport: (id: string) => send('POST', `imports/${id}/commit`),

  // versions
  getPayeeVersions: (id: string) => get(`versions/payee/${id}`),

  // exceptions
  listExceptions: (q?: Query) => get(`exceptions${qs(q)}`),
  assignException: (id: string, body: unknown) => send('POST', `exceptions/${id}/assign`, body),
  resolveException: (id: string, body: unknown) => send('POST', `exceptions/${id}/resolve`, body),
  waiveException: (id: string, body: unknown) => send('POST', `exceptions/${id}/waive`, body),

  // tin
  checkTin: (body: unknown) => send('POST', 'tin/check', body),
  listTinChecks: (q?: Query) => get(`tin${qs(q)}`),

  // treaties
  getTreatyCatalog: () => get('treaties/catalog'),
  listTreatyClaims: (q?: Query) => get(`treaties/claims${qs(q)}`),
  createTreatyClaim: (body: unknown) => send('POST', 'treaties/claims', body),

  // chapters
  listChapters: (q?: Query) => get(`chapters${qs(q)}`),
  createChapterStatus: (body: unknown) => send('POST', 'chapters', body),
  getChapterSummary: () => get('chapters/summary'),

  // withholding
  listWithholding: () => get('withholding'),
  determineWithholding: (body: unknown) => send('POST', 'withholding/determine', body),
  getWithholdingExposure: () => get('withholding/exposure'),

  // bnotices
  listBnotices: () => get('bnotices'),
  createBnotice: (body: unknown) => send('POST', 'bnotices', body),
  updateBnotice: (id: string, body: unknown) => send('PUT', `bnotices/${id}`, body),

  // activity
  listActivity: (q?: Query) => get(`activity${qs(q)}`),

  // notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => send('POST', `notifications/${id}/read`),
  markAllNotificationsRead: () => send('POST', 'notifications/read-all'),

  // reports
  get1099Readiness: () => get('reports/1099-readiness'),
  getReportBreakdown: () => get('reports/breakdown'),

  // analytics
  getMetrics: () => get('analytics/metrics'),
  getTrends: () => get('analytics/trends'),

  // links
  listLinks: () => get('links'),
  createLink: (body: unknown) => send('POST', 'links', body),
  revokeLink: (id: string) => send('POST', `links/${id}/revoke`),

  // settings
  getSettings: () => get('settings'),
  updateSettings: (body: unknown) => send('PUT', 'settings', body),

  // seed
  seedSample: () => send('POST', 'seed'),
  getSeedStatus: () => get('seed/status'),

  // billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => send('POST', 'billing/checkout'),
  openBillingPortal: () => send('POST', 'billing/portal'),
}

export default api
