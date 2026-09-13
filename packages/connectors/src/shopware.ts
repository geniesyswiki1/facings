import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Shopware 6 Store API connector, read-only.
 *
 * The Store API rather than the Admin API on purpose: it needs only a
 * sales-channel access key, which is a storefront credential the merchant can
 * issue and revoke without granting anything administrative. An audit should
 * ask for the weakest credential that does the job.
 *
 * Shopware is disproportionately a DACH platform, which is why it is here at
 * all: it detects 20,179 German stores against 1,248 Swiss and 1,167 Austrian,
 * so a DACH launch without it is a launch with a hole in it.
 */

export interface ShopwareCredentials {
  /** Storefront origin, such as https://shop.example.de */
  baseUrl: string
  /** sw-access-key for the sales channel. Not an admin token. */
  accessKey: string
}

export interface ShopwareFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  defaultCurrency?: string
}

export interface ShopwareFetchResult {
  products: Product[]
  warnings: string[]
}

interface ShopwareProduct {
  id: string
  productNumber?: string
  name?: string
  description?: string
  available?: boolean
  availableStock?: number
  ean?: string
  manufacturerNumber?: string
  seoUrls?: { seoPathInfo?: string }[]
  cover?: { media?: { url?: string } }
  manufacturer?: { name?: string }
  calculatedPrice?: { totalPrice?: number }
  calculatedCheapestPrice?: { totalPrice?: number }
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetchShopwareProducts(
  storeId: string,
  credentials: ShopwareCredentials,
  options: ShopwareFetchOptions = {},
): Promise<ShopwareFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'EUR' } = options
  const warnings: string[] = [
    'Shopware Store API exposes no sales rank, so catalogue order is used and is not a bestseller ranking',
  ]

  const endpoint = new URL('/store-api/product', credentials.baseUrl)
  const response = await fetchImpl(endpoint.toString(), {
    method: 'POST',
    headers: {
      'sw-access-key': credentials.accessKey,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'ShowingUpAudit/0.1',
    },
    body: JSON.stringify({
      limit,
      // Prices in the Store API are calculated per sales channel and are
      // gross where the channel is configured that way, which is what a
      // DACH consumer price must be.
      associations: { seoUrls: {}, cover: { associations: { media: {} } }, manufacturer: {} },
    }),
  })

  if (response.status === 401 || response.status === 412) {
    throw new Error('Shopware Store API rejected the access key. It must be the sw-access-key of an active sales channel.')
  }
  if (!response.ok) {
    throw new Error(`Shopware Store API returned HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as { elements?: ShopwareProduct[] }
  const products: Product[] = []

  for (const item of payload.elements ?? []) {
    const seoPath = item.seoUrls?.find((entry) => entry.seoPathInfo)?.seoPathInfo
    // Falls back to the canonical detail route, which always resolves.
    const path = seoPath ? `/${seoPath.replace(/^\//, '')}` : `/detail/${item.id}`

    const attributes: Record<string, string> = {}
    if (item.description) attributes.description = stripHtml(item.description)
    if (item.manufacturerNumber) attributes.mpn = item.manufacturerNumber

    const price = item.calculatedPrice?.totalPrice ?? item.calculatedCheapestPrice?.totalPrice ?? 0
    const candidate = {
      sku: item.productNumber?.trim() || `sw-${item.id}`,
      title: item.name ?? '',
      price,
      currency: defaultCurrency,
      availability: item.available === false || (item.availableStock ?? 1) <= 0 ? 'out_of_stock' : 'in_stock',
      url: new URL(path, credentials.baseUrl).toString(),
      image: item.cover?.media?.url,
      brand: item.manufacturer?.name?.trim() || undefined,
      gtin: item.ean?.trim() || undefined,
      mpn: item.manufacturerNumber?.trim() || undefined,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`product ${item.productNumber ?? item.id} skipped, ${parsed.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  return { products: products.slice(0, limit), warnings }
}
