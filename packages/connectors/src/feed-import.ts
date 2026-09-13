import { readFile } from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'
import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Google Merchant Center XML feed ingest.
 *
 * The generic path for every platform without a connector: most merchants
 * above the £2m GMV line already publish one for Shopping, so a free audit can
 * start from a feed URL and nothing else.
 */

interface FeedItem {
  'g:id'?: string | number
  'g:title'?: string
  title?: string
  'g:price'?: string
  'g:sale_price'?: string
  'g:availability'?: string
  'g:link'?: string
  link?: string
  'g:image_link'?: string
  'g:brand'?: string
  'g:gtin'?: string | number
  'g:mpn'?: string
  'g:product_type'?: string
  'g:google_product_category'?: string
  'g:material'?: string
  'g:color'?: string
  'g:size'?: string
  'g:description'?: string
  description?: string
}

export interface FeedImportResult {
  products: Product[]
  warnings: string[]
  /** Feed age in hours, when the feed declares a build date. Feeds cause findings. */
  feedAgeHours?: number
}

export function importFeedXml(storeId: string, xml: string, limit = 20): FeedImportResult {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true })
  const doc = parser.parse(xml) as Record<string, any>
  const channel = doc?.rss?.channel ?? doc?.feed
  const warnings: string[] = []
  if (!channel) return { products: [], warnings: ['no rss channel or atom feed found in the XML'] }

  const rawItems: FeedItem[] = ensureArray(channel.item ?? channel.entry)
  const products: Product[] = []

  for (const [index, item] of rawItems.entries()) {
    const priceText = (item['g:sale_price'] ?? item['g:price'] ?? '').toString()
    const [amount, currency] = splitFeedPrice(priceText)

    const attributes: Record<string, string> = {}
    const map: Array<[keyof FeedItem, string]> = [
      ['g:product_type', 'category'],
      ['g:google_product_category', 'google_category'],
      ['g:material', 'material'],
      ['g:color', 'colour'],
      ['g:size', 'size'],
    ]
    for (const [source, target] of map) {
      const value = item[source]
      if (value) attributes[target] = value.toString()
    }
    const description = item['g:description'] ?? item.description
    if (description) attributes.description = description.toString()

    const candidate = {
      sku: (item['g:id'] ?? '').toString(),
      title: (item['g:title'] ?? item.title ?? '').toString(),
      price: amount,
      currency: currency ?? 'GBP',
      availability: item['g:availability']?.toString(),
      url: (item['g:link'] ?? item.link ?? '').toString(),
      image: item['g:image_link']?.toString(),
      brand: item['g:brand']?.toString(),
      gtin: item['g:gtin']?.toString(),
      mpn: item['g:mpn']?.toString(),
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      warnings.push(`feed item ${index + 1} skipped, ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  const built = channel.lastBuildDate ?? channel.updated
  const feedAgeHours = built ? hoursSince(built.toString()) : undefined

  const result: FeedImportResult = { products: products.slice(0, limit), warnings }
  if (feedAgeHours !== undefined) result.feedAgeHours = feedAgeHours
  return result
}

export async function importFeedFile(storeId: string, path: string, limit?: number): Promise<FeedImportResult> {
  return importFeedXml(storeId, await readFile(path, 'utf8'), limit)
}

export async function importFeedUrl(
  storeId: string,
  url: string,
  limit?: number,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedImportResult> {
  const response = await fetchImpl(url, { headers: { 'user-agent': 'ShowingUpAudit/0.1' } })
  if (!response.ok) throw new Error(`feed URL returned HTTP ${response.status}`)
  return importFeedXml(storeId, await response.text(), limit)
}

/** "1299.00 GBP" and "GBP 1299.00" both appear in the wild. */
function splitFeedPrice(raw: string): [number, string | undefined] {
  const text = raw.trim()
  if (!text) return [Number.NaN, undefined]
  const code = text.match(/\b([A-Z]{3})\b/)?.[1]
  const numeric = text.replace(/[A-Z]{3}/g, '').replace(/[^\d.,]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')
  return [Number.parseFloat(numeric), code]
}

function hoursSince(dateText: string): number | undefined {
  const then = Date.parse(dateText)
  if (Number.isNaN(then)) return undefined
  return Math.max(0, (Date.now() - then) / 3_600_000)
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
