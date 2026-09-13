import type { Product } from '@showing-up/shared'
import { normaliseTitle } from '@showing-up/shared'

/**
 * Category inference for the query library.
 *
 * Phase 0 has no taxonomy service, so categories come from the merchant's own
 * feed fields first and keyword fallback second. The label matters because the
 * benchmark library is keyed by market and category, and Phase 2 deduplicates
 * observation across stores that share one.
 */

export type CategoryKey =
  | 'electronics'
  | 'fashion'
  | 'home'
  | 'beauty'
  | 'sports'
  | 'diy'
  | 'food'
  | 'pets'
  | 'general'

const KEYWORDS: Record<Exclude<CategoryKey, 'general'>, string[]> = {
  electronics: ['laptop', 'headphone', 'speaker', 'camera', 'monitor', 'phone', 'tablet', 'ssd', 'router', 'tv', 'console', 'charger', 'keyboard'],
  fashion: ['shirt', 'dress', 'jacket', 'coat', 'trouser', 'jeans', 'shoe', 'boot', 'trainer', 'bag', 'scarf', 'knit', 'sock', 'hoodie'],
  home: ['sofa', 'chair', 'table', 'lamp', 'rug', 'duvet', 'pillow', 'kettle', 'pan', 'mattress', 'curtain', 'vase', 'shelf'],
  beauty: ['serum', 'cream', 'shampoo', 'lipstick', 'fragrance', 'perfume', 'cleanser', 'moisturiser', 'spf', 'mascara'],
  sports: ['bike', 'bicycle', 'running', 'yoga', 'dumbbell', 'tent', 'kayak', 'ski', 'golf', 'racket', 'treadmill'],
  diy: ['drill', 'saw', 'paint', 'tile', 'timber', 'screw', 'ladder', 'sander', 'wrench', 'tool'],
  food: ['coffee', 'tea', 'chocolate', 'olive oil', 'wine', 'gin', 'honey', 'pasta', 'cheese', 'supplement'],
  pets: ['dog', 'cat', 'puppy', 'kitten', 'aquarium', 'harness', 'kennel', 'litter'],
}

/** Human label per category, English. German labels live in the query templates. */
export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  electronics: 'electronics',
  fashion: 'clothing',
  home: 'home and furniture',
  beauty: 'beauty',
  sports: 'sports and outdoor',
  diy: 'tools and DIY',
  food: 'food and drink',
  pets: 'pet supplies',
  general: 'products',
}

/**
 * Infers one category for a single product: the merchant's own category field
 * first, the title only as a fallback. Order matters rather than being a
 * tidiness preference. A speaker sold as running gear is running gear to the
 * shopper, and the merchant's taxonomy is the better witness to that than a
 * keyword in the product name.
 */
export function inferCategory(product: Product): CategoryKey {
  const declared = (product.attributes.category ?? product.attributes.google_category ?? '').toLowerCase()
  return bestMatch(declared) ?? bestMatch(normaliseTitle(product.title)) ?? 'general'
}

/** The category with the most keyword hits, or undefined when there are none. */
function bestMatch(haystack: string): CategoryKey | undefined {
  if (!haystack.trim()) return undefined
  let best: CategoryKey | undefined
  let bestHits = 0
  for (const [category, words] of Object.entries(KEYWORDS) as [Exclude<CategoryKey, 'general'>, string[]][]) {
    const hits = words.filter((word) => haystack.includes(word)).length
    if (hits > bestHits) {
      best = category
      bestHits = hits
    }
  }
  return best
}

/** The store's dominant category, used for the category level queries. */
export function inferStoreCategory(products: Product[]): CategoryKey {
  const tally = new Map<CategoryKey, number>()
  for (const product of products) {
    const category = inferCategory(product)
    tally.set(category, (tally.get(category) ?? 0) + 1)
  }
  let best: CategoryKey = 'general'
  let bestCount = 0
  for (const [category, count] of tally) {
    if (category === 'general') continue
    if (count > bestCount) {
      best = category
      bestCount = count
    }
  }
  return best
}

/**
 * Words that describe a specific unit rather than a product type. A shopper
 * looking for a category types "bookshelf speakers", not "pair walnut", so
 * these are dropped before the type phrase is taken.
 */
const UNIT_WORDS = new Set([
  'pair',
  'pairs',
  'set',
  'pack',
  'twin',
  'single',
  'black',
  'white',
  'walnut',
  'oak',
  'silver',
  'gold',
  'grey',
  'gray',
  'blue',
  'green',
  'red',
  'graphite',
  'natural',
  'small',
  'medium',
  'large',
  'compact',
  'mini',
  'inch',
  'metre',
  'meter',
  'one',
  'two',
  'three',
])

/**
 * Product types a shopper only ever types in the plural. Singularising these
 * produces a phrase nobody searches for: "headphone" and "jean" are not
 * queries, so the collision they would buy is not worth the wrong question.
 */
const PLURAL_ONLY = new Set([
  'headphones',
  'earphones',
  'earbuds',
  'airpods',
  'trousers',
  'jeans',
  'shorts',
  'leggings',
  'tights',
  'pyjamas',
  'glasses',
  'sunglasses',
  'scissors',
  'pliers',
  'binoculars',
  'dumbbells',
  'chopsticks',
])

/**
 * Light singular form, so two merchants' titles land on one product type.
 *
 * This matters for the shared-observation economics rather than for grammar:
 * one store titles it "Bookshelf Speakers" and the next "Bookshelf Speaker",
 * and if the type phrase keeps the plural the two queries never collide and
 * the observation cannot be shared. Deliberately conservative, because a
 * wrong singular is a wrong query: double s stays (glass), and a word has to
 * be long enough that trimming it cannot produce a stub.
 */
export function singularise(word: string): string {
  if (PLURAL_ONLY.has(word)) return word
  if (word.length < 4 || word.endsWith('ss')) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

/**
 * A short noun phrase for the product type, taken from the title with the
 * brand, the model code and the unit words removed, and singularised.
 * "Northfield AM10 Bookshelf Speaker Pair Walnut" gives "bookshelf speaker",
 * which is what a shopper would actually type, and so does a rival store's
 * "Elac Debut B6.2 Bookshelf Speakers".
 */
export function productType(product: Product, category: CategoryKey): string {
  const words = normaliseTitle(product.title).split(' ')
  const brandWords = new Set(normaliseTitle(product.brand ?? '').split(' ').filter(Boolean))
  const kept = words.filter(
    (word) =>
      !brandWords.has(word) &&
      !UNIT_WORDS.has(word) &&
      // Model codes: am10, s8, int200, 400w.
      !/^[a-z]{0,4}\d+[a-z]{0,2}$/.test(word) &&
      word.length > 2,
  )
  const tail = kept.slice(-2)
  if (tail.length === 0) return CATEGORY_LABELS[category]
  // Only the head noun is singularised: "bookshelf speakers" gives
  // "bookshelf speaker", and a qualifier like "womens" is left alone.
  return [...tail.slice(0, -1), singularise(tail[tail.length - 1] as string)].join(' ')
}
