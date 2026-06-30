// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic, self-contained scheduling functions used by routes.
// No external services, no DB access. Three schedule "kinds" are supported:
//   - 'cron'   : a standard 5/6-field cron expression (parsed with cron-parser)
//   - 'rate'   : a human "every N minutes|hours|days" expression
//   - 'oneoff' : a single ISO-8601 instant
//
// All emitted instants are ISO-8601 UTC strings (e.g. "2026-06-30T12:00:00.000Z").
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  /** Optional logical resource this job contends for (DB, queue, API quota...). */
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  /** Inclusive ISO-8601 UTC start of a window that SHOULD be covered. */
  start: string
  /** Exclusive ISO-8601 UTC end of a window that SHOULD be covered. */
  end: string
  label?: string
}

export interface CoverageGap {
  start: string
  end: string
  durationMinutes: number
  label?: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const DEFAULT_TZ = 'UTC'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days|min|mins|hr|hrs)$/i

function parseRate(expr: string): { stepMs: number; n: number; unit: string } | null {
  const m = RATE_RE.exec(expr.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unitRaw = m[2].toLowerCase()
  let stepMs: number
  let unit: string
  if (unitRaw.startsWith('min')) {
    stepMs = n * MINUTE_MS
    unit = 'minute'
  } else if (unitRaw.startsWith('hr') || unitRaw.startsWith('hour')) {
    stepMs = n * HOUR_MS
    unit = 'hour'
  } else {
    stepMs = n * DAY_MS
    unit = 'day'
  }
  return { stepMs, n, unit }
}

function toUtcIso(d: Date): string {
  return new Date(d.getTime()).toISOString()
}

/** Round a Date down to its minute boundary, returning epoch ms. */
function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

/** Format an epoch-ms minute boundary as an ISO UTC string. */
function minuteIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * The UTC-offset (in minutes) that `timezone` has at the given instant.
 * Positive means ahead of UTC (e.g. +120 for CEST).
 */
function tzOffsetMinutes(instant: Date, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(instant)
    const map: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    }
    // The wall-clock time in `timezone`, interpreted as if it were UTC.
    const asUtc = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      map.hour === 24 ? 0 : (map.hour ?? 0),
      map.minute ?? 0,
      map.second ?? 0,
    )
    return Math.round((asUtc - instant.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

/** Render an instant as a local wall-clock ISO-ish string in `timezone`. */
function localWallClock(instant: Date, timezone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(instant)
    const map: Record<string, string> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value
    }
    const hour = map.hour === '24' ? '00' : map.hour
    return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`
  } catch {
    return instant.toISOString()
  }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { valid: false, error: 'Expression is empty' }
  }
  const e = expr.trim()
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(e)
      return { valid: true }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(e)
    if (!r) {
      return { valid: false, error: 'Rate must look like "every N minutes|hours|days"' }
    }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(e)
    if (Number.isNaN(t)) {
      return { valid: false, error: 'One-off must be a valid ISO-8601 instant' }
    }
    return { valid: true }
  }
  return { valid: false, error: `Unknown schedule kind: ${String(kind)}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
): string {
  const e = expr.trim()
  if (kind === 'rate') {
    const r = parseRate(e)
    if (!r) return 'Invalid rate expression'
    const plural = r.n === 1 ? r.unit : `${r.unit}s`
    return r.n === 1 ? `Every ${r.unit}` : `Every ${r.n} ${plural}`
  }
  if (kind === 'oneoff') {
    const t = Date.parse(e)
    if (Number.isNaN(t)) return 'Invalid one-off instant'
    return `Once at ${new Date(t).toISOString()}`
  }
  if (kind === 'cron') {
    const fields = e.split(/\s+/)
    if (fields.length < 5) return 'Invalid cron expression'
    const [min, hour, dom, mon, dow] = fields
    const parts: string[] = []
    if (min === '*' && hour === '*') {
      parts.push('every minute')
    } else if (min !== '*' && hour !== '*' && !min.includes('*') && !hour.includes('*')) {
      parts.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
    } else if (hour === '*' && min !== '*') {
      parts.push(`at minute ${min} of every hour`)
    } else {
      parts.push(`minute=${min} hour=${hour}`)
    }
    if (dom !== '*') parts.push(`on day-of-month ${dom}`)
    if (mon !== '*') parts.push(`in month ${mon}`)
    if (dow !== '*') parts.push(`on weekday ${dow}`)
    return `Cron (${timezone}): ${parts.join(', ')}`
  }
  return 'Unknown schedule'
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  count: number = 10,
): string[] {
  const e = expr.trim()
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime()) || count <= 0) return []

  if (kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(e, { tz: timezone, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < count; i++) {
        const next = interval.next()
        out.push(toUtcIso(next.toDate()))
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(e)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.stepMs
    for (let i = 0; i < count; i++) {
      out.push(minuteIso(t))
      t += r.stepMs
    }
    return out
  }

  if (kind === 'oneoff') {
    const t = Date.parse(e)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays: number; threshold: number },
): CollisionWindow[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Bucket firings by minute boundary.
  // minute -> { jobIds:Set, resourceCount: Map<resourceId, Set<jobId>> }
  const buckets = new Map<number, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    const firings = expandFirings(job, fromISO, horizonMs)
    for (const f of firings) {
      const minute = floorToMinute(f)
      let b = buckets.get(minute)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(minute, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let set = b.resources.get(job.resourceId)
        if (!set) {
          set = new Set()
          b.resources.set(job.resourceId, set)
        }
        set.add(job.id)
      }
    }
  }

  const collisions: CollisionWindow[] = []
  for (const [minute, b] of [...buckets.entries()].sort((a, z) => a[0] - z[0])) {
    const concurrency = b.jobIds.size

    // Resource contention: any single resource hit by >= 2 distinct jobs.
    let contendedResource: string | undefined
    let maxResourceJobs = 0
    for (const [resId, set] of b.resources) {
      if (set.size >= 2 && set.size > maxResourceJobs) {
        maxResourceJobs = set.size
        contendedResource = resId
      }
    }

    const flagByConcurrency = concurrency >= threshold
    const flagByResource = contendedResource !== undefined

    if (!flagByConcurrency && !flagByResource) continue

    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 2 || maxResourceJobs >= 3) severity = 'high'
    else if (concurrency >= threshold || maxResourceJobs >= 2) severity = 'medium'

    collisions.push({
      windowStart: minuteIso(minute),
      windowEnd: minuteIso(minute + MINUTE_MS),
      jobIds: [...b.jobIds].sort(),
      severity,
      ...(contendedResource ? { resourceId: contendedResource } : {}),
    })
  }
  return collisions
}

/** Expand a single job's firings (epoch ms) up to `horizonMs`, capped for safety. */
function expandFirings(job: Job, fromISO: string, horizonMs: number): number[] {
  const tz = job.timezone ?? DEFAULT_TZ
  const out: number[] = []
  const SAFETY_CAP = 100_000

  if (job.kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(job.expr.trim(), {
        tz,
        currentDate: new Date(fromISO),
      })
      for (let i = 0; i < SAFETY_CAP; i++) {
        const next = interval.next().toDate().getTime()
        if (next > horizonMs) break
        out.push(next)
      }
    } catch {
      /* invalid cron → no firings */
    }
    return out
  }

  if (job.kind === 'rate') {
    const r = parseRate(job.expr.trim())
    if (!r) return out
    let t = Date.parse(fromISO) + r.stepMs
    for (let i = 0; i < SAFETY_CAP && t <= horizonMs; i++) {
      out.push(t)
      t += r.stepMs
    }
    return out
  }

  if (job.kind === 'oneoff') {
    const t = Date.parse(job.expr.trim())
    if (!Number.isNaN(t) && t > Date.parse(fromISO) && t <= horizonMs) out.push(t)
    return out
  }

  return out
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: Job[],
  opts: { horizonDays: number },
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Hourly buckets keyed by the hour boundary (ISO).
  const counts = new Map<number, number>()
  for (const job of jobs) {
    for (const f of expandFirings(job, fromISO, horizonMs)) {
      const hour = Math.floor(f / HOUR_MS) * HOUR_MS
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, z) => a[0] - z[0])
    .map(([hour, count]) => ({ bucket: new Date(hour).toISOString(), count }))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string = DEFAULT_TZ,
  fromISO: string = new Date().toISOString(),
  days: number = 365,
): DstTrap[] {
  if (timezone === 'UTC' || timezone === DEFAULT_TZ) return []
  const fromMs = Date.parse(fromISO)
  if (Number.isNaN(fromMs)) return []
  const horizonMs = fromMs + (days > 0 ? days : 365) * DAY_MS

  // 1) Find DST transitions by scanning offset changes at hourly resolution.
  const transitions: { atMs: number; before: number; after: number }[] = []
  let prevOffset = tzOffsetMinutes(new Date(fromMs), timezone)
  for (let t = fromMs + HOUR_MS; t <= horizonMs; t += HOUR_MS) {
    const off = tzOffsetMinutes(new Date(t), timezone)
    if (off !== prevOffset) {
      transitions.push({ atMs: t, before: prevOffset, after: off })
      prevOffset = off
    }
  }
  if (transitions.length === 0) return []

  // 2) Expand the schedule's firings across the window.
  const job: Job = { id: '__probe__', kind, expr: expr.trim(), timezone }
  const firings = expandFirings(job, fromISO, horizonMs)
  const firingSet = new Set(firings.map(floorToMinute))

  const traps: DstTrap[] = []
  for (const tr of transitions) {
    const springForward = tr.after > tr.before // clocks jump ahead → a wall-clock window is skipped
    const gapMinutes = Math.abs(tr.after - tr.before)
    // The local-time window affected by the transition.
    const windowStart = tr.atMs - gapMinutes * MINUTE_MS
    const windowEnd = tr.atMs + gapMinutes * MINUTE_MS

    for (const fMin of firingSet) {
      if (fMin < windowStart || fMin >= windowEnd) continue
      const instant = new Date(fMin)
      if (springForward) {
        // Wall-clock time in the skipped window never occurs → skipped fire.
        traps.push({
          type: 'skip',
          atLocal: localWallClock(instant, timezone),
          atUtc: minuteIso(fMin),
        })
      } else {
        // Fall-back: wall-clock time occurs twice → ambiguous / potential double fire.
        traps.push({
          type: fMin < tr.atMs ? 'ambiguous' : 'double_fire',
          atLocal: localWallClock(instant, timezone),
          atUtc: minuteIso(fMin),
        })
      }
    }
  }
  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Collect all firing minutes within the horizon.
  const firingMinutes = new Set<number>()
  for (const job of jobs) {
    for (const f of expandFirings(job, fromISO, horizonMs)) {
      firingMinutes.add(floorToMinute(f))
    }
  }
  const sortedFirings = [...firingMinutes].sort((a, z) => a - z)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const wStart = Date.parse(w.start)
    const wEnd = Date.parse(w.end)
    if (Number.isNaN(wStart) || Number.isNaN(wEnd) || wEnd <= wStart) continue

    // Find firings inside this required window; the gaps are the uncovered spans.
    const inside = sortedFirings.filter((m) => m >= wStart && m < wEnd)
    if (inside.length === 0) {
      gaps.push({
        start: minuteIso(floorToMinute(wStart)),
        end: minuteIso(floorToMinute(wEnd)),
        durationMinutes: Math.round((wEnd - wStart) / MINUTE_MS),
        ...(w.label ? { label: w.label } : {}),
      })
      continue
    }
    // Leading gap.
    if (inside[0] > wStart) {
      gaps.push(makeGap(wStart, inside[0], w.label))
    }
    // Interior gaps (more than one minute between consecutive firings).
    for (let i = 1; i < inside.length; i++) {
      if (inside[i] - inside[i - 1] > MINUTE_MS) {
        gaps.push(makeGap(inside[i - 1] + MINUTE_MS, inside[i], w.label))
      }
    }
    // Trailing gap.
    const last = inside[inside.length - 1]
    if (last + MINUTE_MS < wEnd) {
      gaps.push(makeGap(last + MINUTE_MS, wEnd, w.label))
    }
  }
  return gaps
}

function makeGap(startMs: number, endMs: number, label?: string): CoverageGap {
  return {
    start: minuteIso(floorToMinute(startMs)),
    end: minuteIso(floorToMinute(endMs)),
    durationMinutes: Math.max(0, Math.round((endMs - startMs) / MINUTE_MS)),
    ...(label ? { label } : {}),
  }
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: Job[],
  opts: { threshold: number },
): SpreadSuggestion[] {
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const collisions = computeCollisions(jobs, { horizonDays: 7, threshold })
  if (collisions.length === 0) return []

  // Tally how many collision windows each job participates in.
  const jobHits = new Map<string, number>()
  for (const col of collisions) {
    for (const id of col.jobIds) {
      jobHits.set(id, (jobHits.get(id) ?? 0) + 1)
    }
  }
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  // Suggest a deterministic per-job minute offset so contending jobs stagger.
  const suggestions: SpreadSuggestion[] = []
  const ranked = [...jobHits.entries()].sort((a, z) => z[1] - a[1])
  let offsetIndex = 0
  for (const [jobId, hits] of ranked) {
    const job = jobById.get(jobId)
    if (!job || hits === 0) continue
    offsetIndex += 1
    const suggestedExpr = staggerExpr(job, offsetIndex)
    if (suggestedExpr === job.expr.trim()) continue
    suggestions.push({
      jobId,
      suggestedExpr,
      reason: `Job overlaps in ${hits} collision window(s); offsetting by ${offsetIndex} minute(s) to spread load.`,
    })
  }
  return suggestions
}

/** Produce a staggered variant of a job's expression by shifting its minute field. */
function staggerExpr(job: Job, offsetMinutes: number): string {
  const e = job.expr.trim()
  if (job.kind === 'cron') {
    const fields = e.split(/\s+/)
    if (fields.length < 5) return e
    const minField = fields[0]
    // Only stagger a concrete single-minute field; leave wildcards/lists alone.
    const m = parseInt(minField, 10)
    if (Number.isNaN(m) || String(m) !== minField) return e
    fields[0] = String((m + offsetMinutes) % 60)
    return fields.join(' ')
  }
  if (job.kind === 'rate') {
    // Rates can't carry a phase offset in their text form; recommend converting
    // to a cron with a staggered minute-of-hour anchor.
    const r = parseRate(e)
    if (!r) return e
    if (r.unit === 'minute') return e
    if (r.unit === 'hour') return `${offsetMinutes % 60} */${r.n} * * *`
    return `${offsetMinutes % 60} 0 */${r.n} * *`
  }
  return e
}
