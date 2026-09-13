import { gzipSync } from 'node:zlib'
import type { Availability, Product } from '@showing-up/shared'
import { enforceDashRule, truncate } from '@showing-up/shared'
import type { Policy } from './policy-schema.js'

/**
 * The ACP product feed. SPEC 3.1, job 1.
 *
 * Required fields per the specification: id, title, description, link,
 * image_link, price, availability, enable_search and enable_checkout.
 * Published as gzipped JSON Lines or CSV, refreshable up to every 15 minutes.
 *
 * Two decisions here follow from the product rather than the protocol:
 *
 * 1. enable_checkout is always false. SPEC 1: Showing Up is not a checkout, and
 *    in-chat checkout stalled in March 2026. Agents discover and redirect, and
 *    the merchant's own checkout converts. Publishing true would advertise a
 *    capability neither Showing Up nor the merchant has wired up.
 * 2. A discontinued product is excluded from the feed rather than mapped onto
 *    one of the three availability values the specification allows. The
 *    nearest value, out_of_stock, tells an agent the product is coming back.
 *    SPEC 3.1 counts a discontinued item being recommended as a critical
 *    finding, so publishing one as merely out of stock would have Showing Up
 *    creating the exact defect it sells the detection of.
 */

export const ACP_AVAILABILITY = ['in_stock', 'out_of_stock', 'preorder'] as const
export type AcpAvailability = (typeof ACP_AVAILABILITY)[number]

export const FIELD_LIMITS = { id: 100, title: 150, description: 5000 } as const

export interface AcpItem {
  id: string
  title: string
  description: string
  link: string
  image_link: string
  /** "29.99 GBP": amount, a space, then the ISO currency code. */
  price: string
  availability: AcpAvailability
  enable_search: boolean
  enable_checkout: boolean
  brand?: string
  gtin?: string
  product_category?: string
  product_review_count?: number
  product_review_rating?: number
  seller_privacy_policy?: string
  seller_tos?: string
}

export interface FeedExclusion {
  sku: string
  reason: string
  /** True when the merchant can fix it by editing the catalogue. */
  fixable: boolean
}

export interface BuildFeedResult {
  items: AcpItem[]
  /** Products deliberately left out, each with the reason. */
  exclusions: FeedExclusion[]
}

export interface BuildFeedOptions {
  policy?: Policy
  /** Set false to publish a feed that agents may read but not search. */
  enableSearch?: boolean
}

const AVAILABILITY_MAP: Partial<Record<Availability, AcpAvailability>> = {
  in_stock: 'in_stock',
  out_of_stock: 'out_of_stock',
  preorder: 'preorder',
}

export function buildAcpFeed(products: Product[], options: BuildFeedOptions = {}): BuildFeedResult {
  const items: AcpItem[] = []
  const exclusions: FeedExclusion[] = []
  const { policy, enableSearch = true } = options

  for (const product of products) {
    const availability = AVAILABILITY_MAP[product.availability]
    if (!availability) {
      exclusions.push({
        sku: product.sku,
        reason:
          product.availability === 'discontinued'
            ? 'discontinued, and the feed specification has no discontinued value. Publishing it as out of stock would tell agents it is coming back'
            : `availability is ${product.availability}, which the feed specification does not carry`,
        fixable: product.availability !== 'discontinued',
      })
      continue
    }

    const description = product.attributes.description?.trim()
    if (!description) {
      exclusions.push({
        sku: product.sku,
        reason: 'no description, which the feed specification requires. Add one on the product page and refresh the feed',
        fixable: true,
      })
      continue
    }

    if (!product.image) {
      exclusions.push({
        sku: product.sku,
        reason: 'no image, which the feed specification requires',
        fixable: true,
      })
      continue
    }

    const item: AcpItem = {
      id: truncate(product.sku, FIELD_LIMITS.id),
      title: enforceDashRule(truncate(product.title, FIELD_LIMITS.title)),
      description: enforceDashRule(truncate(description, FIELD_LIMITS.description)),
      link: product.url,
      image_link: product.image,
      price: formatAcpPrice(product.price, product.currency),
      availability,
      enable_search: enableSearch,
      // Never true. See the note at the top of this file.
      enable_checkout: false,
    }

    if (product.brand) item.brand = product.brand
    if (product.gtin) item.gtin = product.gtin

    const category = product.attributes.category ?? product.attributes.google_category
    if (category) item.product_category = category.replace(/\s*[,/]\s*/g, ' > ')

    if (policy?.privacyPolicyUrl) item.seller_privacy_policy = policy.privacyPolicyUrl
    if (policy?.termsUrl) item.seller_tos = policy.termsUrl

    items.push(item)
  }

  return { items, exclusions }
}

/** "29.99 GBP". The specification puts the currency after the amount. */
export function formatAcpPrice(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency.toUpperCase()}`
}

export interface ItemIssue {
  field: string
  message: string
}

/** Validates one item against the required field rules. */
export function validateAcpItem(item: AcpItem): ItemIssue[] {
  const issues: ItemIssue[] = []

  const required: Array<keyof AcpItem> = [
    'id',
    'title',
    'description',
    'link',
    'image_link',
    'price',
    'availability',
  ]
  for (const field of required) {
    const value = item[field]
    if (value === undefined || value === null || value === '') {
      issues.push({ field, message: 'is required' })
    }
  }

  if (typeof item.enable_search !== 'boolean') issues.push({ field: 'enable_search', message: 'must be a boolean' })
  if (typeof item.enable_checkout !== 'boolean') issues.push({ field: 'enable_checkout', message: 'must be a boolean' })
  if (item.enable_checkout) {
    issues.push({ field: 'enable_checkout', message: 'must be false: Showing Up serves discovery, not checkout' })
  }

  if (item.id && item.id.length > FIELD_LIMITS.id) issues.push({ field: 'id', message: `exceeds ${FIELD_LIMITS.id} characters` })
  if (item.title && item.title.length > FIELD_LIMITS.title) {
    issues.push({ field: 'title', message: `exceeds ${FIELD_LIMITS.title} characters` })
  }
  if (item.description && item.description.length > FIELD_LIMITS.description) {
    issues.push({ field: 'description', message: `exceeds ${FIELD_LIMITS.description} characters` })
  }

  if (item.availability && !ACP_AVAILABILITY.includes(item.availability)) {
    issues.push({ field: 'availability', message: `must be one of ${ACP_AVAILABILITY.join(', ')}` })
  }

  if (item.price && !/^\d+\.\d{2} [A-Z]{3}$/.test(item.price)) {
    issues.push({ field: 'price', message: 'must be an amount and an ISO currency code, such as "29.99 GBP"' })
  }

  for (const field of ['link', 'image_link', 'seller_privacy_policy', 'seller_tos'] as const) {
    const value = item[field]
    if (value && !/^https?:\/\//i.test(value)) issues.push({ field, message: 'must be an absolute URL' })
  }

  if (item.product_review_rating !== undefined && (item.product_review_rating < 0 || item.product_review_rating > 5)) {
    issues.push({ field: 'product_review_rating', message: 'must be between 0 and 5' })
  }

  return issues
}

/** JSON Lines: one item per line, which is what the specification publishes. */
export function toJsonl(items: AcpItem[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n')
}

const CSV_COLUMNS: Array<keyof AcpItem> = [
  'id',
  'title',
  'description',
  'link',
  'image_link',
  'price',
  'availability',
  'enable_search',
  'enable_checkout',
  'brand',
  'gtin',
  'product_category',
  'product_review_count',
  'product_review_rating',
  'seller_privacy_policy',
  'seller_tos',
]

export function toCsv(items: AcpItem[]): string {
  const rows = [CSV_COLUMNS.map(String)]
  for (const item of items) {
    rows.push(
      CSV_COLUMNS.map((column) => {
        const value = item[column]
        return value === undefined || value === null ? '' : String(value)
      }),
    )
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

/** The specification publishes the feed gzipped. */
export function gzip(body: string): Buffer {
  return gzipSync(Buffer.from(body, 'utf8'))
}

function csvCell(value: string): string {
  const clean = value.replace(/\r?\n/g, ' ')
  return /[",]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean
}
