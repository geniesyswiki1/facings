import { describe, expect, it } from 'vitest'
import type { Card, Observation, Product, Query } from '@showing-up/shared'
import { findCopyViolations } from '@showing-up/shared'
import { buildHeadlines, diffObservation, revenueAtRisk, scorePresence, severityRank } from '@showing-up/diff'

function product(overrides: Partial<Product> = {}): Product {
  return {
    storeId: 's1',
    sku: 'A1',
    title: 'Northfield AM10 Bookshelf Speaker Pair Walnut',
    price: 749,
    currency: 'GBP',
    availability: 'in_stock',
    url: 'https://store.example/products/am10-walnut',
    image: 'https://cdn.store.example/am10-walnut.jpg',
    brand: 'Northfield Audio',
    gtin: '5060123456781',
    mpn: 'AM10-WAL',
    marginPct: 38,
    attributes: { material: 'Walnut', colour: 'Walnut', description: 'A speaker.' },
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

function namedQuery(overrides: Partial<Query> = {}): Query {
  return {
    id: 'q1',
    storeId: 's1',
    text: 'where can I buy Northfield AM10 Bookshelf Speaker Pair Walnut',
    market: 'UK',
    language: 'en',
    source: 'catalogue',
    volumeProxy: 0.9,
    expectedSkus: ['A1'],
    ...overrides,
  }
}

function observation(cards: Card[], overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'obs_1',
    storeId: 's1',
    queryId: 'q1',
    engine: 'openai',
    method: 'api',
    observedAt: '2026-09-12T09:00:00.000Z',
    rawRef: { path: 'raw/openai__q1__r0.json', sha256: 'a'.repeat(64), bytes: 100 },
    cards,
    repeat: 0,
    ...overrides,
  }
}

const correctCard: Card = {
  position: 1,
  title: 'Northfield AM10 Bookshelf Speaker Pair Walnut',
  brand: 'Northfield Audio',
  price: 749,
  currency: 'GBP',
  availability: 'in_stock',
  url: 'https://store.example/products/am10-walnut',
  image: 'https://cdn.store.example/am10-walnut.jpg',
}

function diff(cards: Card[], options: { products?: Product[]; query?: Query; feedAgeHours?: number } = {}) {
  return diffObservation({
    query: options.query ?? namedQuery(),
    observation: observation(cards),
    products: options.products ?? [product()],
    ...(options.feedAgeHours !== undefined ? { feedAgeHours: options.feedAgeHours } : {}),
  })
}

describe('a correct rendering', () => {
  it('produces no findings', () => {
    expect(diff([correctCard])).toEqual([])
  })

  it('tolerates a price within the tolerance, such as a rounding difference', () => {
    expect(diff([{ ...correctCard, price: 749.004 }])).toEqual([])
  })

  it('does not invent findings from values the engine did not state', () => {
    const findings = diff([{ position: 1, title: correctCard.title, url: correctCard.url }])
    expect(findings).toEqual([])
  })
})

describe('price', () => {
  it('raises a mismatch with the expected and observed values on the finding', () => {
    const [finding] = diff([{ ...correctCard, price: 869 }])
    expect(finding).toMatchObject({ type: 'price_mismatch', sku: 'A1', severity: 'critical' })
    expect(finding?.expected).toMatchObject({ price: 749, currency: 'GBP' })
    expect(finding?.observed).toMatchObject({ price: 869 })
  })

  it('grades a small difference below a large one', () => {
    const small = diff([{ ...correctCard, price: 755 }])[0]
    const large = diff([{ ...correctCard, price: 1390 }])[0]
    expect(severityRank(small?.severity ?? 'low')).toBeLessThan(severityRank(large?.severity ?? 'low'))
  })

  it('raises a mismatch when the engine quotes another currency for the market', () => {
    const [finding] = diff([{ ...correctCard, price: 749, currency: 'USD' }])
    expect(finding?.type).toBe('price_mismatch')
    expect(finding?.cause).toContain('another currency')
  })

  it('blames a stale feed when the feed is old, and the page otherwise', () => {
    const stale = diff([{ ...correctCard, price: 869 }], { feedAgeHours: 72 })[0]
    const fresh = diff([{ ...correctCard, price: 869 }], { feedAgeHours: 2 })[0]
    expect(stale?.cause).toContain('72 hours old')
    expect(fresh?.cause).toContain('feed disagree')
  })
})

describe('availability', () => {
  it('raises a stale stock finding', () => {
    const [finding] = diff([{ ...correctCard, availability: 'out_of_stock' }])
    expect(finding).toMatchObject({ type: 'availability_stale', severity: 'high' })
  })

  it('raises a critical finding when a discontinued product is still recommended', () => {
    const [finding] = diff([{ ...correctCard, availability: 'in_stock' }], {
      products: [product({ availability: 'discontinued' })],
    })
    expect(finding).toMatchObject({ type: 'discontinued_recommended', severity: 'critical' })
  })

  it('ignores an availability the engine could not state', () => {
    expect(diff([{ ...correctCard, availability: 'unknown' }])).toEqual([])
  })
})

describe('absence and substitution', () => {
  it('raises bestseller_absent for a named SKU that rendered nowhere', () => {
    const [finding] = diff([])
    expect(finding).toMatchObject({ type: 'bestseller_absent', sku: 'A1' })
    expect(finding?.severity).toBe('critical')
  })

  it('explains absence by a missing product code when there is one', () => {
    const [finding] = diff([], { products: [product({ gtin: undefined, mpn: undefined })] })
    expect(finding?.cause).toContain('no GTIN or MPN')
  })

  it('explains absence by a thin attribute set', () => {
    const [finding] = diff([], { products: [product({ attributes: {} })] })
    expect(finding?.cause).toContain('thin attribute set')
  })

  it('raises one substitution finding for a broad query, not one absence per SKU', () => {
    const broad = namedQuery({ id: 'q2', text: 'best bookshelf speaker under £1000', source: 'benchmark', expectedSkus: ['A1', 'A2'] })
    const findings = diffObservation({
      query: broad,
      observation: observation([{ position: 1, title: 'Halloway Studio Monitors', brand: 'Halloway', url: 'https://halloway.example/p' }], { queryId: 'q2' }),
      products: [product(), product({ sku: 'A2', title: 'Northfield S8 Active Subwoofer' })],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ type: 'competitor_substituted', sku: null })
  })

  it('raises nothing when a broad query rendered one of the merchant products', () => {
    const broad = namedQuery({ expectedSkus: ['A1', 'A2'], source: 'benchmark' })
    expect(diff([correctCard], { query: broad, products: [product(), product({ sku: 'A2', title: 'Northfield S8 Active Subwoofer' })] })).toEqual([])
  })
})

describe('variant, link, image and rating', () => {
  it('raises wrong_variant when the card carries a variant the catalogue does not', () => {
    const [finding] = diff([{ ...correctCard, title: 'Northfield AM10 Bookshelf Speaker Pair Black' }])
    expect(finding?.type).toBe('wrong_variant')
    expect(String(finding?.observed.detail)).toContain('black')
  })

  it('grades an off-domain link above an on-domain one', () => {
    const offDomain = diff([{ ...correctCard, url: 'https://other.example/am10' }])[0]
    const onDomain = diff([{ ...correctCard, url: 'https://store.example/collections/speakers' }])[0]
    expect(offDomain?.severity && onDomain?.severity && severityRank(offDomain.severity)).toBeGreaterThan(
      severityRank(onDomain?.severity ?? 'low'),
    )
    expect(offDomain?.cause).toContain('another retailer')
  })

  it('accepts a CDN resized image as the catalogue image', () => {
    expect(diff([{ ...correctCard, image: 'https://cdn.store.example/cache/am10-walnut_600x600.jpg' }])).toEqual([])
  })

  it('raises broken_image for a genuinely different image', () => {
    const [finding] = diff([{ ...correctCard, image: 'https://cdn.store.example/s8-sub.jpg' }])
    expect(finding?.type).toBe('broken_image')
  })

  it('raises unverified_rating for a rating the store does not publish', () => {
    const [finding] = diff([{ ...correctCard, rating: 4.5 }])
    expect(finding).toMatchObject({ type: 'unverified_rating', severity: 'low' })
    expect(finding?.cause).toContain('third party')
  })

  it('accepts a rating the store does publish', () => {
    expect(diff([{ ...correctCard, rating: 4.5 }], { products: [product({ attributes: { rating: '4.5' } })] })).toEqual([])
  })
})

describe('provenance and ranking', () => {
  it('marks every deterministic finding as not inferred and ties it to the observation', () => {
    for (const finding of diff([{ ...correctCard, price: 869, availability: 'out_of_stock' }])) {
      expect(finding.causeInferred).toBe(false)
      expect(finding.observationId).toBe('obs_1')
      expect(finding.cause.length).toBeGreaterThan(10)
      expect(findCopyViolations(finding.cause)).toEqual([])
    }
  })

  it('raises nothing from an errored observation', () => {
    const findings = diffObservation({
      query: namedQuery(),
      observation: observation([], { error: 'HTTP 429' }),
      products: [product()],
    })
    expect(findings).toEqual([])
  })

  it('ranks revenue at risk by demand, margin and severity', () => {
    const highDemand = revenueAtRisk(namedQuery({ volumeProxy: 0.9 }), product(), 'critical')
    const lowDemand = revenueAtRisk(namedQuery({ volumeProxy: 0.3 }), product(), 'critical')
    const cheap = revenueAtRisk(namedQuery({ volumeProxy: 0.9 }), product({ price: 79 }), 'critical')
    expect(highDemand).toBeGreaterThan(lowDemand)
    expect(highDemand).toBeGreaterThan(cheap)
  })

  it('assumes a default margin when the merchant supplied none', () => {
    expect(revenueAtRisk(namedQuery(), product({ marginPct: undefined }), 'high')).toBeGreaterThan(0)
  })
})

describe('presence', () => {
  const reproducible = { engine: 'openai' as const, method: 'api' as const, repeats: 3, rate: 1, observable: true, queriesMeasured: 2, errors: 0 }

  it('is rendering when the merchant cards appear', () => {
    const presence = scorePresence({
      storeId: 's1',
      engine: 'openai',
      queries: [namedQuery()],
      observations: [observation([correctCard])],
      findings: [],
      products: [product()],
      reproducibility: reproducible,
    })
    expect(presence).toMatchObject({ state: 'rendering', cardRate: 1, accuracyRate: 1 })
  })

  it('is ingested when the engine cites the store but renders no product card', () => {
    const presence = scorePresence({
      storeId: 's1',
      engine: 'openai',
      queries: [namedQuery()],
      observations: [observation([{ position: 1, title: 'A review of speakers', url: 'https://store.example/blog/guide' }])],
      findings: [],
      products: [product()],
      reproducibility: reproducible,
    })
    expect(presence.state).toBe('ingested')
    expect(presence.blocker).toContain('renders no product card')
  })

  it('is absent when there is neither a card nor a citation', () => {
    const presence = scorePresence({
      storeId: 's1',
      engine: 'openai',
      queries: [namedQuery()],
      observations: [observation([{ position: 1, title: 'Halloway Monitors', url: 'https://halloway.example/p' }])],
      findings: [],
      products: [product()],
      reproducibility: reproducible,
    })
    expect(presence.state).toBe('absent')
  })

  it('never claims presence on a surface that failed the reproducibility floor', () => {
    const presence = scorePresence({
      storeId: 's1',
      engine: 'copilot',
      queries: [namedQuery()],
      observations: [observation([correctCard], { engine: 'copilot' })],
      findings: [],
      products: [product()],
      reproducibility: { ...reproducible, engine: 'copilot', rate: 0.3, observable: false, note: 'below the 0.8 agreement threshold' },
    })
    expect(presence.state).toBe('not_observable')
    expect(presence.cardRate).toBe(0)
    expect(presence.blocker).toContain('0.8')
  })

  it('is not observable when every attempt errored', () => {
    const presence = scorePresence({
      storeId: 's1',
      engine: 'openai',
      queries: [namedQuery()],
      observations: [observation([], { error: 'HTTP 500' })],
      findings: [],
      products: [product()],
      reproducibility: reproducible,
    })
    expect(presence.state).toBe('not_observable')
    expect(presence.blocker).toContain('error')
  })

  it('lowers the accuracy rate as findings accumulate on rendered cards', () => {
    const findings = diff([{ ...correctCard, price: 869 }])
    const presence = scorePresence({
      storeId: 's1',
      engine: 'openai',
      queries: [namedQuery()],
      observations: [observation([correctCard])],
      findings,
      products: [product()],
      reproducibility: reproducible,
    })
    expect(presence.accuracyRate).toBeLessThan(1)
  })
})

describe('headlines', () => {
  it('returns nothing when there are no findings', () => {
    expect(buildHeadlines([], [product()])).toEqual([])
  })

  it('writes numbers first, obeys the copy rules and names the surface', () => {
    const findings = [...diff([{ ...correctCard, price: 869 }]), ...diff([])]
    const headlines = buildHeadlines(findings, [product()])
    expect(headlines.length).toBeGreaterThan(0)
    for (const headline of headlines) {
      expect(findCopyViolations(headline.text)).toEqual([])
      expect(headline.engines).toContain('ChatGPT')
    }
  })

  it('spreads the three headlines across finding types rather than repeating one', () => {
    const findings = [
      ...diff([{ ...correctCard, price: 869 }]),
      ...diff([{ ...correctCard, price: 900 }]),
      ...diff([{ ...correctCard, availability: 'out_of_stock' }]),
      ...diff([{ ...correctCard, rating: 4.2 }]),
    ]
    const headlines = buildHeadlines(findings, [product()], 3)
    expect(new Set(headlines.map((h) => h.type)).size).toBe(headlines.length)
  })

  it('joins several surfaces as a sentence', () => {
    const findings = [
      ...diff([{ ...correctCard, price: 869 }]),
      ...diffObservation({
        query: namedQuery(),
        observation: observation([{ ...correctCard, price: 869 }], { id: 'obs_2', engine: 'gemini' }),
        products: [product()],
      }),
    ]
    const [headline] = buildHeadlines(findings, [product()])
    expect(headline?.text).toContain('ChatGPT and Gemini')
  })
})
