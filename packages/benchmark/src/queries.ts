import type { Language, Market, Product, Query } from '@showing-up/shared'
import { MARKET_CURRENCY, stableId, titleTokens } from '@showing-up/shared'
import { CATEGORY_LABELS, inferCategory, inferStoreCategory, productType, type CategoryKey } from './categories.js'

/**
 * The Phase 0 query library.
 *
 * Twenty queries per audit, weighted towards the intents where an engine is
 * most likely to render a product card, and spread across six intent classes
 * so a single blind spot in one class cannot make a store look absent
 * everywhere. Editable afterwards: the merchant's own top queries replace
 * these in Phase 2. SPEC 3.1 job 2.
 */

export type QueryIntent =
  | 'product_name'
  | 'category_use'
  | 'price_bounded'
  | 'comparison'
  | 'delivery'
  | 'returns'

/**
 * How the 20 slots are allocated. Sums to 20.
 *
 * Two intents can never be shared between stores, because they name a
 * specific product: product_name and comparison. They are also where the
 * critical findings live, a wrong price on a named SKU above all, so they are
 * trimmed rather than cut. Rebalanced 13 September 2026 from 6 and 3 to 5 and
 * 2: five named-product probes still cover the top SKUs, and the third
 * comparison slot largely repeated "alternatives to {product}", which already
 * overlaps the product_name intent.
 *
 * The two freed slots go to category_use and price_bounded, which are shared
 * and which are the questions a shopper actually types. See Query.shareable.
 */
export const INTENT_MIX: Record<QueryIntent, number> = {
  product_name: 5,
  category_use: 5,
  price_bounded: 4,
  comparison: 2,
  delivery: 2,
  returns: 2,
}

/** Demand proxy per intent: no volume data exists in Phase 0. */
const INTENT_WEIGHT: Record<QueryIntent, number> = {
  product_name: 0.9,
  category_use: 0.8,
  price_bounded: 0.7,
  comparison: 0.6,
  delivery: 0.4,
  returns: 0.3,
}

type Templates = Record<QueryIntent, string[]>

/**
 * Templates per language. Placeholders: {product}, {type}, {category},
 * {brand}, {price}, {currency}, {market}, {other}.
 */
const TEMPLATES: Record<Language, Templates> = {
  en: {
    product_name: ['where can I buy {product}', 'is {product} in stock', '{product} price'],
    category_use: ['best {type} for everyday use', 'good quality {category} for a small home', 'recommend a good {type}'],
    price_bounded: ['best {type} under {currency}{price}', 'cheap {type} that is still good', '{category} under {currency}{price}'],
    comparison: ['{product} vs {other}', 'which is better, {product} or {other}', 'alternatives to {product}'],
    delivery: ['{type} with fast delivery to {market}', '{category} delivered to {market} this week'],
    returns: ['{type} with free returns', '{category} with a long returns window'],
  },
  de: {
    product_name: ['wo kann ich {product} kaufen', 'ist {product} verfügbar', '{product} Preis'],
    category_use: ['bester {type} für den Alltag', 'gute {category} für eine kleine Wohnung', 'empfehle mir einen guten {type}'],
    price_bounded: ['bester {type} unter {price} {currencyWord}', 'günstiger {type} mit guter Qualität', '{category} unter {price} {currencyWord}'],
    comparison: ['{product} oder {other}', 'was ist besser, {product} oder {other}', 'Alternativen zu {product}'],
    delivery: ['{type} mit schneller Lieferung {market}', '{category} diese Woche geliefert {market}'],
    returns: ['{type} mit kostenloser Rückgabe', '{category} mit langer Rückgabefrist'],
  },
}

const MARKET_NAMES: Record<Market, string> = {
  US: 'the US',
  UK: 'the UK',
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
}

/**
 * German market phrases carry their own preposition. "nach Deutschland" and
 * "in die Schweiz" do not share one, and a query with the wrong preposition is
 * not a query a shopper types.
 */
const MARKET_NAMES_DE: Record<Market, string> = {
  US: 'in die USA',
  UK: 'nach Großbritannien',
  DE: 'nach Deutschland',
  AT: 'nach Österreich',
  CH: 'in die Schweiz',
}

/** The word a German speaker uses for the amount, not the ISO code. */
const CURRENCY_WORD_DE: Record<string, string> = {
  EUR: 'Euro',
  CHF: 'Franken',
  USD: 'Dollar',
  GBP: 'Pfund',
}

/** Symbol per currency for the English price-bounded templates. */
const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  CHF: 'CHF ',
}

const CATEGORY_LABELS_DE: Record<CategoryKey, string> = {
  electronics: 'Elektronik',
  fashion: 'Kleidung',
  home: 'Moebel',
  beauty: 'Kosmetik',
  sports: 'Sportartikel',
  diy: 'Werkzeuge',
  food: 'Lebensmittel',
  pets: 'Tierbedarf',
  general: 'Produkte',
}

export interface BuildQueryOptions {
  storeId: string
  market: Market
  language: Language
  /** Total queries to build. Phase 0 default is 20. */
  count?: number
  /** Merchant-supplied queries, used before any generated ones. */
  seedQueries?: string[]
}

/**
 * Share of a query set that one observation could answer for every store in
 * the same category and market, 0 to 1.
 *
 * The number that decides whether the cost of observation falls per store as
 * density inside a category-market rises. A query with no flag counts as not
 * shareable, so this never reads high by accident.
 */
export function shareableQueryFraction(queries: Query[]): number {
  if (queries.length === 0) return 0
  const shared = queries.filter((query) => query.shareable === true).length
  return shared / queries.length
}

/**
 * Builds the query set. Deterministic for a given catalogue so two runs of the
 * same audit are comparable, which is what makes reproducibility measurable.
 */
export function buildQueries(products: Product[], options: BuildQueryOptions): Query[] {
  const { storeId, market, language, count = 20, seedQueries = [] } = options
  const queries: Query[] = []
  const seen = new Set<string>()

  const push = (
    text: string,
    source: Query['source'],
    intent: QueryIntent,
    expectedSkus: string[],
    category?: string,
    shareable = false,
  ) => {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key) || queries.length >= count) return
    seen.add(key)
    const query: Query = {
      id: stableId('qry', storeId, market, key),
      storeId,
      text: trimmed,
      market,
      language,
      source,
      volumeProxy: INTENT_WEIGHT[intent],
      expectedSkus,
    }
    if (category) query.category = category
    query.shareable = shareable
    // Keyed on the text itself, so two stores share an observation exactly
    // when they would ask the same question. See Query.shareKey.
    if (shareable) query.shareKey = stableId('shq', market, language, key)
    queries.push(query)
  }

  // Merchant seeds first: their own words outrank anything generated.
  const allSkus = products.map((p) => p.sku)
  for (const seed of seedQueries) push(seed, 'manual', 'product_name', allSkus)

  if (products.length === 0) return queries

  const storeCategory = inferStoreCategory(products)
  const categoryLabel = language === 'de' ? CATEGORY_LABELS_DE[storeCategory] : CATEGORY_LABELS[storeCategory]
  const templates = TEMPLATES[language]
  const currencyCode = MARKET_CURRENCY[market] ?? 'EUR'
  const currency = CURRENCY_SYMBOL[currencyCode] ?? `${currencyCode} `
  const currencyWord = CURRENCY_WORD_DE[currencyCode] ?? currencyCode

  // Bestseller proxy: the catalogue order the connector returned, which is
  // popularity for WooCommerce and feed order otherwise.
  const ranked = [...products]

  const render = (intent: QueryIntent, templateIndex: number, productIndex: number): void => {
    const available = templates[intent]
    const product = ranked[productIndex % ranked.length]
    const template = available[templateIndex % available.length]
    if (!product || !template) return

    const category = inferCategory(product)
    const type = language === 'de' ? CATEGORY_LABELS_DE[category] : productType(product, category)
    const other = ranked[(productIndex + 1) % ranked.length]

    // Shareable means the text names no specific product, so a rival store
    // selling the same kind of thing generates the identical text and one
    // observation answers for both.
    //
    // Only {product}, {other} and {brand} break that. {type} does not, and an
    // earlier version of this check wrongly assumed it did: productType strips
    // the brand, the model code and the unit words, so "Northfield AM10
    // Bookshelf Speaker Pair Walnut" and a rival's "Elac Debut B6.2 Bookshelf
    // Speakers" both give "bookshelf speaker". That phrase is the sharing
    // unit, and it is also the phrase a shopper actually types. {price}
    // survives because roundPriceBand turns it into a band, and the band is
    // part of the share key so two different bands stay separate.
    const shareable = !(
      template.includes('{product}') ||
      template.includes('{other}') ||
      template.includes('{brand}')
    )

    const text = template
      .replace('{product}', productPhrase(product))
      .replace('{other}', other && other.sku !== product.sku ? productPhrase(other) : categoryLabel)
      .replace('{type}', type)
      .replace('{category}', categoryLabel)
      .replace('{brand}', product.brand ?? '')
      .replace('{price}', String(roundPriceBand(product.price)))
      .replace('{currency}', currency)
      .replace('{currencyWord}', currencyWord)
      .replace('{market}', language === 'de' ? MARKET_NAMES_DE[market] : MARKET_NAMES[market])

    // Product-name and comparison queries expect that specific SKU. The
    // broader intents expect any of the merchant's SKUs to render, so an
    // absent verdict there means the store rendered nothing at all.
    const expected = intent === 'product_name' || intent === 'comparison' ? [product.sku] : allSkus
    push(text, intent === 'product_name' ? 'catalogue' : 'benchmark', intent, expected, category, shareable)
  }

  const budget: Array<[QueryIntent, number]> = Object.entries(INTENT_MIX) as Array<[QueryIntent, number]>
  for (const [intent, slots] of budget) {
    for (let slot = 0; slot < slots; slot += 1) render(intent, slot, slot)
  }

  // The intent mix assumes a catalogue with enough distinct products to fill
  // every slot. A small catalogue produces duplicates, which the push above
  // drops, so the remaining slots are filled by walking every other
  // combination of template and product. A set of twenty distinct queries is
  // what makes two audits comparable, and a padded or duplicated set is worse
  // than a short one, so this stops when the combinations run out rather than
  // inventing anything.
  for (let productIndex = 0; productIndex < ranked.length && queries.length < count; productIndex += 1) {
    for (const [intent] of budget) {
      if (queries.length >= count) break
      for (let templateIndex = 0; templateIndex < templates[intent].length; templateIndex += 1) {
        if (queries.length >= count) break
        render(intent, templateIndex, productIndex)
      }
    }
  }

  return queries
}

/**
 * The product as a shopper would name it. The brand is prefixed only when the
 * title does not already carry it: "Northfield Audio Northfield AM10" is not a
 * query anybody types, and a query nobody types cannot test presence.
 */
function productPhrase(product: Product): string {
  const brand = product.brand?.trim()
  if (!brand) return product.title
  const titleWords = titleTokens(product.title)
  const brandWords = [...titleTokens(brand)]
  const alreadyThere = brandWords.length > 0 && brandWords.some((word) => titleWords.has(word))
  return alreadyThere ? product.title : `${brand} ${product.title}`
}

/** Price bands read naturally in a query: 50, 100, 150, 200, 500. */
function roundPriceBand(price: number): number {
  const band = price * 1.1
  const steps = [20, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000]
  for (const step of steps) if (band <= step) return step
  return Math.ceil(band / 500) * 500
}
