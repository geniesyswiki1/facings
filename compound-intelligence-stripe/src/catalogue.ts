/**
 * The plan catalogue.
 *
 * One Stripe Product per tier, never one Product carrying several tiers'
 * Prices: Checkout and invoices render the Product name on every line item, so
 * tiers sharing a Product are indistinguishable on a customer's receipt.
 *
 * Multiple Prices on one Product are only for billing variants of the same
 * tier - here, monthly versus annual.
 */

export type Interval = 'month' | 'year'

export interface PlanPrice {
  /** Stable handle used to resolve the Stripe Price at runtime and on re-seed. */
  readonly lookupKey: string
  readonly interval: Interval
  /** Smallest currency unit: 900 = $9.00. */
  readonly unitAmount: number
}

export interface Plan {
  readonly id: string
  readonly name: string
  readonly description: string
  /**
   * Monthly allowance of AI generations. Capped tiers are a pricing decision
   * that can change without an architecture change; metered billing is not.
   * Enforced by the app against the entitlement record, not by Stripe.
   */
  readonly monthlyAllowance: number
  readonly prices: readonly PlanPrice[]
}

export const CURRENCY = 'usd'

export const PLANS: readonly Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For trying the apps out. 200 AI generations a month.',
    monthlyAllowance: 200,
    prices: [
      { lookupKey: 'ci_starter_monthly', interval: 'month', unitAmount: 900 },
      { lookupKey: 'ci_starter_annual', interval: 'year', unitAmount: 9000 },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For daily use. 2,000 AI generations a month.',
    monthlyAllowance: 2_000,
    prices: [
      { lookupKey: 'ci_pro_monthly', interval: 'month', unitAmount: 2400 },
      { lookupKey: 'ci_pro_annual', interval: 'year', unitAmount: 24000 },
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    description: 'For teams shipping with the apps. 10,000 AI generations a month.',
    monthlyAllowance: 10_000,
    prices: [
      { lookupKey: 'ci_studio_monthly', interval: 'month', unitAmount: 7900 },
      { lookupKey: 'ci_studio_annual', interval: 'year', unitAmount: 79000 },
    ],
  },
]

export function planByLookupKey(lookupKey: string): Plan | undefined {
  return PLANS.find((plan) => plan.prices.some((price) => price.lookupKey === lookupKey))
}

export function planById(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id)
}

export const ALL_LOOKUP_KEYS: readonly string[] = PLANS.flatMap((plan) =>
  plan.prices.map((price) => price.lookupKey),
)
