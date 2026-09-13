import { describe, expect, it } from 'vitest'
import { importCsvText } from '@showing-up/connectors'
import {
  INTENT_MIX,
  buildQueries,
  inferCategory,
  inferStoreCategory,
  productType,
  shareableQueryFraction,
} from '@showing-up/benchmark'
import { findCopyViolations } from '@showing-up/shared'

const csv = [
  'sku,title,price,url,availability,brand,gtin',
  'A1,Northfield AM10 Bookshelf Speaker Pair Walnut,749,https://store.example/am10,instock,Northfield Audio,5060000000001',
  'A2,Northfield S8 Active Subwoofer,449,https://store.example/s8,instock,Northfield Audio,5060000000002',
  'A3,Northfield Field 400 Headphones,319,https://store.example/hp400,instock,Northfield Audio,5060000000003',
].join('\n')

const { products } = importCsvText('s1', csv)

describe('buildQueries', () => {
  it('builds the requested number of queries', () => {
    expect(buildQueries(products, { storeId: 's1', market: 'UK', language: 'en', count: 20 })).toHaveLength(20)
  })

  it('is deterministic, so two runs of one audit are comparable', () => {
    const a = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })
    const b = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })
    expect(a.map((q) => q.text)).toEqual(b.map((q) => q.text))
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id))
  })

  it('never repeats a query', () => {
    const texts = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' }).map((q) => q.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('puts merchant seeded queries first', () => {
    const queries = buildQueries(products, {
      storeId: 's1',
      market: 'UK',
      language: 'en',
      seedQueries: ['best hifi speakers for a flat'],
    })
    expect(queries[0]?.text).toBe('best hifi speakers for a flat')
    expect(queries[0]?.source).toBe('manual')
  })

  it('expects one named SKU on a product query and any SKU on a broad one', () => {
    const queries = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })
    const named = queries.find((q) => q.source === 'catalogue')
    const broad = queries.find((q) => q.source === 'benchmark')
    expect(named?.expectedSkus).toHaveLength(1)
    expect(broad?.expectedSkus.length).toBeGreaterThan(1)
  })

  it('uses the market currency and language in the generated text', () => {
    const uk = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })
    const de = buildQueries(products, { storeId: 's1', market: 'DE', language: 'de' })
    expect(uk.some((q) => q.text.includes('£'))).toBe(true)
    expect(de.some((q) => q.text.startsWith('wo kann ich'))).toBe(true)
    expect(de.every((q) => q.market === 'DE' && q.language === 'de')).toBe(true)
  })

  it('does not repeat the brand when the title already carries it', () => {
    const queries = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })
    expect(queries.some((q) => q.text.includes('Northfield Audio Northfield'))).toBe(false)
  })

  it('obeys the copy rules, because these strings reach the report', () => {
    for (const query of buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })) {
      expect(findCopyViolations(query.text)).toEqual([])
    }
  })

  it('returns only the seeds when the catalogue is empty', () => {
    expect(buildQueries([], { storeId: 's1', market: 'UK', language: 'en' })).toEqual([])
  })

  it('allocates twenty slots across the six intent classes', () => {
    expect(Object.values(INTENT_MIX).reduce((sum, value) => sum + value, 0)).toBe(20)
  })
})

describe('category inference', () => {
  it('reads the declared feed category before guessing from the title', () => {
    // The title says speaker, so an electronics answer here would mean the
    // merchant's own taxonomy was ignored.
    const product = { ...(products[0] as (typeof products)[number]), attributes: { category: 'Camping tents' } }
    expect(inferCategory(product)).toBe('sports')
  })

  it('falls back to title keywords', () => {
    expect(inferCategory(products[2] as (typeof products)[number])).toBe('electronics')
  })

  it('takes the dominant category of the catalogue', () => {
    expect(inferStoreCategory(products)).toBe('electronics')
  })

  it('drops the brand, the model code and the unit words from the type phrase', () => {
    expect(productType(products[0] as (typeof products)[number], 'electronics')).toBe('bookshelf speaker')
  })
})

describe('query shareability, the unit economic', () => {
  // Observation cost scales with category times market times query times
  // engine times repeat. Revenue scales with store count. Gross margin
  // therefore improves with density inside a category-market only to the
  // extent that queries are shareable, so this is measured rather than
  // assumed. SPEC 7.
  const uk = buildQueries(products, { storeId: 's1', market: 'UK', language: 'en' })

  it('marks every query one way or the other', () => {
    for (const query of uk) expect(typeof query.shareable).toBe('boolean')
  })

  it('never calls a query naming a specific product shareable', () => {
    for (const query of uk) {
      if (!query.shareable) continue
      expect(query.text.toLowerCase()).not.toContain('northfield')
      expect(query.text.toLowerCase()).not.toContain('am10')
    }
  })

  it('shares a product-type query, because a rival store generates the same text', () => {
    // productType strips the brand, the model code and the unit words, so this
    // text is identical for anyone selling bookshelf speakers in the UK. That
    // is the sharing unit, and it is also what a shopper types.
    const typed = uk.find((query) => query.text === 'bookshelf speaker with free returns')
    expect(typed?.shareable).toBe(true)
    expect(typed?.shareKey).toBeTruthy()
  })

  it('gives two price bands different share keys', () => {
    // A coarse category key would merge these and observe the wrong question.
    const bands = uk.filter((query) => query.text.startsWith('electronics under'))
    expect(bands.length).toBe(2)
    expect(bands[0]?.shareKey).not.toBe(bands[1]?.shareKey)
  })

  it('sets no share key on a query that names a product', () => {
    for (const query of uk) {
      if (query.shareable) continue
      expect(query.shareKey).toBeUndefined()
    }
  })

  it('does not share a product-name query', () => {
    const named = uk.filter((query) => query.source === 'catalogue')
    expect(named.length).toBeGreaterThan(0)
    for (const query of named) expect(query.shareable).toBe(false)
  })

  it('reports the fraction, and counts an unflagged query as not shareable', () => {
    const fraction = shareableQueryFraction(uk)
    expect(fraction).toBeGreaterThan(0)
    expect(fraction).toBeLessThan(1)
    expect(shareableQueryFraction([])).toBe(0)
    const unflagged = uk.map(({ shareable, ...rest }) => rest)
    expect(shareableQueryFraction(unflagged)).toBe(0)
  })

  it('measures 65% on an English catalogue, against a 45% target', () => {
    // Pinned deliberately, and 65% is the ceiling: the remaining 35% is the
    // product_name and comparison intents, which name a specific SKU and are
    // where the critical findings live. Trading those away to raise this
    // number would be optimising the metric against the product.
    expect(shareableQueryFraction(uk)).toBeCloseTo(0.65, 2)
  })

  it('keeps an inherently plural product type plural', () => {
    // "field headphone" is not a query anyone types. A collision bought with
    // the wrong question is worth less than no collision.
    const typed = uk.filter((query) => query.text.includes('headphone'))
    expect(typed.length).toBeGreaterThan(0)
    for (const query of typed) expect(query.text).toContain('headphones')
  })
})
