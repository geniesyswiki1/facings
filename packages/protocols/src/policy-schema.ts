import { z } from 'zod'
import type { Market } from '@facings/shared'

/**
 * Machine-readable merchant policies. SPEC 3.1, job 1.
 *
 * Returns window, delivery promise by country, VAT-inclusive pricing by
 * market, warranty and sizing, generated from a guided form and published as
 * structured data. These are the fields agents read to answer "can I return
 * this" and "when does it arrive", and the absence of them is one of the
 * commonest reasons a store is eligible but never rendered, so the editor
 * treats a missing policy as a blocker rather than an empty field.
 */

export const deliveryPromiseSchema = z.object({
  /** ISO 3166-1 alpha-2 country code. */
  country: z.string().length(2).toUpperCase(),
  /** Working days, lower and upper bound of the promise. */
  minDays: z.number().int().min(0).max(90),
  maxDays: z.number().int().min(0).max(90),
  /** Cost in minor units of the market currency. Zero means free. */
  cost: z.number().min(0),
  currency: z.string().length(3),
  /** Order value above which delivery is free, when the merchant offers one. */
  freeOver: z.number().min(0).optional(),
  carrier: z.string().max(80).optional(),
})

export type DeliveryPromise = z.infer<typeof deliveryPromiseSchema>

export const returnsPolicySchema = z.object({
  /** Calendar days the shopper has to start a return. */
  windowDays: z.number().int().min(0).max(365),
  /** Who pays return postage. Agents surface this, so it is not optional. */
  returnShippingPaidBy: z.enum(['merchant', 'customer']),
  /** True when the merchant restocks fees. */
  restockingFee: z.boolean().default(false),
  restockingFeePct: z.number().min(0).max(100).optional(),
  /** Categories excluded from returns, such as pierced jewellery. */
  exclusions: z.array(z.string().max(120)).default([]),
  url: z.string().url(),
})

export const warrantySchema = z.object({
  months: z.number().int().min(0).max(600),
  /** What the warranty covers, in one plain sentence. */
  summary: z.string().min(3).max(300),
  url: z.string().url().optional(),
})

export const sizingSchema = z.object({
  /** Sizing standard the store publishes against, such as UK, EU or US. */
  standard: z.string().max(40),
  chartUrl: z.string().url().optional(),
  /** True when the merchant publishes per product measurements. */
  perProductMeasurements: z.boolean().default(false),
})

/**
 * VAT presentation per market. Getting this wrong is a consumer law problem in
 * the EU rather than a formatting one, so the flag is explicit and there is no
 * default: an unanswered question is a blocker, not an assumed "yes".
 */
export const vatSchema = z.object({
  /** True when displayed prices include VAT, as EU consumer law requires. */
  pricesIncludeVat: z.boolean(),
  /** Standard rate applied in this market, as a percentage. */
  ratePct: z.number().min(0).max(100),
  /** The merchant's VAT registration for this market, when they have one. */
  registrationNumber: z.string().max(40).optional(),
})

export const policySchema = z.object({
  market: z.custom<Market>((value) => typeof value === 'string'),
  language: z.string().min(2).max(5),
  returns: returnsPolicySchema,
  delivery: z.array(deliveryPromiseSchema).min(1),
  vat: vatSchema,
  warranty: warrantySchema.optional(),
  sizing: sizingSchema.optional(),
  /** Published policy pages, required by ACP before checkout may be enabled. */
  privacyPolicyUrl: z.string().url(),
  termsUrl: z.string().url(),
  updatedAt: z.string(),
})

export type Policy = z.infer<typeof policySchema>
export type ReturnsPolicy = z.infer<typeof returnsPolicySchema>
export type Vat = z.infer<typeof vatSchema>

export interface PolicyGap {
  field: string
  /** What an agent cannot answer without it. */
  consequence: string
  severity: 'blocker' | 'recommended'
}

export interface PolicyGapOptions {
  /**
   * True when the catalogue has products that come in sizes. Sizing is only
   * asked for when it applies: telling a hifi merchant to publish a size chart
   * is advice they cannot act on, and a list padded with those is a list the
   * merchant stops reading.
   */
  needsSizing?: boolean
}

/**
 * Gaps in a policy set, for the editor and for the presence blocker.
 *
 * Separates what stops a store being eligible from what merely weakens it, so
 * the merchant sees two short lists rather than one long one.
 */
export function policyGaps(policy: Partial<Policy> | undefined, options: PolicyGapOptions = {}): PolicyGap[] {
  const gaps: PolicyGap[] = []

  if (!policy) {
    return [
      {
        field: 'policy',
        consequence: 'no policy data is published, so no agent can answer a delivery or returns question about this store',
        severity: 'blocker',
      },
    ]
  }

  if (!policy.returns) {
    gaps.push({
      field: 'returns',
      consequence: 'an agent cannot state a returns window, which suppresses the store on comparison queries',
      severity: 'blocker',
    })
  }

  if (!policy.delivery || policy.delivery.length === 0) {
    gaps.push({
      field: 'delivery',
      consequence: 'an agent cannot state a delivery promise for any country',
      severity: 'blocker',
    })
  }

  if (!policy.vat) {
    gaps.push({
      field: 'vat',
      consequence: 'VAT presentation is undeclared, so a quoted price cannot be shown as VAT inclusive in the EU',
      severity: 'blocker',
    })
  }

  if (!policy.privacyPolicyUrl || !policy.termsUrl) {
    gaps.push({
      field: 'privacyPolicyUrl and termsUrl',
      consequence: 'the published policy pages are missing, which the product feed specification requires',
      severity: 'recommended',
    })
  }

  if (!policy.warranty) {
    gaps.push({
      field: 'warranty',
      consequence: 'an agent cannot answer a warranty question, which matters most on electronics and appliances',
      severity: 'recommended',
    })
  }

  if (options.needsSizing && !policy.sizing) {
    gaps.push({
      field: 'sizing',
      consequence: 'an agent cannot answer a fit question, and this catalogue has products that come in sizes',
      severity: 'recommended',
    })
  }

  return gaps
}

/** Country codes a policy makes a delivery promise for. */
export function deliveryCountries(policy: Policy): string[] {
  return [...new Set(policy.delivery.map((promise) => promise.country))].sort()
}
