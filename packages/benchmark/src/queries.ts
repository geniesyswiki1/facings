import type { Language, Market, Product, Query } from '@facings/shared'
import { MARKET_CURRENCY, stableId, titleTokens } from '@facings/shared'
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

/** How the 20 slots are allocated. Sums to 20. */
export const INTENT_MIX: Record<QueryIntent, number> = {
  product_name: 6,
  category_use: 4,
  price_bounded: 3,
  comparison: 3,
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
    product_name: ['wo kann ich {product} kaufen', 'ist {product} verfuegbar', '{product} preis'],
    category_use: ['bester {type} fuer den Alltag', 'gute {category} fuer eine kleine Wohnung', 'empfehle mir einen guten {type}'],
    price_bounded: ['bester {type} unter {price} Euro', 'guenstiger {type} mit guter Qualitaet', '{category} unter {price} Euro'],
    comparison: ['{product} oder {other}', 'was ist besser, {product} oder {other}', 'Alternativen zu {product}'],
    delivery: ['{type} mit schneller Lieferung nach Deutschland', '{category} diese Woche geliefert'],
    returns: ['{type} mit kostenloser Rueckgabe', '{category} mit langer Rueckgabefrist'],
  },
  fr: {
    product_name: ['ou acheter {product}', '{product} en stock', 'prix {product}'],
    category_use: ['meilleur {type} pour un usage quotidien', 'bonne {category} pour un petit appartement', 'recommande un {type}'],
    price_bounded: ['meilleur {type} a moins de {price} euros', '{type} pas cher et de bonne qualite', '{category} a moins de {price} euros'],
    comparison: ['{product} ou {other}', 'lequel est meilleur, {product} ou {other}', 'alternatives a {product}'],
    delivery: ['{type} avec livraison rapide', '{category} livre cette semaine'],
    returns: ['{type} avec retour gratuit', '{category} avec long delai de retour'],
  },
  nl: {
    product_name: ['waar kan ik {product} kopen', 'is {product} op voorraad', '{product} prijs'],
    category_use: ['beste {type} voor dagelijks gebruik', 'goede {category} voor een klein huis', 'adviseer een {type}'],
    price_bounded: ['beste {type} onder {price} euro', 'goedkope {type} met goede kwaliteit', '{category} onder {price} euro'],
    comparison: ['{product} of {other}', 'wat is beter, {product} of {other}', 'alternatieven voor {product}'],
    delivery: ['{type} met snelle levering', '{category} deze week bezorgd'],
    returns: ['{type} met gratis retour', '{category} met lange retourtermijn'],
  },
  es: {
    product_name: ['donde comprar {product}', '{product} disponible', 'precio {product}'],
    category_use: ['mejor {type} para uso diario', 'buena {category} para una casa pequena', 'recomienda un {type}'],
    price_bounded: ['mejor {type} por menos de {price} euros', '{type} barato y de buena calidad', '{category} por menos de {price} euros'],
    comparison: ['{product} o {other}', 'cual es mejor, {product} o {other}', 'alternativas a {product}'],
    delivery: ['{type} con envio rapido', '{category} entregado esta semana'],
    returns: ['{type} con devolucion gratuita', '{category} con plazo de devolucion largo'],
  },
  it: {
    product_name: ['dove comprare {product}', '{product} disponibile', 'prezzo {product}'],
    category_use: ['miglior {type} per uso quotidiano', 'buona {category} per una casa piccola', 'consiglia un {type}'],
    price_bounded: ['miglior {type} sotto {price} euro', '{type} economico di buona qualita', '{category} sotto {price} euro'],
    comparison: ['{product} o {other}', 'quale e migliore, {product} o {other}', 'alternative a {product}'],
    delivery: ['{type} con consegna rapida', '{category} consegnato questa settimana'],
    returns: ['{type} con reso gratuito', '{category} con lungo periodo di reso'],
  },
}

const MARKET_NAMES: Record<Market, string> = {
  UK: 'the UK',
  DE: 'Germany',
  FR: 'France',
  NL: 'the Netherlands',
  ES: 'Spain',
  IT: 'Italy',
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
 * Builds the query set. Deterministic for a given catalogue so two runs of the
 * same audit are comparable, which is what makes reproducibility measurable.
 */
export function buildQueries(products: Product[], options: BuildQueryOptions): Query[] {
  const { storeId, market, language, count = 20, seedQueries = [] } = options
  const queries: Query[] = []
  const seen = new Set<string>()

  const push = (text: string, source: Query['source'], intent: QueryIntent, expectedSkus: string[], category?: string) => {
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
    queries.push(query)
  }

  // Merchant seeds first: their own words outrank anything generated.
  const allSkus = products.map((p) => p.sku)
  for (const seed of seedQueries) push(seed, 'manual', 'product_name', allSkus)

  if (products.length === 0) return queries

  const storeCategory = inferStoreCategory(products)
  const categoryLabel = language === 'de' ? CATEGORY_LABELS_DE[storeCategory] : CATEGORY_LABELS[storeCategory]
  const templates = TEMPLATES[language]
  const currency = MARKET_CURRENCY[market] === 'GBP' ? '£' : '€'

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

    const text = template
      .replace('{product}', productPhrase(product))
      .replace('{other}', other && other.sku !== product.sku ? productPhrase(other) : categoryLabel)
      .replace('{type}', type)
      .replace('{category}', categoryLabel)
      .replace('{brand}', product.brand ?? '')
      .replace('{price}', String(roundPriceBand(product.price)))
      .replace('{currency}', currency)
      .replace('{market}', MARKET_NAMES[market])

    // Product-name and comparison queries expect that specific SKU. The
    // broader intents expect any of the merchant's SKUs to render, so an
    // absent verdict there means the store rendered nothing at all.
    const expected = intent === 'product_name' || intent === 'comparison' ? [product.sku] : allSkus
    push(text, intent === 'product_name' ? 'catalogue' : 'benchmark', intent, expected, category)
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
