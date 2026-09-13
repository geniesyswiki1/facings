import type { Card, Product } from '@showing-up/shared'
import { jaccard, normaliseTitle, titleTokens } from '@showing-up/shared'

/**
 * Identity matching: which of the merchant's SKUs, if any, is this card.
 *
 * Ordered by strength, GTIN and MPN first, normalised title last. SPEC 4.5
 * calls for deterministic matching before any model involvement, and the
 * confidence floor matters commercially: a wrong match produces a finding
 * about a product the engine never mentioned, and one of those in a merchant's
 * first report ends the conversation.
 */

export interface MatchResult {
  sku: string
  confidence: number
  basis: 'gtin' | 'mpn' | 'url' | 'title' | 'title-brand'
}

/** Below this, a card is treated as unmatched rather than matched weakly. */
export const MATCH_FLOOR = 0.62

export function matchCard(card: Card, products: Product[]): MatchResult | undefined {
  const haystack = `${card.title} ${card.evidence ?? ''}`.toLowerCase()

  // A GTIN or MPN quoted anywhere in the card text is conclusive.
  for (const product of products) {
    if (product.gtin && product.gtin.length >= 8 && haystack.includes(product.gtin.toLowerCase())) {
      return { sku: product.sku, confidence: 1, basis: 'gtin' }
    }
  }
  for (const product of products) {
    if (product.mpn && product.mpn.length >= 4 && haystack.includes(product.mpn.toLowerCase())) {
      return { sku: product.sku, confidence: 0.95, basis: 'mpn' }
    }
  }

  // An exact product-page URL is as strong as a code.
  if (card.url) {
    const cardPath = safePath(card.url)
    for (const product of products) {
      const productPath = safePath(product.url)
      if (cardPath && productPath && cardPath === productPath) {
        return { sku: product.sku, confidence: 0.95, basis: 'url' }
      }
    }
  }

  // Title similarity, with a brand agreement bonus.
  let best: MatchResult | undefined
  const cardTokens = titleTokens(card.title)
  for (const product of products) {
    const productTokens = titleTokens(product.title)
    let score = jaccard(cardTokens, productTokens)

    // Containment catches "Aurora 400 Speaker" against "Aurora 400 Bluetooth
    // Speaker, Walnut", where Jaccard is punished by the extra words.
    const containment = containmentScore(cardTokens, productTokens)
    score = Math.max(score, containment * 0.9)

    const brandAgrees =
      card.brand && product.brand && normaliseTitle(card.brand) === normaliseTitle(product.brand)
    if (brandAgrees) score = Math.min(1, score + 0.1)

    if (!best || score > best.confidence) {
      best = {
        sku: product.sku,
        confidence: Math.round(score * 100) / 100,
        basis: brandAgrees ? 'title-brand' : 'title',
      }
    }
  }

  if (!best || best.confidence < MATCH_FLOOR) return undefined
  return best
}

/** Annotates a card list in place with matched SKUs. */
export function matchCards(cards: Card[], products: Product[]): Card[] {
  return cards.map((card) => {
    const match = matchCard(card, products)
    if (!match) return card
    return { ...card, matchedSku: match.sku, matchConfidence: match.confidence }
  })
}

/** Share of the smaller token set that appears in the larger one. */
function containmentScore<T>(a: Set<T>, b: Set<T>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  if (small.size === 0) return 0
  let hits = 0
  for (const item of small) if (large.has(item)) hits += 1
  return hits / small.size
}

function safePath(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return undefined
  }
}
