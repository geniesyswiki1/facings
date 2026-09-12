import type {
  EngineId,
  EngineReproducibility,
  Finding,
  Observation,
  Presence,
  Product,
  Query,
} from '@facings/shared'
import { matchCards } from './match.js'

/**
 * Presence scoring per engine.
 *
 * SPEC 3.1 job 1 defines the states as eligible, ingested and rendering, with
 * the specific blocker when the store is not rendering. Phase 0 can observe
 * rendering directly and infer ingestion from citations; eligibility needs
 * Merchant Center diagnostics, which is Phase 1, so it is never reported here
 * as though it had been checked.
 */

export interface PresenceInput {
  storeId: string
  engine: EngineId
  queries: Query[]
  /** One representative observation per query. */
  observations: Observation[]
  findings: Finding[]
  products: Product[]
  reproducibility: EngineReproducibility | undefined
}

export function scorePresence(input: PresenceInput): Presence {
  const checkedAt = new Date().toISOString()
  const usable = input.observations.filter((o) => !o.error)

  // A surface that is not reproducible cannot carry a presence claim.
  if (!input.reproducibility?.observable) {
    const presence: Presence = {
      storeId: input.storeId,
      engine: input.engine,
      state: 'not_observable',
      cardRate: 0,
      accuracyRate: 0,
      checkedAt,
    }
    presence.blocker = input.reproducibility?.note ?? 'the surface was not observed in this run'
    return presence
  }

  if (usable.length === 0) {
    return {
      storeId: input.storeId,
      engine: input.engine,
      state: 'not_observable',
      blocker: 'every attempt on this surface returned an error',
      cardRate: 0,
      accuracyRate: 0,
      checkedAt,
    }
  }

  let queriesWithOwnCard = 0
  let ownCards = 0
  for (const observation of usable) {
    const cards = matchCards(observation.cards, input.products)
    const own = cards.filter((card) => card.matchedSku !== undefined)
    if (own.length > 0) queriesWithOwnCard += 1
    ownCards += own.length
  }

  const cardRate = round(queriesWithOwnCard / usable.length)
  const findingsOnOwnCards = input.findings.filter(
    (finding) => finding.sku !== null && finding.type !== 'bestseller_absent',
  ).length
  const accuracyRate = ownCards === 0 ? 0 : round(Math.max(0, 1 - findingsOnOwnCards / ownCards))

  let state: Presence['state']
  let blocker: string | undefined
  if (cardRate > 0) {
    state = 'rendering'
  } else if (citesStore(usable, input.products)) {
    state = 'ingested'
    blocker = 'the engine cites the store but renders no product card for these queries'
  } else {
    state = 'absent'
    blocker = 'no product card and no citation of the store in any observed query'
  }

  const presence: Presence = {
    storeId: input.storeId,
    engine: input.engine,
    state,
    cardRate,
    accuracyRate,
    checkedAt,
  }
  if (blocker) presence.blocker = blocker
  return presence
}

/** Ingestion proxy: the engine linked the domain even without a product card. */
function citesStore(observations: Observation[], products: Product[]): boolean {
  const domains = new Set(
    products
      .map((product) => {
        try {
          return new URL(product.url).host.replace(/^www\./, '').toLowerCase()
        } catch {
          return ''
        }
      })
      .filter(Boolean),
  )
  for (const observation of observations) {
    for (const card of observation.cards) {
      if (!card.url) continue
      try {
        const host = new URL(card.url).host.replace(/^www\./, '').toLowerCase()
        if (domains.has(host)) return true
      } catch {
        continue
      }
    }
  }
  return false
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
