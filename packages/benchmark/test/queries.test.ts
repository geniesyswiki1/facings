import { describe, expect, it } from 'vitest'
import { importCsvText } from '@facings/connectors'
import { INTENT_MIX, buildQueries, inferCategory, inferStoreCategory, productType } from '@facings/benchmark'
import { findCopyViolations } from '@facings/shared'

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
