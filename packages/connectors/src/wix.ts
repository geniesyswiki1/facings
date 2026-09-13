import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Wix Stores catalogue connector, read-only.
 *
 * Wix issues an API key at account level and requires the site id alongside
 * it, because one account commonly holds many sites. A key without the site
 * header reads the wrong catalogue or none, so both are required here rather
 * than optional.
 *
 * Wix prices arrive already formatted for the site's locale as well as as a
 * number. We take the number: SPEC forbids comparing prices as strings, and a
 * formatted "1.299,00 EUR" is a string.
 */

export interface WixCredentials {
  /** API key from the Wix account dashboard with Wix Stores read permission. */
  apiKey: string
  /** Site id the key should act against. */
  siteId: string
  /** Public site origin, used to build product URLs when Wix returns a relative one. */
  siteUrl: string
}

export interface WixFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  defaultCurrency?: string
}

export interface WixFetchResult {
  products: Product[]
  warnings: string[]
}

interface WixProduct {
  id: string
  name?: string
  sku?: string
  visible?: boolean
  productType?: string
  description?: string
  brand?: string
  ribbon?: string
  priceData?: { price?: number; currency?: string }
  stock?: { inStock?: boolean; inventoryStatus?: string }
  media?: { mainMedia?: { image?: { url?: string } } }
  productPageUrl?: { base?: string; path?: string }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetchWixProducts(
  storeId: string,
  credentials: WixCredentials,
  options: WixFetchOptions = {},
): Promise<WixFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'GBP' } = options
  const warnings: string[] = [
    'Wix Stores exposes no sales rank over the catalogue API, so catalogue order is used and is not a bestseller ranking',
  ]

  const response = await fetchImpl('https://www.wixapis.com/stores/v1/products/query', {
    method: 'POST',
    headers: {
      authorization: credentials.apiKey,
      'wix-site-id': credentials.siteId,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'ShowingUpAudit/0.1',
    },
    body: JSON.stringify({ query: { paging: { limit } } }),
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('Wix rejected the credentials. The API key needs Wix Stores read permission and the site id must match the store.')
  }
  if (!response.ok) {
    throw new Error(`Wix Stores API returned HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as { products?: WixProduct[] }
  const products: Product[] = []

  for (const item of payload.products ?? []) {
    if (item.visible === false) {
      warnings.push(`product ${item.name ?? item.id} skipped, it is hidden on the storefront so no agent can link to it`)
      continue
    }

    const base = item.productPageUrl?.base ?? credentials.siteUrl
    const path = item.productPageUrl?.path ?? ''
    const attributes: Record<string, string> = {}
    if (item.description) attributes.description = stripHtml(item.description)
    if (item.productType) attributes.category = item.productType

    const candidate = {
      sku: item.sku?.trim() || `wix-${item.id}`,
      title: item.name ?? '',
      price: item.priceData?.price ?? 0,
      currency: item.priceData?.currency?.trim() || defaultCurrency,
      availability: item.stock?.inStock === false ? 'out_of_stock' : 'in_stock',
      url: new URL(path || '/', base).toString(),
      image: item.media?.mainMedia?.image?.url,
      brand: item.brand?.trim() || undefined,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`product ${item.name ?? item.id} skipped, ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  return { products: products.slice(0, limit), warnings }
}
