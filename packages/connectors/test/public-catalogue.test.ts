import { describe, expect, it } from 'vitest'
import { discoverPublicCatalogue } from '../src/index.js'

/**
 * Credential-free discovery. The free audit depends on this working against a
 * store that has never heard of us, so the cases below are the shapes real
 * storefronts actually return rather than the shapes the docs promise.
 */

interface Route {
  match: RegExp
  status?: number
  json?: unknown
  text?: string
}

function router(routes: Route[]): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input)
    const route = routes.find((entry) => entry.match.test(url))
    if (!route) return { ok: false, status: 404, json: async () => ({}), text: async () => '', headers: new Headers() }
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: async () => route.json ?? {},
      text: async () => route.text ?? JSON.stringify(route.json ?? {}),
      headers: new Headers(),
    }
  }) as unknown as typeof fetch
}

const SHOPIFY_PAYLOAD = {
  products: [
    {
      handle: 'am10',
      title: 'AM10 bookshelf speaker',
      vendor: 'Northfield',
      product_type: 'Speakers',
      body_html: '<p>A two way speaker.</p>',
      images: [{ src: 'https://cdn.example/am10.jpg' }],
      variants: [{ sku: 'AM10-BLK', price: '349.00', available: true }],
    },
  ],
}

const WOO_PAYLOAD = [
  {
    id: 1,
    name: 'Lagavulin 16',
    sku: 'LAG16',
    permalink: 'https://shop.example/product/lagavulin-16/',
    // The realistic case: the summary is empty and the body is not.
    short_description: '',
    description: '<p>An Islay single malt.</p>',
    prices: { price: '8500', currency_code: 'GBP', currency_minor_unit: 2 },
    is_in_stock: true,
    images: [{ src: 'https://shop.example/lag16.jpg' }],
    categories: [{ name: 'Whisky' }],
  },
]

describe('public catalogue discovery', () => {
  it('reads a Shopify store from products.json', async () => {
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([{ match: /products\.json/, json: SHOPIFY_PAYLOAD }]),
    })
    expect(result.method).toBe('shopify-products-json')
    expect(result.confidence).toBe('high')
    expect(result.products[0]?.sku).toBe('AM10-BLK')
    expect(result.products[0]?.price).toBe(349)
  })

  it('says plainly that products.json states no currency', async () => {
    // A wrong currency is a wrong price, so this cannot be silent.
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([{ match: /products\.json/, json: SHOPIFY_PAYLOAD }]),
    })
    expect(result.warnings.some((w) => w.includes('states no currency'))).toBe(true)
  })

  it('reads a WooCommerce store from the public Store API', async () => {
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([
        { match: /products\.json/, status: 404 },
        { match: /wc\/store\/v1\/products/, json: WOO_PAYLOAD },
      ]),
    })
    expect(result.method).toBe('woocommerce-store-api')
    expect(result.products[0]?.sku).toBe('LAG16')
    // Minor units, converted. 8500 pence is not 8500 pounds.
    expect(result.products[0]?.price).toBe(85)
    expect(result.products[0]?.currency).toBe('GBP')
  })

  it('falls back to the body when the short description is empty', async () => {
    // A live UK store excluded its whole catalogue for "no description"
    // because only short_description was read. That was our defect being
    // reported as the merchant's, which is the worst kind.
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([
        { match: /products\.json/, status: 404 },
        { match: /wc\/store\/v1\/products/, json: WOO_PAYLOAD },
      ]),
    })
    expect(result.products[0]?.attributes.description).toBe('An Islay single malt.')
  })

  it('reads Product JSON-LD from pages found in the sitemap', async () => {
    const sitemap = '<urlset><url><loc>https://shop.example/product/am10</loc></url></urlset>'
    const page = `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'AM10',
      sku: 'AM10',
      url: 'https://shop.example/product/am10',
      offers: { price: '349.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' },
    })}</script></html>`

    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([
        { match: /products\.json/, status: 404 },
        { match: /wc\/store/, status: 404 },
        { match: /sitemap\.xml/, text: sitemap },
        { match: /product\/am10/, text: page },
      ]),
    })
    expect(result.method).toBe('json-ld')
    // Weaker evidence than a platform API, and reported as such.
    expect(result.confidence).toBe('medium')
    expect(result.products[0]?.sku).toBe('AM10')
  })

  it('returns nothing readable as a finding rather than as an error', async () => {
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([]),
    })
    expect(result.method).toBe('none')
    expect(result.products).toEqual([])
    expect(result.warnings.some((w) => w.includes('An agent reading this store today would find nothing'))).toBe(true)
  })

  it('prefers a platform API over a scrape even when both would work', async () => {
    const result = await discoverPublicCatalogue('https://shop.example', {
      fetchImpl: router([
        { match: /products\.json/, json: SHOPIFY_PAYLOAD },
        { match: /sitemap\.xml/, text: '<urlset><url><loc>https://shop.example/product/x</loc></url></urlset>' },
      ]),
    })
    expect(result.method).toBe('shopify-products-json')
  })
})
