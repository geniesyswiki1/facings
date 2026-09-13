import type { Product } from '@showing-up/shared'
import { enforceDashRule, escapeHtml } from '@showing-up/shared'
import type { Policy } from './policy-schema.js'

/**
 * Merchant Center feeds. SPEC 3.1, job 1.
 *
 * Google takes a supplementary feed, which adds and overrides attributes on
 * products the merchant's primary feed already carries, matched on id. It
 * never introduces new products, so Showing Up uses it for exactly what it is
 * good for: publishing the attributes and policy links it generates, without
 * touching the merchant's own primary feed.
 *
 * Microsoft Merchant Center takes the same RSS shape, so one builder serves
 * both and the differences stay in the options.
 */

export type MerchantCenterKind = 'google' | 'microsoft'

export interface MerchantFeedOptions {
  kind: MerchantCenterKind
  title: string
  link: string
  description?: string
  policy?: Policy
  /**
   * Attribute keys from the catalogue to publish. Supplementary feeds should
   * carry what Showing Up adds, not a copy of the merchant's primary feed.
   */
  attributeKeys?: string[]
  now?: Date
}

export const DEFAULT_SUPPLEMENTARY_ATTRIBUTES = [
  'material',
  'colour',
  'size',
  'compatibility',
  'use_case',
  'dimensions',
]

export function buildMerchantFeed(products: Product[], options: MerchantFeedOptions): string {
  const {
    kind,
    title,
    link,
    description = `Showing Up supplementary feed for ${title}`,
    policy,
    attributeKeys = DEFAULT_SUPPLEMENTARY_ATTRIBUTES,
    now = new Date(),
  } = options

  const items = products.map((product) => {
    const lines: string[] = []
    lines.push(tag('g:id', product.sku))

    for (const key of attributeKeys) {
      const value = product.attributes[key]
      if (value) lines.push(tag(`g:custom_label_${attributeKeys.indexOf(key)}`, `${key}: ${value}`))
    }

    if (product.gtin) lines.push(tag('g:gtin', product.gtin))
    if (product.mpn) lines.push(tag('g:mpn', product.mpn))
    if (product.brand) lines.push(tag('g:brand', product.brand))

    // Policy links travel with every item so an agent reading a single product
    // can answer a returns question without another fetch.
    if (policy?.returns?.url) lines.push(tag('g:return_policy_link', policy.returns.url))
    if (policy?.returns?.windowDays !== undefined) {
      lines.push(tag('g:return_window_days', String(policy.returns.windowDays)))
    }

    // Microsoft reads shipping on the item; Google takes it at account level,
    // so only the Microsoft feed carries it.
    if (kind === 'microsoft' && policy?.delivery?.length) {
      for (const promise of policy.delivery) {
        lines.push(
          `<g:shipping><g:country>${escapeXml(promise.country)}</g:country><g:price>${promise.cost.toFixed(
            2,
          )} ${escapeXml(promise.currency)}</g:price></g:shipping>`,
        )
      }
    }

    return `    <item>\n${lines.map((line) => `      ${line}`).join('\n')}\n    </item>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    ${tag('title', title)}
    ${tag('link', link)}
    ${tag('description', description)}
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`
}

function tag(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`
}

/** XML escaping. Catalogue text is merchant supplied and never trusted raw. */
function escapeXml(value: string): string {
  return escapeHtml(enforceDashRule(value))
}
