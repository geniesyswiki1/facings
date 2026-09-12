import type { FindingType, Product, Query, Severity } from '@facings/shared'

/**
 * Severity and revenue at risk.
 *
 * Severity answers "how wrong is this", revenue at risk answers "which one do
 * I fix first". SPEC 3.1 job 3 ranks the fix queue by revenue at risk, so the
 * proxy is defined here and used consistently by the report and the queue.
 */

const BASE_SEVERITY: Record<FindingType, Severity> = {
  discontinued_recommended: 'critical',
  price_mismatch: 'high',
  bestseller_absent: 'high',
  competitor_substituted: 'high',
  availability_stale: 'high',
  wrong_variant: 'medium',
  landing_url_wrong: 'medium',
  broken_image: 'low',
  unverified_rating: 'low',
  identity_ambiguous: 'low',
}

const ORDER: Severity[] = ['low', 'medium', 'high', 'critical']

export function baseSeverity(type: FindingType): Severity {
  return BASE_SEVERITY[type]
}

export function escalate(severity: Severity, steps = 1): Severity {
  const index = Math.min(ORDER.length - 1, ORDER.indexOf(severity) + steps)
  return ORDER[index] ?? severity
}

export function deescalate(severity: Severity, steps = 1): Severity {
  const index = Math.max(0, ORDER.indexOf(severity) - steps)
  return ORDER[index] ?? severity
}

export function severityRank(severity: Severity): number {
  return ORDER.indexOf(severity)
}

/** Default assumed gross margin when the merchant has not supplied one. */
export const DEFAULT_MARGIN_PCT = 30

/**
 * Revenue at risk proxy: demand proxy times unit margin. Unitless in Phase 0
 * because there is no query volume data, so it ranks findings against each
 * other and is never presented as a currency amount.
 */
export function revenueAtRisk(query: Query, product: Product | undefined, severity: Severity): number {
  const margin = ((product?.marginPct ?? DEFAULT_MARGIN_PCT) / 100) * (product?.price ?? 0)
  const weight = 1 + severityRank(severity) * 0.5
  return Math.round(query.volumeProxy * margin * weight * 100) / 100
}
