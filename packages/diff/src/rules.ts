import type {
  Card,
  Finding,
  FindingType,
  Observation,
  Product,
  Query,
  Severity,
} from '@showing-up/shared'
import { normaliseTitle, priceDelta, stableId, titleTokens, jaccard } from '@showing-up/shared'
import { matchCards } from './match.js'
import { baseSeverity, deescalate, escalate, revenueAtRisk } from './severity.js'

/**
 * Deterministic diff rules: catalogue against observation.
 *
 * Every rule here is a comparison of two known values, so every finding it
 * produces can be defended by pointing at the raw response and the catalogue
 * snapshot. Residual mismatches that need judgement are left to the cause
 * inference pass and labelled as inferred. SPEC 4.5.
 */

export interface DiffContext {
  query: Query
  observation: Observation
  products: Product[]
  /** Tolerated relative price difference before a mismatch is raised. */
  priceTolerance?: number
  /** Feed age in hours, when known. Used for cause attribution. */
  feedAgeHours?: number
}

/** A price within this relative distance is treated as agreeing. */
export const DEFAULT_PRICE_TOLERANCE = 0.01

export function diffObservation(context: DiffContext): Finding[] {
  const { query, observation, products, priceTolerance = DEFAULT_PRICE_TOLERANCE } = context
  if (observation.error) return []

  const findings: Finding[] = []
  const cards = matchCards(observation.cards, products)
  const bySku = new Map(products.map((product) => [product.sku, product]))

  const add = (params: {
    type: FindingType
    sku: string | null
    expected: Record<string, unknown>
    observed: Record<string, unknown>
    cause: string
    severity?: Severity
  }) => {
    const product = params.sku ? bySku.get(params.sku) : undefined
    const severity = params.severity ?? baseSeverity(params.type)
    findings.push({
      id: stableId('fnd', observation.id, params.type, params.sku ?? 'none'),
      observationId: observation.id,
      engine: observation.engine,
      queryId: query.id,
      queryText: query.text,
      sku: params.sku,
      type: params.type,
      severity,
      expected: params.expected,
      observed: params.observed,
      cause: params.cause,
      causeInferred: false,
      revenueAtRisk: revenueAtRisk(query, product, severity),
      status: 'open',
    })
  }

  // Rule 1: a SKU the merchant expects for this query rendered nowhere.
  const matchedSkus = new Set(cards.map((card) => card.matchedSku).filter(Boolean) as string[])
  for (const sku of query.expectedSkus) {
    if (matchedSkus.has(sku)) continue
    const product = bySku.get(sku)
    if (!product) continue
    // Only the specific-intent queries assert a named SKU. For broad queries
    // the expectation is that any of the merchant's SKUs renders, so one
    // absence per query is raised rather than one per SKU.
    if (query.expectedSkus.length > 1) continue
    add({
      type: 'bestseller_absent',
      sku,
      expected: { sku, title: product.title, url: product.url },
      observed: { cards: cards.length, ownCards: cards.filter((c) => !c.thirdParty).length },
      cause: absenceCause(product, context),
      severity: query.volumeProxy >= 0.8 ? escalate(baseSeverity('bestseller_absent')) : baseSeverity('bestseller_absent'),
    })
  }

  // The broad-intent case: the engine rendered cards, none of them the
  // merchant's, so a competitor took the shelf face.
  if (query.expectedSkus.length > 1 && cards.length > 0 && matchedSkus.size === 0) {
    const competitors = cards.filter((card) => card.thirdParty !== false).slice(0, 3)
    add({
      type: 'competitor_substituted',
      sku: null,
      expected: { anyOf: query.expectedSkus.length, category: query.category ?? 'any' },
      observed: { competitorCards: competitors.map(describeCard) },
      cause: 'the engine answered the query with other retailers only',
    })
  }

  for (const card of cards) {
    const sku = card.matchedSku
    const product = sku ? bySku.get(sku) : undefined

    // Rule 2: a card matched weakly. Reported so the merchant sees why a
    // finding was not raised, rather than the harness silently discarding it.
    if (!product) {
      if (card.thirdParty === false && card.matchConfidence === undefined) {
        add({
          type: 'identity_ambiguous',
          sku: null,
          expected: { skus: products.length },
          observed: describeCard(card),
          cause: 'the card links to the store but no SKU matched on code, URL or title',
        })
      }
      continue
    }

    // Rule 3: price.
    if (card.price !== undefined) {
      const sameCurrency = !card.currency || card.currency === product.currency
      const delta = priceDelta(product.price, card.price)
      if (sameCurrency && delta > priceTolerance) {
        add({
          type: 'price_mismatch',
          sku: product.sku,
          expected: { price: product.price, currency: product.currency },
          observed: { price: card.price, currency: card.currency ?? product.currency, delta: round(delta) },
          cause: priceCause(delta, context),
          severity: delta > 0.1 ? escalate(baseSeverity('price_mismatch')) : baseSeverity('price_mismatch'),
        })
      } else if (!sameCurrency) {
        add({
          type: 'price_mismatch',
          sku: product.sku,
          expected: { price: product.price, currency: product.currency },
          observed: { price: card.price, currency: card.currency },
          cause: 'the engine quoted the price in another currency for this market',
        })
      }
    }

    // Rule 4: availability.
    if (card.availability && card.availability !== 'unknown' && card.availability !== product.availability) {
      if (product.availability === 'discontinued') {
        add({
          type: 'discontinued_recommended',
          sku: product.sku,
          expected: { availability: 'discontinued' },
          observed: { availability: card.availability, evidence: card.evidence },
          cause: 'a discontinued product is still being recommended, so the engine holds a stale copy of the catalogue',
        })
      } else {
        add({
          type: 'availability_stale',
          sku: product.sku,
          expected: { availability: product.availability },
          observed: { availability: card.availability },
          cause: availabilityCause(context),
        })
      }
    }

    // Rule 5: variant. The engine named this SKU but described a different one.
    const variantDrift = variantMismatch(card, product)
    if (variantDrift) {
      add({
        type: 'wrong_variant',
        sku: product.sku,
        expected: { title: product.title, attributes: variantAttributes(product) },
        observed: { title: card.title, detail: variantDrift },
        cause: 'the engine merged this product with a neighbouring variant',
      })
    }

    // Rule 6: landing URL. A card pointing at a category page or another
    // retailer loses the click the merchant was credited with.
    if (card.url && !sameProductPage(card.url, product.url)) {
      const ownDomain = sameHost(card.url, product.url)
      add({
        type: 'landing_url_wrong',
        sku: product.sku,
        expected: { url: product.url },
        observed: { url: card.url, sameDomain: ownDomain },
        cause: ownDomain
          ? 'the link points at another page on the store rather than the product page'
          : 'the link points at another retailer selling this product',
        severity: ownDomain ? deescalate(baseSeverity('landing_url_wrong')) : escalate(baseSeverity('landing_url_wrong')),
      })
    }

    // Rule 7: image. Only raised when the engine showed an image the
    // catalogue does not have, which is what "broken image" means to a
    // merchant looking at a card.
    if (card.image && product.image && !sameImage(card.image, product.image)) {
      add({
        type: 'broken_image',
        sku: product.sku,
        expected: { image: product.image },
        observed: { image: card.image },
        cause: 'the engine is showing an image that is not the catalogue image',
      })
    }

    // Rule 8: a rating the merchant does not publish.
    if (card.rating !== undefined && !product.attributes.rating) {
      add({
        type: 'unverified_rating',
        sku: product.sku,
        expected: { rating: 'not published by the store' },
        observed: { rating: card.rating },
        cause: 'the rating comes from a third party, so the store cannot correct it directly',
      })
    }
  }

  return findings
}

/** Runs the diff across every representative observation of a run. */
export function diffRun(contexts: DiffContext[]): Finding[] {
  return contexts.flatMap((context) => diffObservation(context))
}

function describeCard(card: Card): Record<string, unknown> {
  const described: Record<string, unknown> = { position: card.position, title: card.title }
  if (card.brand) described.brand = card.brand
  if (card.price !== undefined) described.price = card.price
  if (card.url) described.url = card.url
  if (card.evidence) described.evidence = card.evidence
  return described
}

/**
 * Variant drift: the card's title carries a variant word the catalogue title
 * does not, or vice versa. Conservative by design, because "Walnut" missing
 * from a title is not proof the engine described the wrong one.
 */
const VARIANT_WORDS =
  /\b(\d+\s?(gb|tb|ml|l|cm|mm|inch|in|kg|g|w)|small|medium|large|xl|xxl|black|white|walnut|oak|silver|gold|blue|green|red|grey|gray|pro|max|mini|plus|lite)\b/gi

function variantMismatch(card: Card, product: Product): string | undefined {
  const cardWords = new Set((card.title.toLowerCase().match(VARIANT_WORDS) ?? []).map((w) => w.replace(/\s+/g, '')))
  const productWords = new Set(
    (product.title.toLowerCase().match(VARIANT_WORDS) ?? []).map((w) => w.replace(/\s+/g, '')),
  )
  if (cardWords.size === 0 || productWords.size === 0) return undefined

  const conflicting = [...cardWords].filter((word) => !productWords.has(word))
  if (conflicting.length === 0) return undefined

  // If the titles are otherwise near identical the variant words are the
  // whole difference, which is exactly the case worth reporting.
  const similarity = jaccard(titleTokens(card.title), titleTokens(product.title))
  if (similarity < 0.4) return undefined
  return `the card says ${conflicting.join(', ')}, the catalogue says ${[...productWords].join(', ')}`
}

function variantAttributes(product: Product): Record<string, string> {
  const keys = ['colour', 'color', 'size', 'material', 'capacity']
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = product.attributes[key]
    if (value) out[key] = value
  }
  return out
}

function absenceCause(product: Product, context: DiffContext): string {
  const attributeCount = Object.keys(product.attributes).length
  if (!product.gtin && !product.mpn) {
    return 'the product publishes no GTIN or MPN, so engines cannot resolve its identity'
  }
  if (attributeCount < 3) {
    return 'the product has a thin attribute set, so it matches few shopper questions'
  }
  if (context.feedAgeHours !== undefined && context.feedAgeHours > 48) {
    return `the product feed is ${Math.round(context.feedAgeHours)} hours old`
  }
  if (product.availability === 'out_of_stock') {
    return 'the product is out of stock, which suppresses it on most surfaces'
  }
  return 'the product is not present in the data these engines read for this query'
}

function priceCause(delta: number, context: DiffContext): string {
  if (context.feedAgeHours !== undefined && context.feedAgeHours > 24) {
    return `the feed is ${Math.round(context.feedAgeHours)} hours old, so the engine holds the previous price`
  }
  if (delta > 0.5) return 'the quoted price is far from the catalogue price, so it is likely another product or another market'
  return 'the price on the page and the price in the feed disagree, or the engine cached an older value'
}

function availabilityCause(context: DiffContext): string {
  if (context.feedAgeHours !== undefined && context.feedAgeHours > 24) {
    return `the feed is ${Math.round(context.feedAgeHours)} hours old, so stock status is behind`
  }
  return 'the stock status the engine holds is behind the catalogue'
}

function sameProductPage(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    const leftPath = left.pathname.replace(/\/$/, '').toLowerCase()
    const rightPath = right.pathname.replace(/\/$/, '').toLowerCase()
    if (left.host.replace(/^www\./, '') !== right.host.replace(/^www\./, '')) return false
    return leftPath === rightPath
  } catch {
    return false
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.replace(/^www\./, '') === new URL(b).host.replace(/^www\./, '')
  } catch {
    return false
  }
}

/** Image comparison by filename stem, since CDNs resize and re-host. */
function sameImage(a: string, b: string): boolean {
  const stem = (url: string): string => {
    try {
      const path = new URL(url).pathname
      const file = path.split('/').pop() ?? ''
      return normaliseTitle(file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]\d+x\d+$/, ''))
    } catch {
      return ''
    }
  }
  const left = stem(a)
  const right = stem(b)
  if (!left || !right) return true
  return left === right || left.includes(right) || right.includes(left)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
