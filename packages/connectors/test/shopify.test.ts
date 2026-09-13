import { describe, expect, it } from 'vitest'
import { fetchShopifyProducts, offeringFor, readConnectorAvailable, connectorAvailable } from '../src/index.js'

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

describe('what we sell per platform', () => {
  it('sells Shopify accuracy rather than presence hosting', () => {
    expect(offeringFor('shopify')).toBe('accuracy-only')
    expect(offeringFor('woocommerce')).toBe('presence')
  })

  it('can read Shopify without offering it a write connector', () => {
    expect(readConnectorAvailable('shopify')).toBe(true)
    expect(connectorAvailable('shopify')).toBe(false)
  })
})
