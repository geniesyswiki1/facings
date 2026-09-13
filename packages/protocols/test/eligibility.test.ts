import { describe, expect, it } from 'vitest'
import type { EngineId, Store } from '@showing-up/shared'
import {
  buildAcpFeed,
  catalogueHasSizes,
  buildUcpManifest,
  generateSigningKeyPair,
  policyGaps,
  scoreAllEligibility,
  scoreEligibility,
  validateUcpManifest,
} from '@showing-up/protocols'
import { catalogue, germanPolicy, product } from './fixtures.js'

const store: Store = {
  id: 'str_1',
  domain: 'nordlicht-audio.de',
  url: 'https://nordlicht-audio.de/',
  platform: 'woocommerce',
  market: 'DE',
  language: 'de',
  psp: 'adyen',
  connectorStatus: 'connected',
}

const { publicJwk } = generateSigningKeyPair()

function context(overrides: { policy?: ReturnType<typeof germanPolicy> | undefined; products?: ReturnType<typeof catalogue> } = {}) {
  const products = overrides.products ?? catalogue()
  const policy = 'policy' in overrides ? overrides.policy : germanPolicy()
  const feed = buildAcpFeed(products, policy ? { policy } : {})
  const manifest = validateUcpManifest(
    buildUcpManifest({
      store,
      acpFeedUrl: 'https://feeds.showingup.ai/acp/str_1.jsonl.gz',
      signingKeys: [publicJwk],
      ...(policy ? { policy } : {}),
    }),
  )
  return { products, feed, manifest, ...(policy ? { policy } : {}) }
}

describe('scoreEligibility', () => {
  it('is eligible on every surface for a complete store', () => {
    const engines: EngineId[] = ['openai', 'gemini', 'google-ai-mode', 'copilot', 'perplexity', 'claude']
    const results = scoreAllEligibility(context(), engines)
    expect(results).toHaveLength(6)
    for (const result of results) {
      expect(result.eligible, `${result.engine}: ${result.blockers.join('; ')}`).toBe(true)
    }
  })

  it('blocks every surface when no catalogue is connected', () => {
    const result = scoreEligibility({ engine: 'openai', ...context({ products: [] }) })
    expect(result.eligible).toBe(false)
    expect(result.blockers[0]).toContain('no catalogue')
  })

  it('blocks when no product reached the feed', () => {
    const undescribed = [product({ attributes: {} })]
    const result = scoreEligibility({ engine: 'openai', ...context({ products: undescribed }) })
    expect(result.eligible).toBe(false)
    expect(result.blockers.some((blocker) => blocker.includes('nothing for this surface to read'))).toBe(true)
  })

  it('blocks on missing policy data, and names what an agent cannot answer', () => {
    const result = scoreEligibility({ engine: 'openai', ...context({ policy: undefined }) })
    expect(result.eligible).toBe(false)
    expect(result.blockers.join(' ')).toContain('no agent can answer')
  })

  it('reports feed coverage so a partly published catalogue is visible', () => {
    // One of the four fixtures is discontinued and correctly excluded.
    const result = scoreEligibility({ engine: 'openai', ...context() })
    expect(result.feedCoverage).toBe(0.75)
    expect(result.warnings.some((warning) => warning.includes('3 of 4 products'))).toBe(true)
  })

  it('reports an unchecked Merchant Center as unknown, never as a pass', () => {
    const result = scoreEligibility({ engine: 'gemini', ...context() })
    expect(result.warnings.some((warning) => warning.includes('reported as unknown'))).toBe(true)
    expect(result.eligible).toBe(true)
  })

  it('blocks when Merchant Center has disapproved items', () => {
    const result = scoreEligibility({
      engine: 'copilot',
      ...context(),
      merchantCentre: { connected: true, disapprovedSkus: ['NLA-AM10-WAL'] },
    })
    expect(result.eligible).toBe(false)
    expect(result.blockers.join(' ')).toContain('disapproved 1 items')
  })

  it('blocks the Google surfaces, and only those, on an invalid manifest', () => {
    const base = context()
    const broken = { ...base, manifest: { valid: false, issues: [{ field: 'ucp.version', message: 'is wrong', severity: 'error' as const }] } }

    expect(scoreEligibility({ engine: 'gemini', ...broken }).eligible).toBe(false)
    expect(scoreEligibility({ engine: 'google-ai-mode', ...broken }).eligible).toBe(false)
    // ChatGPT reads the ACP feed, not the UCP manifest, so it is unaffected.
    expect(scoreEligibility({ engine: 'openai', ...broken }).eligible).toBe(true)
  })

  it('surfaces the unconfirmed capability pin as a warning on the UCP surfaces', () => {
    const result = scoreEligibility({ engine: 'gemini', ...context() })
    expect(result.warnings.some((warning) => warning.includes('confirmed against the published specification'))).toBe(true)
  })
})

describe('catalogueHasSizes', () => {
  it('is false for a catalogue of fixed specifications', () => {
    expect(catalogueHasSizes(catalogue())).toBe(false)
    expect(catalogueHasSizes([product({ attributes: { size: '8 inch' } })])).toBe(false)
  })

  it('is true when products carry a size a shopper picks between', () => {
    expect(catalogueHasSizes([product({ attributes: { size: 'XL' } })])).toBe(true)
    expect(catalogueHasSizes([product({ attributes: { size: 'Medium' } })])).toBe(true)
  })
})

describe('policyGaps', () => {
  it('is empty for a complete policy on a catalogue with no sizes', () => {
    expect(policyGaps(germanPolicy())).toEqual([])
  })

  it('asks for a size chart only when the catalogue has sized products', () => {
    // A hifi merchant cannot act on "publish a size chart", so it is not asked.
    expect(policyGaps(germanPolicy(), { needsSizing: false })).toEqual([])
    const gaps = policyGaps(germanPolicy(), { needsSizing: true })
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.field).toBe('sizing')
    expect(gaps[0]?.severity).toBe('recommended')
  })

  it('separates blockers from recommendations', () => {
    const partial = { ...germanPolicy(), warranty: undefined }
    const gaps = policyGaps(partial)
    expect(gaps.every((gap) => gap.severity === 'recommended')).toBe(true)
  })

  it('treats missing delivery and VAT as blockers', () => {
    const gaps = policyGaps({ ...germanPolicy(), delivery: [], tax: undefined as never })
    const blockers = gaps.filter((gap) => gap.severity === 'blocker').map((gap) => gap.field)
    expect(blockers).toContain('delivery')
    expect(blockers).toContain('tax')
  })
})
