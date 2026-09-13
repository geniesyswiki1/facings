import { describe, expect, it } from 'vitest'
import type { Policy } from '../src/policy-schema.js'
import { policyGaps, policySchema } from '../src/policy-schema.js'

/**
 * The market-aware half of the policy editor. What counts as a complete policy
 * is not the same in Boston, Vienna and Zurich, and these are the differences
 * that would otherwise be reported as merchant error.
 */

function basePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    market: 'DE',
    language: 'de',
    returns: {
      windowDays: 30,
      returnShippingPaidBy: 'merchant',
      restockingFee: false,
      exclusions: [],
      url: 'https://example.test/returns',
    },
    delivery: [{ country: 'DE', minDays: 1, maxDays: 3, cost: 0, currency: 'EUR' }],
    tax: { mode: 'inclusive', pricesIncludeTax: true, ratePct: 19 },
    privacyPolicyUrl: 'https://example.test/privacy',
    termsUrl: 'https://example.test/terms',
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Policy
}

const blockerFields = (policy: Partial<Policy>, market: Policy['market']) =>
  policyGaps(policy, { market })
    .filter((gap) => gap.severity === 'blocker')
    .map((gap) => gap.field)

describe('tax presentation by market', () => {
  it('accepts the inclusive branch in an inclusive market', () => {
    expect(blockerFields(basePolicy(), 'DE')).toEqual([])
  })

  it('blocks an inclusive market that excludes tax from the displayed price', () => {
    const policy = basePolicy({ tax: { mode: 'inclusive', pricesIncludeTax: false, ratePct: 20 } })
    const gaps = policyGaps(policy, { market: 'AT' })
    const gap = gaps.find((g) => g.field === 'tax.pricesIncludeTax')
    expect(gap?.severity).toBe('blocker')
    expect(gap?.consequence).toContain('price marking law')
  })

  it('accepts the exclusive branch in the US without asking for a rate', () => {
    const policy = basePolicy({
      market: 'US',
      language: 'en',
      returns: { ...basePolicy().returns, windowDays: 30 },
      delivery: [{ country: 'US', minDays: 2, maxDays: 5, cost: 0, currency: 'USD' }],
      tax: { mode: 'exclusive', collectsIn: ['CA', 'NY'], estimateShownBeforeCheckout: true },
    })
    expect(policySchema.safeParse(policy).success).toBe(true)
    expect(blockerFields(policy, 'US')).toEqual([])
  })

  it('names the local tax in the blocker text', () => {
    const gaps = policyGaps({ ...basePolicy(), tax: undefined }, { market: 'CH' })
    expect(gaps.find((g) => g.field === 'tax')?.consequence).toContain('MwSt.')
  })
})

describe('returns against the statutory floor', () => {
  it('blocks a window shorter than the law in an EU market', () => {
    const policy = basePolicy({ returns: { ...basePolicy().returns, windowDays: 7 } })
    const gap = policyGaps(policy, { market: 'AT' }).find((g) => g.field === 'returns.windowDays')
    expect(gap?.severity).toBe('blocker')
    expect(gap?.consequence).toContain('14')
  })

  it('accepts the same seven days in Switzerland, which has no statutory window', () => {
    const policy = basePolicy({
      market: 'CH',
      returns: { ...basePolicy().returns, windowDays: 7 },
      delivery: [{ country: 'CH', minDays: 1, maxDays: 3, cost: 0, currency: 'CHF' }],
      tax: { mode: 'inclusive', pricesIncludeTax: true, ratePct: 8.1 },
    })
    expect(blockerFields(policy, 'CH')).toEqual([])
  })

  it('nudges a market with no statutory window and no published one', () => {
    const policy = basePolicy({
      market: 'US',
      returns: { ...basePolicy().returns, windowDays: 0 },
      tax: { mode: 'exclusive', collectsIn: [], estimateShownBeforeCheckout: false },
    })
    const gap = policyGaps(policy, { market: 'US' }).find((g) => g.field === 'returns.windowDays')
    expect(gap?.severity).toBe('recommended')
    expect(gap?.consequence).toContain('no statutory returns window')
  })

  it('still works without a market, for a store that has not picked one', () => {
    expect(() => policyGaps(basePolicy())).not.toThrow()
    expect(blockerFields(basePolicy(), 'DE')).toEqual([])
  })
})
