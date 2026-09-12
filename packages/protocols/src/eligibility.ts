import type { EngineId, Product } from '@facings/shared'
import type { BuildFeedResult } from './acp-feed.js'
import type { ManifestValidation } from './ucp-manifest.js'
import type { Policy } from './policy-schema.js'
import { policyGaps } from './policy-schema.js'

/**
 * Eligibility: the first of the three presence states in SPEC 3.1, job 1.
 *
 * Phase 0 could observe the other two directly. Ingested and rendering are
 * facts about what an engine did. Eligible is a fact about what the merchant
 * publishes, so it is computed here from the artefacts Facings hosts rather
 * than inferred from an observation.
 *
 * The distinction matters commercially: a store that is not eligible has a
 * blocker it can fix today, and one that is eligible but not rendering has a
 * different conversation ahead of it. So every not-eligible verdict carries
 * the specific blocker, per the spec.
 */

export interface EligibilityInput {
  engine: EngineId
  products: Product[]
  feed: BuildFeedResult
  manifest: ManifestValidation
  policy?: Policy
  /**
   * Merchant Center diagnostics, when an account is connected. SPEC 4.4 uses
   * these for eligibility on Google and Microsoft. Undefined means not
   * checked, which is reported as such and never as a pass.
   */
  merchantCentre?: { connected: boolean; disapprovedSkus?: string[] }
  /** True when the catalogue has sized products, so a size chart is worth asking for. */
  needsSizing?: boolean
}

export interface EligibilityResult {
  engine: EngineId
  eligible: boolean
  /** Empty when eligible. Ordered most blocking first. */
  blockers: string[]
  /** Things that weaken eligibility without preventing it. */
  warnings: string[]
  /** Share of the catalogue that reached the feed, 0 to 1. */
  feedCoverage: number
}

/** Which artefact each surface reads. SPEC 3.1 job 1 and SPEC 4.4. */
const ENGINE_REQUIREMENTS: Record<EngineId, Array<'acp' | 'ucp' | 'gmc' | 'mmc' | 'policy'>> = {
  openai: ['acp', 'policy'],
  gemini: ['ucp', 'gmc', 'policy'],
  'google-ai-mode': ['ucp', 'gmc', 'policy'],
  copilot: ['mmc', 'policy'],
  perplexity: ['acp', 'policy'],
  claude: ['acp', 'policy'],
}

export function scoreEligibility(input: EligibilityInput): EligibilityResult {
  const { engine, products, feed, manifest, policy, merchantCentre } = input
  const blockers: string[] = []
  const warnings: string[] = []
  const requirements = ENGINE_REQUIREMENTS[engine]

  const feedCoverage = products.length === 0 ? 0 : feed.items.length / products.length

  if (products.length === 0) {
    return { engine, eligible: false, blockers: ['no catalogue is connected'], warnings, feedCoverage: 0 }
  }

  if (requirements.includes('acp') || requirements.includes('gmc') || requirements.includes('mmc')) {
    if (feed.items.length === 0) {
      blockers.push('no product reached the feed, so there is nothing for this surface to read')
    } else if (feedCoverage < 0.8) {
      warnings.push(
        `${feed.items.length} of ${products.length} products reached the feed. The rest are listed with the reason on the Presence screen`,
      )
    }
  }

  if (requirements.includes('ucp') && !manifest.valid) {
    const errors = manifest.issues.filter((issue) => issue.severity === 'error')
    blockers.push(
      `the UCP manifest does not validate: ${errors.map((issue) => `${issue.field} ${issue.message}`).join('; ')}`,
    )
  }

  const unconfirmed = manifest.issues.filter((issue) => issue.severity === 'warning')
  if (requirements.includes('ucp') && unconfirmed.length > 0) {
    warnings.push(...unconfirmed.map((issue) => `${issue.field}: ${issue.message}`))
  }

  if (requirements.includes('policy')) {
    const gaps = policyGaps(policy, { needsSizing: input.needsSizing ?? catalogueHasSizes(products) })
    blockers.push(...gaps.filter((gap) => gap.severity === 'blocker').map((gap) => gap.consequence))
    warnings.push(...gaps.filter((gap) => gap.severity === 'recommended').map((gap) => gap.consequence))
  }

  // Merchant Center diagnostics decide eligibility on Google and Microsoft.
  // Not connected is reported as unknown rather than counted as a pass.
  if (requirements.includes('gmc') || requirements.includes('mmc')) {
    if (!merchantCentre?.connected) {
      warnings.push(
        'no Merchant Center account is connected, so item level eligibility could not be checked and is reported as unknown',
      )
    } else if (merchantCentre.disapprovedSkus?.length) {
      blockers.push(
        `Merchant Center has disapproved ${merchantCentre.disapprovedSkus.length} items: ${merchantCentre.disapprovedSkus
          .slice(0, 5)
          .join(', ')}`,
      )
    }
  }

  return { engine, eligible: blockers.length === 0, blockers, warnings, feedCoverage: round(feedCoverage) }
}

export function scoreAllEligibility(input: Omit<EligibilityInput, 'engine'>, engines: EngineId[]): EligibilityResult[] {
  return engines.map((engine) => scoreEligibility({ ...input, engine }))
}

/**
 * Whether the catalogue carries sized products. Read from the merchant's own
 * attributes rather than guessed from the product name, for the same reason
 * category inference prefers the feed field.
 */
export function catalogueHasSizes(products: Product[]): boolean {
  return products.some((product) => {
    const size = product.attributes.size ?? product.attributes.sizes
    if (!size) return false
    // A single fixed dimension such as "8 inch" is a specification, not a size
    // the shopper picks between.
    return /\b(xs|s|m|l|xl|xxl|small|medium|large|one size|\d{2})\b/i.test(size)
  })
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
