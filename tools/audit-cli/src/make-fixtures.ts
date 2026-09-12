import type { EngineId, Product, Query } from '@facings/shared'
import { sha256 } from '@facings/shared'

/**
 * Synthetic surface generator.
 *
 * Produces a fixture file for the replay adapter from a real catalogue, with
 * defects seeded on purpose. Two jobs: it lets the whole pipeline be exercised
 * without spending API credit, and it is how the Phase 2 check in SPEC 11 is
 * verified, where a seeded misrepresentation has to appear in the exported log
 * within one cycle.
 *
 * Deterministic: which query carries which defect comes from a hash of the
 * query id, so a regression in the diff rules is visible rather than looking
 * like sampling noise.
 */

export type DefectKind = 'price' | 'discontinued' | 'absent' | 'competitor' | 'variant' | 'availability'

export const ALL_DEFECTS: DefectKind[] = ['price', 'discontinued', 'absent', 'competitor', 'variant', 'availability']

export interface MakeFixtureOptions {
  products: Product[]
  queries: Query[]
  engines: EngineId[]
  repeats: number
  defects: DefectKind[]
  /** Surfaces that return a different card set on each repeat, so they fall
   * below the reproducibility floor and must be reported as not observable. */
  unstable?: EngineId[]
  /** Share of queries that carry a defect, 0 to 1. */
  defectRate?: number
}

interface FixtureTake {
  cards: Array<Record<string, string>>
  error?: string
}

export interface FixtureFileShape {
  engines: Record<string, Record<string, FixtureTake[]>>
}

export function makeFixtures(options: MakeFixtureOptions): FixtureFileShape {
  const { products, queries, engines, repeats, defects, unstable = [], defectRate = 0.45 } = options
  const engineBlocks: FixtureFileShape['engines'] = {}

  for (const engine of engines) {
    const perQuery: Record<string, FixtureTake[]> = {}

    for (const query of queries) {
      const takes: FixtureTake[] = []
      const isUnstable = unstable.includes(engine)
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const seed = `${engine}|${query.id}|${isUnstable ? repeat : 'stable'}`
        const take = buildTake({ seed, query, products, defects, defectRate })
        // An unstable surface returns a different product set on each take,
        // which is what the reproducibility floor exists to catch. Rotating the
        // catalogue rather than reordering it is deliberate: reordering the same
        // products is stable by the identity measure, and should be.
        takes.push(isUnstable ? destabilise(take, products, `${seed}|shift`, repeat) : take)
      }
      perQuery[query.text] = takes
    }

    engineBlocks[engine] = perQuery
  }

  return { engines: engineBlocks }
}

function buildTake(params: {
  seed: string
  query: Query
  products: Product[]
  defects: DefectKind[]
  defectRate: number
}): FixtureTake {
  const { seed, query, products, defects, defectRate } = params
  const roll = unitHash(seed)
  const bySku = new Map(products.map((product) => [product.sku, product]))

  const expected = query.expectedSkus
    .map((sku) => bySku.get(sku))
    .filter((product): product is Product => product !== undefined)
    .slice(0, 3)

  if (expected.length === 0) return { cards: [] }

  const defect = roll < defectRate && defects.length > 0 ? defects[Math.floor(unitHash(`${seed}|which`) * defects.length)] : undefined

  if (defect === 'absent') return { cards: [] }
  if (defect === 'competitor') {
    return { cards: [competitorCard(expected[0] as Product, seed)] }
  }

  const cards = expected.map((product, index) => {
    const card = correctCard(product)
    if (index !== 0 || !defect) return card

    switch (defect) {
      case 'price':
        card.price = (product.price * 1.16).toFixed(2)
        break
      case 'discontinued':
        card.availability = 'in stock'
        break
      case 'availability':
        card.availability = product.availability === 'in_stock' ? 'out of stock' : 'in stock'
        break
      case 'variant':
        card.title = `${product.title} (Large, Black)`
        break
      default:
        break
    }
    return card
  })

  return { cards }
}

/**
 * Swaps part of the card set for other catalogue products, so successive takes
 * disagree on which products the surface named.
 */
function destabilise(take: FixtureTake, products: Product[], seed: string, repeat: number): FixtureTake {
  if (products.length === 0) return take
  const offset = Math.floor(unitHash(seed) * products.length)
  const substitute = products[(offset + repeat * 3) % products.length]
  if (!substitute) return take
  if (take.cards.length === 0) return { cards: [correctCard(substitute)] }
  return { cards: [correctCard(substitute), ...take.cards.slice(1)] }
}

function correctCard(product: Product): Record<string, string> {
  return {
    title: product.title,
    brand: product.brand ?? '',
    price: product.price.toFixed(2),
    currency: product.currency,
    availability: product.availability === 'in_stock' ? 'in stock' : product.availability.replace('_', ' '),
    rating: '',
    image: product.image ?? '',
    url: product.url,
    retailer: hostOf(product.url),
    evidence: `${product.title} is available from ${hostOf(product.url)}.`,
  }
}

function competitorCard(reference: Product, seed: string): Record<string, string> {
  const names = ['Halloway', 'Meridian Retail', 'Kestrel Direct', 'Bramble and Co']
  const name = names[Math.floor(unitHash(`${seed}|competitor`) * names.length)] ?? 'Halloway'
  return {
    title: `${name} ${reference.title.split(' ').slice(-2).join(' ')}`,
    brand: name,
    price: (reference.price * 0.92).toFixed(2),
    currency: reference.currency,
    availability: 'in stock',
    rating: '4.4',
    image: '',
    url: `https://${name.toLowerCase().replace(/[^a-z]+/g, '')}.example/product`,
    retailer: name,
    evidence: `${name} sells a comparable item.`,
  }
}

/** Stable 0 to 1 value from a string, so fixtures do not move between runs. */
function unitHash(input: string): number {
  const digest = sha256(input).slice(0, 8)
  return Number.parseInt(digest, 16) / 0xffffffff
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return 'the store'
  }
}
