/**
 * Subscription pricing across the packaged regions. SPEC 5.
 *
 * One list price in GBP, converted at a fixed rate per currency and rounded to
 * a whole unit. Fixed rather than live because a subscription price that moves
 * with the spot rate is a support ticket, not a feature: the merchant sees a
 * different number on the pricing page than on their invoice.
 *
 * The rates are pinned as data with the date they were set, so a review is a
 * diff rather than an archaeology exercise. Margin therefore drifts slightly
 * between regions as rates move, which is the accepted cost of a stable price.
 *
 * Note this is our billing rail and has nothing to do with a merchant's own
 * payment provider, which stays provider agnostic. See CLAUDE.md. Facings
 * revenue is taken through Stripe managed payments, with Stripe as merchant of
 * record, which is what covers EU VAT registration and US sales tax
 * registration on our own subscriptions.
 */

import type { Region } from './markets.js'

export type Tier = 'audit' | 'starter' | 'growth' | 'scale' | 'agency'

/** The list price in GBP, per store per month. SPEC 5. */
export const GBP_LIST: Record<Tier, number> = {
  audit: 0,
  starter: 49,
  growth: 149,
  scale: 499,
  agency: 999,
}

/** Agency tier adds a per client store fee on top of the base. */
export const GBP_AGENCY_PER_STORE = 99

/**
 * Fixed conversion rates from GBP, reviewed quarterly.
 *
 * Set 13 September 2026. A rate that has moved more than 5 percent since this
 * date is the trigger to re-cut the table, not to convert live.
 */
export const RATES_AS_OF = '2026-09-13'

export const GBP_RATES: Record<string, number> = {
  GBP: 1,
  USD: 1.27,
  EUR: 1.17,
  CHF: 1.12,
}

/** The billing currency for each region. Swiss customers are billed in CHF. */
export const REGION_BILLING_CURRENCY: Record<Region, string> = {
  US: 'USD',
  UK: 'GBP',
  DACH: 'EUR',
}

/**
 * Converts a GBP list price and rounds to a whole unit.
 *
 * Whole units rather than a .99 ending: the buyer is a head of e-commerce
 * reading a procurement line, and SPEC 2.3 asks for plain and measured.
 */
export function convertFromGbp(gbp: number, currency: string): number {
  const rate = GBP_RATES[currency]
  if (rate === undefined) throw new Error(`no fixed rate for ${currency}`)
  return Math.round(gbp * rate)
}

export interface TierPrice {
  tier: Tier
  currency: string
  amount: number
  /** Present on the agency tier only. */
  perClientStore?: number
}

/** The price of one tier in one currency. */
export function tierPrice(tier: Tier, currency: string): TierPrice {
  const amount = convertFromGbp(GBP_LIST[tier], currency)
  return tier === 'agency'
    ? { tier, currency, amount, perClientStore: convertFromGbp(GBP_AGENCY_PER_STORE, currency) }
    : { tier, currency, amount }
}

/** The full price card for a region, in that region's billing currency. */
export function priceCard(region: Region): TierPrice[] {
  const currency = REGION_BILLING_CURRENCY[region]
  return (Object.keys(GBP_LIST) as Tier[]).map((tier) => tierPrice(tier, currency))
}

/**
 * Annual billing is ten months for twelve. SPEC 5, unchanged by region so the
 * discount reads the same everywhere.
 */
export function annualPrice(tier: Tier, currency: string): number {
  return tierPrice(tier, currency).amount * 10
}
