import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * PrestaShop Webservice connector, read-only.
 *
 * PrestaShop's webservice is HTTP Basic with the API key as the username and
 * an empty password, which is unusual enough to be worth stating: a merchant
 * who pastes the key into a password field will get a 401 and blame us.
 *
 * The API returns one resource per request by default, so a naive read costs
 * one round trip per product. `display=full` collapses that into a single
 * response, which is the only reason a 20 SKU audit is not 21 requests.
 */

export interface PrestaShopCredentials {
  baseUrl: string
  /** Webservice key from Advanced Parameters, Webservice, with Products read. */
  apiKey: string
}

export interface PrestaShopFetchOptions {
  limit?: number
  fetchImpl?: typeof fetch
  defaultCurrency?: string
  /** Language id for the multilingual name and description fields. */
  languageId?: number
}

export interface PrestaShopFetchResult {
  products: Product[]
  warnings: string[]
}

/** PrestaShop returns multilingual fields as either a string or a language array. */
type Multilingual = string | { id: number; value: string }[] | { language: { id: number; value: string }[] }

interface PrestaShopProduct {
  id: number
  reference?: string
  name?: Multilingual
  description_short?: Multilingual
  link_rewrite?: Multilingual
  price?: string
  active?: string
  quantity?: string
  manufacturer_name?: string
  ean13?: string
  id_default_image?: number | string
}

/** Flattens PrestaShop's several multilingual shapes to one string. */
function text(field: Multilingual | undefined, languageId: number): string {
  if (!field) return ''
  if (typeof field === 'string') return field.trim()
  const entries = Array.isArray(field) ? field : field.language
  if (!Array.isArray(entries)) return ''
  const match = entries.find((entry) => Number(entry.id) === languageId) ?? entries[0]
  return (match?.value ?? '').trim()
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function fetchPrestaShopProducts(
  storeId: string,
  credentials: PrestaShopCredentials,
  options: PrestaShopFetchOptions = {},
): Promise<PrestaShopFetchResult> {
  const { limit = 20, fetchImpl = fetch, defaultCurrency = 'EUR', languageId = 1 } = options
  const warnings: string[] = [
    'PrestaShop exposes no sales rank over the webservice, so catalogue order is used and is not a bestseller ranking',
  ]

  const url = new URL('/api/products', credentials.baseUrl)
  url.searchParams.set('output_format', 'JSON')
  url.searchParams.set('display', 'full')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('filter[active]', '1')

  // The key is the Basic username with an empty password. Not a typo.
  const auth = Buffer.from(`${credentials.apiKey}:`).toString('base64')
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: `Basic ${auth}`, accept: 'application/json', 'user-agent': 'ShowingUpAudit/0.1' },
  })

  if (response.status === 401) {
    throw new Error('PrestaShop webservice returned 401. The API key is the Basic username with an empty password, and it needs Products set to read.')
  }
  if (!response.ok) {
    throw new Error(`PrestaShop webservice returned HTTP ${response.status}.`)
  }

  const payload = (await response.json()) as { products?: PrestaShopProduct[] }
  const products: Product[] = []

  for (const item of payload.products ?? []) {
    const name = text(item.name, languageId)
    const slug = text(item.link_rewrite, languageId)
    if (!slug) {
      warnings.push(`product ${item.id} skipped, it has no link_rewrite so no public URL can be formed`)
      continue
    }

    const attributes: Record<string, string> = {}
    const description = stripHtml(text(item.description_short, languageId))
    if (description) attributes.description = description

    const quantity = Number.parseInt(item.quantity ?? '', 10)
    const candidate = {
      sku: item.reference?.trim() || `ps-${item.id}`,
      title: name,
      price: Number.parseFloat(item.price ?? '0'),
      currency: defaultCurrency,
      availability: Number.isFinite(quantity) && quantity <= 0 ? 'out_of_stock' : 'in_stock',
      url: new URL(`/${item.id}-${slug}.html`, credentials.baseUrl).toString(),
      brand: item.manufacturer_name?.trim() || undefined,
      gtin: item.ean13?.trim() || undefined,
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
