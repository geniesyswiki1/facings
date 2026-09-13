import { describe, expect, it } from 'vitest'
import { connectorAvailable, detectPlatform, detectPlatformFromHtml } from '@showing-up/connectors'

describe('detectPlatformFromHtml', () => {
  it('identifies WooCommerce from the plugin path', () => {
    const result = detectPlatformFromHtml('<link href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">')
    expect(result.platform).toBe('woocommerce')
    expect(result.confidence).toBeGreaterThan(0.8)
  })

  it('identifies Adobe Commerce from the module markers', () => {
    expect(detectPlatformFromHtml('<script>require(["Magento_Ui/js/core/app"])</script>').platform).toBe(
      'adobe-commerce',
    )
  })

  it('identifies PrestaShop, BigCommerce, Wix, Shopware and Shopify', () => {
    expect(detectPlatformFromHtml('<meta name="generator" content="PrestaShop">').platform).toBe('prestashop')
    expect(detectPlatformFromHtml('<img src="https://cdn11.bigcommerce.com/x.jpg">').platform).toBe('bigcommerce')
    expect(detectPlatformFromHtml('<script src="https://static.parastorage.com/x.js">').platform).toBe('wix')
    expect(detectPlatformFromHtml('<link href="/bundles/storefront/app.css">').platform).toBe('shopware')
    expect(detectPlatformFromHtml('<script src="https://cdn.shopify.com/s/x.js">').platform).toBe('shopify')
  })

  it('does not call a bare WordPress theme path WooCommerce', () => {
    // The weak signal alone must not produce a detection: telling a merchant
    // they are on WooCommerce when they are not starts the audit with an error.
    const result = detectPlatformFromHtml('<link href="/wp-content/themes/twentytwentyfour/style.css">')
    expect(result.platform).toBe('unknown')
  })

  it('returns unknown for an unrecognised page', () => {
    expect(detectPlatformFromHtml('<html><body>hello</body></html>').platform).toBe('unknown')
  })
})

describe('detectPlatform', () => {
  it('reports a fetch failure rather than guessing', async () => {
    const result = await detectPlatform('https://example.invalid/', {
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      },
    })
    expect(result.platform).toBe('unknown')
    expect(result.error).toContain('ENOTFOUND')
  })

  it('reports a non 200 as an error', async () => {
    const result = await detectPlatform('https://example.com/', {
      fetchImpl: async () => new Response('nope', { status: 403 }),
    })
    expect(result.error).toBe('HTTP 403')
  })

  it('falls back to response headers when the body carries no fingerprint', async () => {
    const result = await detectPlatform('https://example.com/', {
      fetchImpl: async () =>
        new Response('<html></html>', { status: 200, headers: { 'x-shopware-version': '6.5' } }),
    })
    expect(result.platform).toBe('shopware')
  })

  it('sends an attributable user agent, because this is the merchant own site', async () => {
    let seen: string | undefined
    await detectPlatform('https://example.com/', {
      fetchImpl: async (_url, init) => {
        seen = (init?.headers as Record<string, string>)['user-agent']
        return new Response('<html></html>', { status: 200 })
      },
    })
    expect(seen).toContain('ShowingUpAudit')
  })
})

describe('connectorAvailable', () => {
  it('is true for every mainstream platform we now connect', () => {
    for (const platform of ['woocommerce', 'adobe-commerce', 'prestashop', 'bigcommerce', 'wix', 'shopware'] as const) {
      expect(connectorAvailable(platform)).toBe(true)
    }
  })

  it('is false for Shopify, which we read but never write', () => {
    expect(connectorAvailable('shopify')).toBe(false)
  })

  it('is false for a platform we do not connect', () => {
    expect(connectorAvailable('unknown')).toBe(false)
  })
})

describe('platform detection false positives', () => {
  // Platform decides offeringFor(), which decides what a merchant is pitched.
  // A store wrongly read as Adobe Commerce is a sales call that falls apart,
  // and a Shopify store wrongly read as anything else would be pitched
  // presence, which SHOPIFY_SELLABLE exists to prevent.
  const IMAGE_ONLY = `<html><head>
    <meta property="og:image" content="https://cdn.example/x.png">
    <link rel="apple-touch-icon" type="image/png" href="/icon.png">
    <source srcset="/hero.webp" type="image/webp">
  </head><body>A plain shop with no platform markers.</body></html>`

  it('does not read image/ as a Magento marker', () => {
    // "mage/" is a substring of "image/", so this page used to score
    // adobe-commerce at 90% on the strength of a MIME type.
    const result = detectPlatformFromHtml(IMAGE_ONLY)
    expect(result.platform).not.toBe('adobe-commerce')
  })

  it('still detects a real Magento storefront', () => {
    const magento = `<html><head><script>require(['Magento_Ui/js/core/app'])</script>
      <link href="/static/version1699/frontend/Vendor/theme/en_GB/mage/calendar.css"></head><body></body></html>`
    const result = detectPlatformFromHtml(magento)
    expect(result.platform).toBe('adobe-commerce')
    expect(result.confidence).toBeGreaterThan(0.8)
  })
})

describe('vendor names that are not platform markers', () => {
  // Three detectors in a row matched a bare vendor name anywhere in the page.
  // A bare name appears in icon fonts, footer credits and blog copy, so it
  // identifies nothing.
  it('does not read a Font Awesome brand icon as Shopware', () => {
    const fontAwesome = '<style>.fa-shopping-cart:before{content:"\\f07a"}.fa-shopware:before{content:"\\f5b5"}</style>'
    expect(detectPlatformFromHtml(fontAwesome).platform).not.toBe('shopware')
  })

  it('still detects a real Shopware storefront', () => {
    expect(detectPlatformFromHtml('<script src="/bundles/storefront/js/all.js"></script>').platform).toBe('shopware')
  })

  it('does not read a footer credit as PrestaShop', () => {
    expect(detectPlatformFromHtml('<footer>Powered by PrestaShop, our favourite platform</footer>').platform).not.toBe('prestashop')
  })

  it('still detects a real PrestaShop storefront', () => {
    expect(detectPlatformFromHtml('<script>var prestashop = {"cart":{}};</script>').platform).toBe('prestashop')
  })
})
