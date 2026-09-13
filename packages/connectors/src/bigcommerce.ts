import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * BigCommerce Catalog API v3 connector, read-only.
 *
 * Unlike the others here, BigCommerce exposes a real popularity signal:
 * `total_sold` is sortable, so bestseller order is an actual ranking rather
 * than a proxy, and the audit says so. That distinction matters because SPEC
 * 2.3 forbids implying a ranking we did not observe, and here we did.
 */

export interface BigCommerceCredentials {
  /** Store hash from the API path, not the storefront domain. */
  storeHash: string
  /** X-Auth-Token from a store API account with Products read-only scope. */
  accessToken: string
  /** Storefront origin, used to build public product URLs. */
  storefrontUrl: string
}

export interface BigCommerceFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  defaultCurrency?: string
}

export interface BigCommerceFetchResult {
  products: Product[]
  warnings: string[]
}

interface BigCommerceProduct {
  id: number
  name: string
  sku?: string
  price: number
  sale_price?: number
  inventory_level?: number
  inventory_tracking?: string
  availability?: string
  custom_url?: { url: string }
  description?: string
  brand_id?: number
  gtin?: string
  mpn?: string
  images?: { url_standard?: string; is_thumbnail?: boolean }[]
  categories?: number[]
  total_sold?: number
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetchBigCommerceProducts(
  storeId: string,
  credentials: BigCommerceCredentials,
  options: BigCommerceFetchOptions = {},
): Promise<BigCommerceFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'USD' } = options
  const warnings: string[] = []

  const url = new URL(`https://api.bigcommerce.com/stores/${credentials.storeHash}/v3/catalog/products`)
  url.searchParams.set('limit', String(Math.min(limit, 250)))
  url.searchParams.set('is_visible', 'true')
  url.searchParams.set('sort', 'total_sold')
  url.searchParams.set('direction', 'desc')
  url.searchParams.set('include', 'images')

  const response = await fetchImpl(url.toString(), {
    headers: {
      'X-Auth-Token': credentials.accessToken,
      accept: 'application/json',
      'user-agent': 'ShowingUpAudit/0.1',
    },
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('BigCommerce Catalog API rejected the token. It needs the Products scope at read-only.')
  }
  if (!response.ok) {
    throw new Error(`BigCommerce Catalog API returned HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as { data?: BigCommerceProduct[] }
  const rows = payload.data ?? []
  if (rows.some((row) => typeof row.total_sold === 'number')) {
    // Worth stating positively: this one is a real rank, not a stand-in.
    warnings.push('bestseller order came from BigCommerce total_sold, which is an actual sales ranking rather than a proxy')
  }

  const products: Product[] = []

  for (const item of rows) {
    const path = item.custom_url?.url
    if (!path) {
      warnings.push(`product ${item.id} skipped, it has no custom_url so no public URL can be formed`)
      continue
    }

    const attributes: Record<string, string> = {}
    if (item.description) attributes.description = stripHtml(item.description)
    if (item.mpn) attributes.mpn = item.mpn

    // BigCommerce reports availability separately from stock level, and a
    // store with tracking off always reads zero. Trusting the level alone
    // would mark a whole catalogue out of stock.
    const tracked = item.inventory_tracking && item.inventory_tracking !== 'none'
    const soldOut = tracked && (item.inventory_level ?? 0) <= 0
    const availability = item.availability === 'preorder' ? 'preorder' : soldOut ? 'out_of_stock' : 'in_stock'

    const candidate = {
      sku: item.sku?.trim() || `bc-${item.id}`,
      title: item.name,
      price: item.sale_price && item.sale_price > 0 ? item.sale_price : item.price,
      currency: defaultCurrency,
      availability,
      url: new URL(path, credentials.storefrontUrl).toString(),
      image: item.images?.find((image) => image.url_standard)?.url_standard,
      gtin: item.gtin?.trim() || undefined,
      mpn: item.mpn?.trim() || undefined,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`product ${item.id} skipped, ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  return { products: products.slice(0, limit), warnings }
}
