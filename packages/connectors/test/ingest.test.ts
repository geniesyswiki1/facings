import { describe, expect, it } from 'vitest'
import {
  attributeCompleteness,
  fetchWooProducts,
  importCsvText,
  importFeedXml,
  normaliseAvailability,
  parseCsv,
} from '@facings/connectors'

describe('parseCsv', () => {
  it('handles quoted fields, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""no"""\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "no"'],
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2)
  })
})

describe('importCsvText', () => {
  const header = 'sku,title,price,url,availability,image link,gtin'

  it('imports a valid row and normalises availability', () => {
    const { products } = importCsvText(
      's1',
      `${header}\nA1,Widget,10.50,https://store.example/a1,instock,https://cdn.example/a.jpg,5060000000001`,
    )
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      sku: 'A1',
      price: 10.5,
      currency: 'GBP',
      availability: 'in_stock',
      gtin: '5060000000001',
    })
  })

  it('skips a bad row with a reason instead of losing the whole file', () => {
    const { products, warnings } = importCsvText(
      's1',
      `${header}\nA1,Widget,10.50,https://store.example/a1,instock,,\nA2,,notaprice,notaurl,,,`,
    )
    expect(products).toHaveLength(1)
    expect(warnings.some((w) => w.includes('row 3 skipped'))).toBe(true)
  })

  it('keeps unrecognised columns as attributes', () => {
    const { products } = importCsvText(
      's1',
      `${header},material\nA1,Widget,10.50,https://store.example/a1,instock,,,Walnut veneer`,
    )
    expect(products[0]?.attributes.material).toBe('Walnut veneer')
  })

  it('reports an empty file', () => {
    expect(importCsvText('s1', '').warnings[0]).toContain('empty')
  })
})

describe('normaliseAvailability', () => {
  it('maps the platform vocabularies onto one set', () => {
    expect(normaliseAvailability('instock')).toBe('in_stock')
    expect(normaliseAvailability('out of stock')).toBe('out_of_stock')
    expect(normaliseAvailability('onbackorder')).toBe('preorder')
    expect(normaliseAvailability('discontinued')).toBe('discontinued')
    expect(normaliseAvailability('something else')).toBe('unknown')
    expect(normaliseAvailability(undefined)).toBe('unknown')
  })
})

describe('importFeedXml', () => {
  const feed = `<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0"><channel>
<lastBuildDate>Wed, 10 Sep 2026 08:00:00 GMT</lastBuildDate>
<item>
  <g:id>SKU1</g:id><g:title>Bookshelf Speaker</g:title><g:price>749.00 GBP</g:price>
  <g:availability>in stock</g:availability><g:link>https://store.example/p/1</g:link>
  <g:image_link>https://cdn.example/1.jpg</g:image_link><g:brand>Northfield</g:brand>
  <g:gtin>5060000000001</g:gtin><g:product_type>Speakers</g:product_type>
</item>
<item><g:id>SKU2</g:id><g:title>No price</g:title><g:link>https://store.example/p/2</g:link></item>
</channel></rss>`

  it('reads a Merchant Center feed item', () => {
    const result = importFeedXml('s1', feed)
    expect(result.products).toHaveLength(1)
    expect(result.products[0]).toMatchObject({
      sku: 'SKU1',
      price: 749,
      currency: 'GBP',
      availability: 'in_stock',
      brand: 'Northfield',
    })
    expect(result.products[0]?.attributes.category).toBe('Speakers')
  })

  it('reports the feed age, which the diff uses to attribute a cause', () => {
    expect(importFeedXml('s1', feed).feedAgeHours).toBeGreaterThan(0)
  })

  it('skips an item with no usable price and says which', () => {
    expect(importFeedXml('s1', feed).warnings.some((w) => w.includes('item 2'))).toBe(true)
  })

  it('reports XML that is not a product feed', () => {
    expect(importFeedXml('s1', '<html></html>').warnings[0]).toContain('no rss channel')
  })
})

describe('fetchWooProducts', () => {
  const product = {
    id: 12,
    sku: 'W-1',
    name: 'Widget',
    price: '10.50',
    regular_price: '12.00',
    stock_status: 'instock',
    permalink: 'https://store.example/widget',
    images: [{ src: 'https://cdn.example/w.jpg' }],
    attributes: [{ name: 'Colour', options: ['Black', 'Walnut'] }],
    categories: [{ name: 'Widgets' }],
    short_description: '<p>A <b>widget</b>.</p>',
  }

  it('requests popularity order with basic auth and maps the payload', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const result = await fetchWooProducts(
      's1',
      { baseUrl: 'https://store.example/', consumerKey: 'ck', consumerSecret: 'cs' },
      {
        limit: 20,
        fetchImpl: async (url, init) => {
          seenUrl = String(url)
          seenAuth = (init?.headers as Record<string, string>).authorization ?? ''
          return new Response(JSON.stringify([product]), { status: 200 })
        },
      },
    )

    expect(seenUrl).toContain('/wp-json/wc/v3/products')
    expect(seenUrl).toContain('orderby=popularity')
    expect(seenAuth.startsWith('Basic ')).toBe(true)
    expect(result.products[0]).toMatchObject({ sku: 'W-1', price: 10.5, availability: 'in_stock' })
    expect(result.products[0]?.attributes.colour).toBe('Black, Walnut')
    expect(result.products[0]?.attributes.description).toBe('A widget .')
  })

  it('explains an auth failure in terms the operator can act on', async () => {
    await expect(
      fetchWooProducts(
        's1',
        { baseUrl: 'https://store.example/', consumerKey: 'ck', consumerSecret: 'cs' },
        { fetchImpl: async () => new Response('denied', { status: 401 }) },
      ),
    ).rejects.toThrow(/read scope/)
  })
})

describe('attributeCompleteness', () => {
  it('rises as the merchant fills the catalogue in', () => {
    const base = {
      storeId: 's1',
      sku: 'A1',
      title: 'Widget',
      price: 10,
      currency: 'GBP',
      availability: 'in_stock' as const,
      url: 'https://store.example/a1',
      attributes: {},
      updatedAt: new Date().toISOString(),
    }
    const thin = attributeCompleteness(base)
    const rich = attributeCompleteness({
      ...base,
      brand: 'Northfield',
      gtin: '5060000000001',
      mpn: 'W-1',
      attributes: { material: 'Oak', dimensions: '10x10', colour: 'Black', size: 'M', description: 'x' },
    })
    expect(thin).toBeLessThan(0.2)
    expect(rich).toBeGreaterThan(thin)
  })
})
