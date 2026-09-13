import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Shopify Admin GraphQL connector, read-only.
 *
 * Shopify merchants were excluded from v1 while the product was Europe first,
 * on the reasoning that Shopify already solves presence for its own stores.
 * That reasoning does not survive the US, where Shopify's share of the two to
 * fifty million bracket is far higher than in the UK or DACH, and where the
 * thing Shopify does not do is the thing we sell: Shopify publishes the
 * catalogue to its partner surfaces, it does not observe what those surfaces
 * then say about it, and it keeps no dated record a merchant could show a
 * regulator.
 *
 * So a Shopify store is sold the accuracy and audit tiers rather than presence
 * hosting, and this connector exists to read the catalogue that Shopify is
 * already publishing, so the daily diff has something to compare against.
 *
 * Auth is an offline access token from a custom app the merchant installs in
 * their own admin, with read_products scope only. No write scope is requested,
 * because nothing here writes.
 */

/** Pinned so a Shopify API version bump is a visible diff, per SPEC 8. */
export const SHOPIFY_API_VERSION = '2026-07'

export interface ShopifyCredentials {
  /** The myshopify domain, such as northfield-audio.myshopify.com. */
  shopDomain: string
  /** Admin API access token, read_products scope. */
  accessToken: string
}

export interface ShopifyFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  /**
   * Fallback when a variant carries no currency. Shopify returns the shop's
   * presentment currency per variant, so this is rarely used.
   */
  defaultCurrency?: string
}

export interface ShopifyFetchResult {
  products: Product[]
  warnings: string[]
}

interface ShopifyVariantNode {
  sku: string | null
  price: string | null
  availableForSale: boolean
  barcode: string | null
  selectedOptions?: { name: string; value: string }[]
}

interface ShopifyProductNode {
  id: string
  title: string
  handle: string
  vendor: string | null
  productType: string | null
  status: string
  totalInventory: number | null
  onlineStoreUrl: string | null
  description: string | null
  featuredImage?: { url: string } | null
  variants: { nodes: ShopifyVariantNode[] }
}

interface ShopifyResponse {
  data?: { products?: { nodes: ShopifyProductNode[] } }
  errors?: { message: string }[]
}

/**
 * Ordered by inventory as a bestseller proxy.
 *
 * The Admin API exposes no sales rank without the separate ShopifyQL analytics
 * scope, which is a heavier permission than an audit justifies asking for. So
 * this is a proxy, and the warning below says so rather than letting a report
 * imply a ranking we did not observe.
 */
const PRODUCTS_QUERY = `
  query AuditProducts($first: Int!) {
    products(first: $first, query: "status:active", sortKey: INVENTORY_TOTAL, reverse: true) {
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        totalInventory
        onlineStoreUrl
        description
        featuredImage { url }
        variants(first: 1) {
          nodes { sku price availableForSale barcode selectedOptions { name value } }
        }
      }
    }
  }
`

export async function fetchShopifyProducts(
  storeId: string,
  credentials: ShopifyCredentials,
  options: ShopifyFetchOptions = {},
): Promise<ShopifyFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'USD' } = options
  const warnings: string[] = [
    'Shopify Admin exposes no sales rank without the analytics scope, so bestseller order is an inventory proxy',
  ]

  const endpoint = `https://${credentials.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': credentials.accessToken,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'ShowingUpAudit/0.1',
    },
    body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { first: Math.min(limit, 250) } }),
  })

  if (!response.ok) {
    throw new Error(`Shopify Admin GraphQL returned HTTP ${response.status}. Check the token has read_products scope.`)
  }

  const payload = (await response.json()) as ShopifyResponse
  if (payload.errors?.length) {
    throw new Error(`Shopify Admin GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`)
  }

  const nodes = payload.data?.products?.nodes ?? []
  const products: Product[] = []

  for (const node of nodes) {
    const variant = node.variants.nodes[0]
    if (!variant) {
      warnings.push(`product ${node.handle} skipped, it has no variant to price`)
      continue
    }

    // A product with no online store URL is not published to the storefront,
    // so no agent can link to it. Excluded with the reason rather than given a
    // guessed URL, per the observation constraints in CLAUDE.md.
    if (!node.onlineStoreUrl) {
      warnings.push(`product ${node.handle} skipped, it is not published to the online store so it has no public URL`)
      continue
    }

    const attributes: Record<string, string> = {}
    if (node.productType) attributes.category = node.productType
    if (node.description) attributes.description = node.description.replace(/\s+/g, ' ').trim()
    for (const option of variant.selectedOptions ?? []) {
      attributes[option.name.toLowerCase().replace(/\s+/g, '_')] = option.value
    }

    const candidate = {
      sku: variant.sku || node.handle,
      title: node.title,
      price: Number.parseFloat(variant.price ?? '0'),
      currency: defaultCurrency,
      availability: variant.availableForSale ? 'in_stock' : 'out_of_stock',
      url: node.onlineStoreUrl,
      image: node.featuredImage?.url,
      brand: node.vendor ?? undefined,
      gtin: variant.barcode ?? undefined,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`product ${node.handle} skipped, ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  return { products: products.slice(0, limit), warnings }
}
