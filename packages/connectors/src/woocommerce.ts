import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * WooCommerce REST connector, read-only in Phase 0.
 *
 * Credentials are read-scope consumer keys the merchant generates in their own
 * admin. Phase 0 never writes; the write path with preview and rollback is
 * Phase 3. SPEC 4.6.
 */

export interface WooCredentials {
  baseUrl: string
  consumerKey: string
  consumerSecret: string
}

export interface WooFetchOptions {
  /** Number of products to ingest. Phase 0 audits 20 SKUs. */
  limit?: number
  /** Popularity uses WooCommerce total_sales, which is the best bestseller proxy available. */
  orderBy?: 'popularity' | 'date' | 'price'
  fetchImpl?: typeof fetch
  defaultCurrency?: string
}

interface WooProduct {
  id: number
  sku: string
  name: string
  price: string
  regular_price: string
  stock_status: string
  permalink: string
  images?: { src: string }[]
  attributes?: { name: string; options: string[] }[]
  short_description?: string
  categories?: { name: string }[]
}

export interface WooFetchResult {
  products: Product[]
  warnings: string[]
}

export async function fetchWooProducts(
  storeId: string,
  credentials: WooCredentials,
  options: WooFetchOptions = {},
): Promise<WooFetchResult> {
  const { limit = 20, orderBy = 'popularity', fetchImpl = fetch, defaultCurrency = 'GBP' } = options
  const warnings: string[] = []

  const url = new URL('/wp-json/wc/v3/products', credentials.baseUrl)
  url.searchParams.set('per_page', String(Math.min(limit, 100)))
  url.searchParams.set('orderby', orderBy)
  url.searchParams.set('status', 'publish')

  const auth = Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString('base64')
  const response = await fetchImpl(url.toString(), {
    headers: {
      authorization: `Basic ${auth}`,
      accept: 'application/json',
      'user-agent': 'ShowingUpAudit/0.1',
    },
  })

  if (!response.ok) {
    throw new Error(`WooCommerce REST returned HTTP ${response.status}. Check the key has read scope.`)
  }

  const payload = (await response.json()) as WooProduct[]
  const products: Product[] = []

  for (const item of payload) {
    const attributes: Record<string, string> = {}
    for (const attribute of item.attributes ?? []) {
      if (attribute.options?.length) attributes[attribute.name.toLowerCase().replace(/\s+/g, '_')] = attribute.options.join(', ')
    }
    if (item.categories?.length) attributes.category = item.categories.map((c) => c.name).join(', ')
    if (item.short_description) attributes.description = stripHtml(item.short_description)

    const candidate = {
      sku: item.sku || `wc-${item.id}`,
      title: item.name,
      price: Number.parseFloat(item.price || item.regular_price || '0'),
      currency: defaultCurrency,
      availability: item.stock_status,
      url: item.permalink,
      image: item.images?.[0]?.src,
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

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
