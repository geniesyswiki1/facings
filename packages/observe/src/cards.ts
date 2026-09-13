import { z } from 'zod'
import type { Card } from '@showing-up/shared'
import { enforceDashRule, parseMoney, truncate } from '@showing-up/shared'

/**
 * Normalisation of engine output into cards.
 *
 * Every adapter asks its engine for the same JSON shape, then this module
 * validates and cleans it. Anything the engine did not state stays undefined:
 * the diff treats "no price stated" and "wrong price" as different findings,
 * and inventing a value here would erase that distinction.
 */

const rawCardSchema = z.object({
  title: z.string().min(1),
  brand: z.string().optional().nullable(),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  currency: z.string().optional().nullable(),
  availability: z.string().optional().nullable(),
  rating: z.union([z.string(), z.number()]).optional().nullable(),
  image: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  retailer: z.string().optional().nullable(),
  evidence: z.string().optional().nullable(),
})

export const rawCardListSchema = z.object({
  cards: z.array(rawCardSchema).max(20),
})

export type RawCard = z.infer<typeof rawCardSchema>

const AVAILABILITY_WORDS: Array<[RegExp, Card['availability']]> = [
  [/discontinued|no longer (made|available|sold)/i, 'discontinued'],
  [/out of stock|sold out|unavailable|nicht verf/i, 'out_of_stock'],
  [/pre.?order|backorder|vorbestell/i, 'preorder'],
  [/in stock|available|auf lager|verf/i, 'in_stock'],
]

export function normaliseCardAvailability(raw: string | null | undefined): Card['availability'] {
  if (!raw) return undefined
  for (const [pattern, value] of AVAILABILITY_WORDS) if (pattern.test(raw)) return value
  return 'unknown'
}

/** Turns validated raw cards into normalised cards, in engine order. */
export function normaliseCards(raw: RawCard[], storeDomain: string): Card[] {
  return raw.map((item, index) => {
    const priceText = item.price === null || item.price === undefined ? '' : String(item.price)
    const parsed = priceText ? parseMoney(priceText) : undefined
    const ratingValue = item.rating === null || item.rating === undefined ? undefined : Number.parseFloat(String(item.rating))
    const url = cleanUrl(item.url)

    const card: Card = {
      position: index + 1,
      title: enforceDashRule(item.title.trim()),
    }
    if (item.brand) card.brand = enforceDashRule(item.brand.trim())
    if (parsed?.amount !== undefined && Number.isFinite(parsed.amount)) card.price = parsed.amount
    const currency = item.currency?.trim().toUpperCase() || parsed?.currency
    if (currency) card.currency = currency
    const availability = normaliseCardAvailability(item.availability)
    if (availability) card.availability = availability
    if (ratingValue !== undefined && Number.isFinite(ratingValue)) card.rating = ratingValue
    if (item.image) card.image = cleanUrl(item.image)
    if (url) card.url = url
    if (item.evidence) card.evidence = enforceDashRule(truncate(item.evidence.trim(), 400))

    // A card is third party when the engine attributed it to another retailer
    // or linked somewhere other than the merchant's domain.
    const retailer = item.retailer?.toLowerCase() ?? ''
    const host = safeHost(url)
    const ownDomain = storeDomain.replace(/^www\./, '')
    if (host) card.thirdParty = !host.endsWith(ownDomain)
    else if (retailer) card.thirdParty = !retailer.includes(ownDomain.split('.')[0] ?? ownDomain)

    return card
  })
}

/**
 * Extracts the JSON card block from an engine's text answer. Engines wrap JSON
 * in prose or fences often enough that a strict parse loses real observations.
 */
export function extractCardJson(text: string): unknown {
  const trimmed = text.trim()
  const candidates: string[] = []

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) candidates.push(fence[1])

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1))

  candidates.push(trimmed)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * Identity key for reproducibility scoring: the card's product identity only,
 * ignoring price and position, since those move between runs for reasons that
 * are findings rather than instability.
 */
export function cardIdentity(card: Card): string {
  const brand = card.brand ? card.brand.toLowerCase() : ''
  return `${brand}|${card.title.toLowerCase()}`.replace(/\s+/g, ' ').trim()
}

function cleanUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const text = raw.trim()
  if (!/^https?:\/\//i.test(text)) return undefined
  try {
    const url = new URL(text)
    // Strip engine tracking parameters so a URL comparison is about the page.
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) {
      url.searchParams.delete(param)
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function safeHost(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase()
  } catch {
    return undefined
  }
}
