import type { Finding, Product } from '@showing-up/shared'
import { ENGINE_LABELS, formatMoney } from '@showing-up/shared'
import { severityRank } from './severity.js'

/**
 * The three headline findings.
 *
 * SPEC 3.2 screen 1 gives the free audit three findings, and SPEC 2.3 says
 * numbers first. So a headline is written as a count and a consequence, not as
 * an adjective, and the three are chosen from different finding types wherever
 * possible: three variations of the same price problem reads as one problem.
 */

export interface Headline {
  /** One sentence, numbers first, no dashes. */
  text: string
  severity: Finding['severity']
  type: Finding['type']
  skus: string[]
  engines: string[]
}

export function buildHeadlines(findings: Finding[], products: Product[], limit = 3): Headline[] {
  if (findings.length === 0) return []

  const bySku = new Map(products.map((product) => [product.sku, product]))
  const groups = new Map<string, Finding[]>()
  for (const finding of findings) {
    const key = finding.type
    const list = groups.get(key) ?? []
    list.push(finding)
    groups.set(key, list)
  }

  const ranked = [...groups.entries()]
    .map(([type, group]) => ({
      type: type as Finding['type'],
      group,
      weight:
        group.reduce((sum, finding) => sum + finding.revenueAtRisk, 0) +
        Math.max(...group.map((finding) => severityRank(finding.severity))) * 10,
    }))
    .sort((a, b) => b.weight - a.weight)

  return ranked.slice(0, limit).map(({ type, group }) => {
    const engines = [...new Set(group.map((f) => ENGINE_LABELS[f.engine] ?? f.engine))].sort()
    const skus = [...new Set(group.map((f) => f.sku).filter(Boolean) as string[])]
    const severity = group
      .map((f) => f.severity)
      .sort((a, b) => severityRank(b) - severityRank(a))[0] as Finding['severity']

    return {
      text: headlineText(type, group, engines, skus, bySku),
      severity,
      type,
      skus,
      engines,
    }
  })
}

/** "a", "a and b", "a, b and c". Reads as a sentence, which is the point. */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function headlineText(
  type: Finding['type'],
  group: Finding[],
  engines: string[],
  skus: string[],
  bySku: Map<string, Product>,
): string {
  const queries = new Set(group.map((f) => f.queryId)).size
  const engineList = joinList(engines)
  const first = group[0]
  const product = skus[0] ? bySku.get(skus[0]) : undefined
  const productName = product?.title ?? 'a catalogue product'

  switch (type) {
    case 'bestseller_absent':
      return `${productName} is absent from ${engineList} for ${queries} of your audited ${plural(queries, 'query', 'queries')}.`
    case 'competitor_substituted':
      return `Other retailers took every product card for ${queries} of your ${plural(
        queries,
        'query',
        'queries',
      )} on ${engineList}.`
    case 'price_mismatch': {
      const observed = Number(first?.observed.price ?? 0)
      const expected = Number(first?.expected.price ?? 0)
      const currency = String(first?.expected.currency ?? 'GBP')
      return `${group.length} ${plural(
        group.length,
        'observation',
        'observations',
      )} on ${engineList} quoted a price your catalogue does not, such as ${formatMoney(
        observed,
        currency,
      )} for ${productName} where your catalogue says ${formatMoney(expected, currency)}.`
    }
    case 'availability_stale':
      return `${engineList} reported the wrong stock status for ${skus.length} of your products.`
    case 'discontinued_recommended':
      return `${engineList} is still recommending ${productName}, which your catalogue marks discontinued.`
    case 'wrong_variant':
      return `${engineList} described the wrong variant of ${productName} in ${group.length} ${plural(
        group.length,
        'observation',
        'observations',
      )}.`
    case 'landing_url_wrong':
      return `${group.length} product cards on ${engineList} link somewhere other than the product page.`
    case 'broken_image':
      return `${engineList} showed an image that is not your catalogue image for ${skus.length} products.`
    case 'unverified_rating':
      return `${engineList} attached a rating you do not publish to ${skus.length} of your products.`
    case 'identity_ambiguous':
      return `${group.length} cards link to your store but could not be matched to a SKU, so their accuracy cannot be checked.`
    default:
      return `${group.length} findings on ${engineList}.`
  }
}
