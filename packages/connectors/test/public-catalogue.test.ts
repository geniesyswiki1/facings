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

describe('sitemap discovery, against the shapes real stores actually use', () => {
  // Every case here is a store this failed on before the fix. None of them
  // were the merchant's problem: an agent reading them would have found the
  // catalogue, so reporting "publishes nothing" would have been our bug
  // printed in their report.
  const PRODUCT_PAGE = `<html><head><script type="application/ld+json">
    {"@type":"Product","name":"Bench clamp","sku":"BC-1","offers":{"@type":"Offer","price":"24.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
  </script></head><body></body></html>`

  function store(routes: Record<string, string>): typeof fetch {
    return (async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = new URL(url).pathname
      const body = routes[path]
      if (body === undefined) return { ok: false, status: 404, text: async () => '', json: async () => ({}) }
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }
    }) as unknown as typeof fetch
  }

  it('reads the sitemap location out of robots.txt', async () => {
    // Rockler declares /media/sitemap.xml, which is the documented place to
    // declare it. A request to /sitemap.xml returned the HTML homepage with a
    // 200, so nothing errored and the store looked empty.
    const result = await discoverPublicCatalogue('https://rockler.example', {
      limit: 2,
      fetchImpl: store({
        '/robots.txt': 'User-agent: *\nSitemap: https://rockler.example/media/sitemap.xml\n',
        '/sitemap.xml': '<!doctype html><html><body>homepage</body></html>',
        '/media/sitemap.xml': '<urlset><url><loc>https://rockler.example/hand-tools/clamps</loc></url></urlset>',
        '/hand-tools/clamps': PRODUCT_PAGE,
      }),
    })
    expect(result.method).toBe('json-ld')
    expect(result.products).toHaveLength(1)
  })

  it('does not mistake a soft 404 homepage for a sitemap', async () => {
    const result = await discoverPublicCatalogue('https://soft404.example', {
      limit: 2,
      fetchImpl: store({ '/sitemap.xml': '<!doctype html><html><body>nope</body></html>' }),
    })
    expect(result.method).toBe('none')
    expect(result.products).toHaveLength(0)
  })

  it('follows a sitemap index whose children are not named .xml', async () => {
    // Sportsman's Warehouse indexes children at /customsitemap/HOMEPAGE-en-USD.
    // Matching the URL string for ".xml" discarded every child it had.
    const result = await discoverPublicCatalogue('https://sportsmans.example', {
      limit: 2,
      fetchImpl: store({
        '/robots.txt': 'Sitemap: https://sportsmans.example/sitemap.xml\n',
        '/sitemap.xml': '<sitemapindex><sitemap><loc>https://sportsmans.example/customsitemap/PRODUCTS-en-USD</loc></sitemap></sitemapindex>',
        '/customsitemap/PRODUCTS-en-USD': '<urlset><url><loc>https://sportsmans.example/marlin-xt-22-magazine</loc></url></urlset>',
        '/marlin-xt-22-magazine': PRODUCT_PAGE,
      }),
    })
    expect(result.method).toBe('json-ld')
    expect(result.products[0]?.sku).toBe('BC-1')
  })

  it('accepts a clean product URL with no /product/ in it', async () => {
    const result = await discoverPublicCatalogue('https://clean.example', {
      limit: 2,
      fetchImpl: store({
        '/sitemap.xml': '<urlset><url><loc>https://clean.example/power-tools/dust-collection</loc></url></urlset>',
        '/power-tools/dust-collection': PRODUCT_PAGE,
      }),
    })
    expect(result.products).toHaveLength(1)
  })

  it('says the catalogue is a sample rather than the whole of it', async () => {
    const result = await discoverPublicCatalogue('https://sample.example', {
      limit: 1,
      fetchImpl: store({
        '/sitemap.xml': '<urlset><url><loc>https://sample.example/a-clamp</loc></url></urlset>',
        '/a-clamp': PRODUCT_PAGE,
      }),
    })
    expect(result.warnings.some((w) => w.includes('sample rather than the whole'))).toBe(true)
  })
})
