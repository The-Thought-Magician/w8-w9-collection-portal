import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const router = new Hono()

// ---------------------------------------------------------------------------
// Form-selection engine (W-9 vs the W-8 family)
//
// Deterministic decision tree driven by a small set of payee answers. Exposed
// both as a public POST endpoint (recommend from raw answers) and reused by the
// questionnaire portal. The rule catalog is published verbatim via GET /rules
// so the portal can render an explainer.
// ---------------------------------------------------------------------------

export type RecommendAnswers = {
  // Is the payee a US person (citizen, resident alien, US entity)?
  is_us_person?: boolean
  // 'individual' | 'entity' (corporation, partnership, trust, ...)
  entity_kind?: string
  // For foreign payees: do they have income effectively connected with a US
  // trade or business (ECI)?
  has_us_effectively_connected_income?: boolean
  // For foreign payees: are they acting as an intermediary / flow-through
  // (acting on behalf of others, e.g. a partnership distributing to partners)?
  is_intermediary?: boolean
  // Country of tax residence (used for the rationale string).
  country?: string
}

export type Recommendation = {
  recommended_form: string
  rationale: string
}

const FORMS = {
  W9: 'W-9',
  W8BEN: 'W-8BEN',
  W8BENE: 'W-8BEN-E',
  W8ECI: 'W-8ECI',
  W8IMY: 'W-8IMY',
} as const

/**
 * Pure decision function: maps a set of answers to a recommended IRS form plus
 * a human-readable rationale. Always returns a concrete form (never null).
 */
export function recommendForm(answers: RecommendAnswers): Recommendation {
  const isUs = answers.is_us_person === true
  const kind = (answers.entity_kind ?? 'individual').toLowerCase()
  const isEntity = kind === 'entity' || kind === 'corporation' || kind === 'partnership' || kind === 'trust' || kind === 'company'
  const country = answers.country ? ` (residence: ${answers.country})` : ''

  // 1. US persons always file the W-9 regardless of entity type.
  if (isUs) {
    return {
      recommended_form: FORMS.W9,
      rationale: 'Payee is a US person (US citizen, resident, or US-organized entity), so a Form W-9 collecting the US TIN is required.',
    }
  }

  // 2. Foreign intermediaries / flow-through entities file W-8IMY.
  if (answers.is_intermediary === true) {
    return {
      recommended_form: FORMS.W8IMY,
      rationale: `Payee is a foreign intermediary or flow-through entity${country}; a Form W-8IMY is required to document the chain of beneficial owners.`,
    }
  }

  // 3. Foreign payee with US effectively-connected income files W-8ECI.
  if (answers.has_us_effectively_connected_income === true) {
    return {
      recommended_form: FORMS.W8ECI,
      rationale: `Payee is a foreign person whose income is effectively connected with a US trade or business${country}; a Form W-8ECI exempts that income from chapter 3 withholding.`,
    }
  }

  // 4. Foreign entity (no ECI, not an intermediary) files W-8BEN-E.
  if (isEntity) {
    return {
      recommended_form: FORMS.W8BENE,
      rationale: `Payee is a foreign entity${country} receiving US-source income; a Form W-8BEN-E establishes foreign status, chapter 4 (FATCA) status, and any treaty benefits.`,
    }
  }

  // 5. Default: foreign individual files W-8BEN.
  return {
    recommended_form: FORMS.W8BEN,
    rationale: `Payee is a foreign individual${country} receiving US-source income; a Form W-8BEN establishes foreign status and any treaty benefits.`,
  }
}

// ---------------------------------------------------------------------------
// Published rule catalog
// ---------------------------------------------------------------------------

export type Rule = {
  key: string
  form: string
  title: string
  when: string
  notes: string
}

export const RULE_CATALOG: Rule[] = [
  {
    key: 'us-person',
    form: FORMS.W9,
    title: 'US persons → Form W-9',
    when: 'Payee is a US citizen, US resident alien, or an entity organized under US law.',
    notes: 'Collects the US TIN (SSN/EIN/ITIN). Applies to both individuals and entities.',
  },
  {
    key: 'foreign-intermediary',
    form: FORMS.W8IMY,
    title: 'Foreign intermediaries / flow-through → Form W-8IMY',
    when: 'Payee receives income on behalf of others (qualified/non-qualified intermediary, partnership, trust acting as a flow-through).',
    notes: 'Must be accompanied by withholding statements and the underlying owners’ W-8/W-9 forms.',
  },
  {
    key: 'foreign-eci',
    form: FORMS.W8ECI,
    title: 'Foreign with US effectively-connected income → Form W-8ECI',
    when: 'Payee is foreign and the income is effectively connected with a US trade or business.',
    notes: 'Income is taxed on a net basis and exempt from chapter 3 (NRA) withholding.',
  },
  {
    key: 'foreign-entity',
    form: FORMS.W8BENE,
    title: 'Foreign entities → Form W-8BEN-E',
    when: 'Payee is a foreign corporation, partnership, or other entity receiving US-source FDAP income (no ECI, not an intermediary).',
    notes: 'Captures chapter 3 status, chapter 4 (FATCA) status, and treaty claims.',
  },
  {
    key: 'foreign-individual',
    form: FORMS.W8BEN,
    title: 'Foreign individuals → Form W-8BEN',
    when: 'Payee is a foreign individual receiving US-source FDAP income.',
    notes: 'Establishes foreign status and supports reduced treaty withholding rates.',
  },
]

const recommendSchema = z.object({
  is_us_person: z.boolean().optional(),
  entity_kind: z.string().optional(),
  has_us_effectively_connected_income: z.boolean().optional(),
  is_intermediary: z.boolean().optional(),
  country: z.string().optional(),
})

// POST / — public — recommend a form from raw answers.
router.post('/', zValidator('json', recommendSchema), (c) => {
  const answers = c.req.valid('json')
  return c.json(recommendForm(answers))
})

// GET /rules — public — browse the form-selection rule catalog.
router.get('/rules', (c) => {
  return c.json(RULE_CATALOG)
})

export default router
