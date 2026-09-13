import { describe, expect, it } from 'vitest'
import {
  CONNECTED_PLATFORMS,
  SHOPIFY_COVERED_ENGINES,
  SHOPIFY_SELLABLE,
  connectorAvailable,
  enginesShopifyDoesNotCover,
  fetchShopifyProducts,
  offeringFor,
  readConnectorAvailable,
  sellableToShopify,
} from '../src/index.js'

const CREDENTIALS = { shopDomain: 'northfield-audio.myshopify.com', accessToken: 'shpat_test' }

function respond(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Product/1',
    title: 'Northfield AM10 bookshelf speaker',
    handle: 'northfield-am10',
    vendor: 'Northfield Audio',
    productType: 'Speakers',
    status: 'ACTIVE',
    totalInventory: 12,
    onlineStoreUrl: 'https://northfieldaudio.example/products/northfield-am10',
    description: 'A two way bookshelf speaker.',
    featuredImage: { url: 'https://cdn.example/am10.jpg' },
    variants: {
      nodes: [
        {
          sku: 'AM10-BLK',
          price: '349.00',
          availableForSale: true,
          barcode: '5060123456789',
          selectedOptions: [{ name: 'Colour', value: 'Black' }],
        },
      ],
    },
    ...overrides,
  }
}

describe('the Shopify connector', () => {
  it('reads a published product into the catalogue shape', async () => {
    const result = await fetchShopifyProducts('store-1', CREDENTIALS, {
      fetchImpl: respond({ data: { products: { nodes: [node()] } } }),
    })
    expect(result.products).toHaveLength(1)
    const product = result.products[0]
    expect(product?.sku).toBe('AM10-BLK')
    expect(product?.price).toBe(349)
    expect(product?.brand).toBe('Northfield Audio')
    expect(product?.gtin).toBe('5060123456789')
    expect(product?.availability).toBe('in_stock')
  })

  it('says the bestseller order is a proxy rather than a rank', async () => {
    const result = await fetchShopifyProducts('store-1', CREDENTIALS, {
      fetchImpl: respond({ data: { products: { nodes: [node()] } } }),
    })
    // SPEC 2.3 forbids implying a ranking we did not observe, and the Admin
    // API gives no sales rank without the analytics scope.
    expect(result.warnings.some((w) => w.includes('inventory proxy'))).toBe(true)
  })

  it('excludes an unpublished product with the reason instead of guessing a URL', async () => {
    const result = await fetchShopifyProducts('store-1', CREDENTIALS, {
      fetchImpl: respond({ data: { products: { nodes: [node({ onlineStoreUrl: null })] } } }),
    })
    expect(result.products).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('not published to the online store'))).toBe(true)
  })

  it('marks a sold out variant out of stock rather than dropping it', async () => {
    const sold = node({ variants: { nodes: [{ sku: 'AM10-BLK', price: '349.00', availableForSale: false, barcode: null }] } })
    const result = await fetchShopifyProducts('store-1', CREDENTIALS, {
      fetchImpl: respond({ data: { products: { nodes: [sold] } } }),
    })
    expect(result.products[0]?.availability).toBe('out_of_stock')
  })

  it('surfaces a GraphQL error rather than returning an empty catalogue', async () => {
    await expect(
      fetchShopifyProducts('store-1', CREDENTIALS, {
        fetchImpl: respond({ errors: [{ message: 'Access denied for products field' }] }),
      }),
    ).rejects.toThrow(/Access denied/)
  })

  it('explains a missing scope on an HTTP failure', async () => {
    await expect(
      fetchShopifyProducts('store-1', CREDENTIALS, { fetchImpl: respond({}, false, 403) }),
    ).rejects.toThrow(/read_products/)
  })
})

describe('what we sell per platform and market', () => {
  it('sells Shopify accuracy in every packaged market', () => {
    expect(offeringFor('shopify')).toBe('accuracy-only')
  })

  it('sells presence on every other platform', () => {
    for (const platform of ['woocommerce', 'adobe-commerce', 'prestashop', 'bigcommerce', 'wix', 'shopware'] as const) {
      expect(offeringFor(platform)).toBe('presence')
    }
  })

  it('holds the Shopify pitch to exactly three things', () => {
    // Presence and visibility are what Shopify already gives its own
    // merchants. Selling either is how the sales call falls apart.
    expect(sellableToShopify('presence')).toBe(false)
    expect(sellableToShopify('visibility')).toBe(false)
    expect(sellableToShopify('correctness')).toBe(true)
    expect(sellableToShopify('record')).toBe(true)
    expect(sellableToShopify('uncovered-surfaces')).toBe(true)
    expect(SHOPIFY_SELLABLE).toHaveLength(3)
  })

  it('has a catalogue connector for every mainstream platform', () => {
    for (const platform of ['woocommerce', 'adobe-commerce', 'prestashop', 'bigcommerce', 'wix', 'shopware', 'shopify'] as const) {
      expect(CONNECTED_PLATFORMS).toContain(platform)
    }
    // Read-only on Shopify, because we never sell it presence hosting.
    expect(connectorAvailable('shopify')).toBe(false)
    expect(readConnectorAvailable('shopify')).toBe(true)
  })

  it('names the two surfaces Shopify does not report on', () => {
    // These are the pitch. Shopify's own channel list is ChatGPT, Copilot,
    // Google AI Mode, Gemini and Shop, so a Shopify merchant has no reporting
    // on Perplexity or Claude from anybody.
    expect(enginesShopifyDoesNotCover()).toEqual(['perplexity', 'claude'])
  })

  it('does not claim Shopify is blind to the surfaces it does cover', () => {
    // Guards the corrected fact: Shopify observes presence on these four.
    expect(SHOPIFY_COVERED_ENGINES).toContain('openai')
    expect(SHOPIFY_COVERED_ENGINES).toContain('copilot')
    expect(SHOPIFY_COVERED_ENGINES).toContain('gemini')
    expect(SHOPIFY_COVERED_ENGINES).toContain('google-ai-mode')
  })
})
