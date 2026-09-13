import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Adobe Commerce connector, read-only, over GraphQL.
 *
 * The second platform of the beachhead in SPEC 6.1. Read-only in Phase 1: the
 * write path with preview and rollback is Phase 3.
 *
 * The storefront GraphQL endpoint is public on most stores, so an audit can
 * run without credentials. An integration token is accepted for stores that
 * restrict it, and for catalogues where prices differ by customer group.
 */

export interface AdobeCredentials {
  baseUrl: string
  /** Optional bearer token from an Adobe Commerce integration. */
  accessToken?: string
  /** Store view code, when the merchant runs more than one. */
  storeCode?: string
}

export interface AdobeFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  defaultCurrency?: string
}

export interface AdobeFetchResult {
  products: Product[]
  warnings: string[]
}

interface AdobeProduct {
  sku: string
  name: string
  url_key?: string
  canonical_url?: string
  stock_status?: string
  price_range?: {
    minimum_price?: { final_price?: { value?: number; currency?: string } }
  }
  image?: { url?: string }
  description?: { html?: string }
  short_description?: { html?: string }
  categories?: Array<{ name?: string }>
  manufacturer?: number | string
}

/**
 * A filter that matches the whole catalogue.
 *
 * The products query requires a filter, and Adobe Commerce has no "everything"
 * argument. A price floor of zero is the least surprising way to say it: it
 * matches every saleable product without assuming a category tree.
 */
const ALL_PRODUCTS_FILTER = '{ price: { from: "0" } }'

export async function fetchAdobeProducts(
  storeId: string,
  credentials: AdobeCredentials,
  options: AdobeFetchOptions = {},
): Promise<AdobeFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'EUR' } = options
  const warnings: string[] = []

  const query = `query Showing UpCatalogue($pageSize: Int!) {
  products(filter: ${ALL_PRODUCTS_FILTER}, pageSize: $pageSize, currentPage: 1, sort: { position: ASC }) {
    total_count
    items {
      sku
      name
      url_key
      canonical_url
      stock_status
      price_range { minimum_price { final_price { value currency } } }
      image { url }
      short_description { html }
      description { html }
      categories { name }
    }
  }
}`

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'ShowingUpAudit/0.1',
  }
  if (credentials.accessToken) headers.authorization = `Bearer ${credentials.accessToken}`
  if (credentials.storeCode) headers.store = credentials.storeCode

  const endpoint = new URL('/graphql', credentials.baseUrl).toString()
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: { pageSize: Math.min(limit, 100) } }),
  })

  if (!response.ok) {
    throw new Error(
      `Adobe Commerce GraphQL returned HTTP ${response.status}. Check the storefront endpoint is reachable at ${endpoint}.`,
    )
  }

  const payload = (await response.json()) as {
    data?: { products?: { items?: AdobeProduct[]; total_count?: number } }
    errors?: Array<{ message?: string }>
  }

  if (payload.errors?.length) {
    throw new Error(`Adobe Commerce GraphQL errors: ${payload.errors.map((error) => error.message).join('; ')}`)
  }

  const items = payload.data?.products?.items ?? []
  const products: Product[] = []

  for (const item of items) {
    const price = item.price_range?.minimum_price?.final_price
    const attributes: Record<string, string> = {}
    if (item.categories?.length) {
      attributes.category = item.categories.map((category) => category.name).filter(Boolean).join(', ')
    }
    const description = item.short_description?.html ?? item.description?.html
    if (description) attributes.description = stripHtml(description)

    const candidate = {
      sku: item.sku,
      title: item.name,
      price: price?.value ?? Number.NaN,
      currency: price?.currency ?? defaultCurrency,
      availability: item.stock_status,
      url: productUrl(credentials.baseUrl, item),
      image: item.image?.url,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`product ${item.sku} skipped, ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  // Adobe Commerce has no sales rank in the default storefront schema, so
  // "the top 20 SKUs" cannot be resolved here the way WooCommerce popularity
  // resolves it. Said plainly rather than presented as a bestseller list.
  warnings.push(
    'Adobe Commerce publishes no sales rank on the storefront API, so these are the first products in catalogue position order, not the bestsellers. Supply the SKUs with a CSV to audit a specific set.',
  )

  return { products: products.slice(0, limit), warnings }
}

/** IN_STOCK and OUT_OF_STOCK are the two values the storefront schema uses. */
function productUrl(baseUrl: string, item: AdobeProduct): string {
  if (item.canonical_url && /^https?:\/\//i.test(item.canonical_url)) return item.canonical_url
  const path = item.canonical_url ?? (item.url_key ? `${item.url_key}.html` : '')
  if (!path) return ''
  return new URL(path.replace(/^\//, ''), baseUrl).toString()
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
