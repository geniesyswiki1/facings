import { describe, expect, it } from 'vitest'
import type { Card, Product } from '@facings/shared'
import { MATCH_FLOOR, matchCard, matchCards } from '@facings/diff'

function product(overrides: Partial<Product> = {}): Product {
  return {
    storeId: 's1',
    sku: 'A1',
    title: 'Northfield AM10 Bookshelf Speaker Pair Walnut',
    price: 749,
    currency: 'GBP',
    availability: 'in_stock',
    url: 'https://store.example/products/am10-walnut',
    brand: 'Northfield Audio',
    gtin: '5060123456781',
    mpn: 'AM10-WAL',
    attributes: {},
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

function card(overrides: Partial<Card> = {}): Card {
  return { position: 1, title: 'Northfield AM10 Bookshelf Speaker', ...overrides }
}

describe('matchCard', () => {
  const catalogue = [product(), product({ sku: 'A2', title: 'Northfield S8 Active Subwoofer', gtin: '5060123456804', mpn: 'S8-SUB', url: 'https://store.example/products/s8' })]

  it('matches on a quoted GTIN with full confidence', () => {
    const result = matchCard(card({ evidence: 'GTIN 5060123456804 is in stock.' }), catalogue)
    expect(result).toEqual({ sku: 'A2', confidence: 1, basis: 'gtin' })
  })

  it('matches on a quoted MPN', () => {
    const result = matchCard(card({ title: 'Speaker', evidence: 'part AM10-WAL' }), catalogue)
    expect(result?.basis).toBe('mpn')
  })

  it('matches on an exact product page URL regardless of www or a trailing slash', () => {
    const result = matchCard(card({ title: 'Something else entirely', url: 'https://www.store.example/products/s8/' }), catalogue)
    expect(result).toMatchObject({ sku: 'A2', basis: 'url' })
  })

  it('matches a shortened title by containment, which Jaccard alone would miss', () => {
    const result = matchCard(card(), catalogue)
    expect(result?.sku).toBe('A1')
    expect(result?.confidence).toBeGreaterThan(MATCH_FLOOR)
  })

  it('adds confidence when the brand agrees', () => {
    const withBrand = matchCard(card({ brand: 'Northfield Audio' }), catalogue)
    const withoutBrand = matchCard(card(), catalogue)
    expect(withBrand?.confidence).toBeGreaterThanOrEqual(withoutBrand?.confidence ?? 0)
    expect(withBrand?.basis).toBe('title-brand')
  })

  it('returns no match for another retailer product rather than matching weakly', () => {
    // A wrong match invents a finding about a product the engine never named,
    // and one of those ends the merchant conversation.
    expect(matchCard(card({ title: 'Halloway Studio Monitors' }), catalogue)).toBeUndefined()
  })

  it('ignores a GTIN too short to be one', () => {
    const shortGtin = [product({ gtin: '123' })]
    expect(matchCard(card({ title: 'zzz', evidence: 'code 123' }), shortGtin)).toBeUndefined()
  })

  it('returns undefined against an empty catalogue', () => {
    expect(matchCard(card(), [])).toBeUndefined()
  })
})

describe('matchCards', () => {
  it('annotates matched cards and leaves the rest alone', () => {
    const cards = matchCards([card(), card({ title: 'Halloway Studio Monitors', position: 2 })], [product()])
    expect(cards[0]?.matchedSku).toBe('A1')
    expect(cards[0]?.matchConfidence).toBeGreaterThan(0)
    expect(cards[1]?.matchedSku).toBeUndefined()
  })
})
