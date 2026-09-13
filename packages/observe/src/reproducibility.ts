import type { EngineId, EngineReproducibility, Observation, ObservationMethod } from '@showing-up/shared'
import { REPRODUCIBILITY_THRESHOLD, jaccard } from '@showing-up/shared'
import { cardIdentity } from './cards.js'

/**
 * Reproducibility scoring: the number Phase 0 exists to produce.
 *
 * SPEC 4.4 sets the rule. If a surface cannot be observed consistently, it is
 * reported as not observable rather than approximated, and make-or-break
 * analysis M1 fails for that surface. The measure is agreement between repeats
 * of the same query on the set of product identities returned, ignoring price
 * and position: a surface that names the same three products twice is
 * reproducible even if it reorders them, whereas one that names different
 * products each time cannot support a daily accuracy claim.
 */

export interface ReproducibilityInput {
  engine: EngineId
  method: ObservationMethod
  observations: Observation[]
  repeats: number
}

/** Mean pairwise Jaccard agreement across repeats, averaged over queries. */
export function scoreReproducibility(input: ReproducibilityInput): EngineReproducibility {
  const byQuery = new Map<string, Observation[]>()
  for (const observation of input.observations) {
    const list = byQuery.get(observation.queryId) ?? []
    list.push(observation)
    byQuery.set(observation.queryId, list)
  }

  const perQueryRates: number[] = []
  let errors = 0

  for (const group of byQuery.values()) {
    const usable = group.filter((o) => !o.error)
    errors += group.length - usable.length
    if (usable.length < 2) continue

    const sets = usable.map((o) => new Set(o.cards.map(cardIdentity)))
    const pairwise: number[] = []
    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const a = sets[i]
        const b = sets[j]
        if (a && b) pairwise.push(jaccard(a, b))
      }
    }
    if (pairwise.length) perQueryRates.push(mean(pairwise))
  }

  const rate = perQueryRates.length ? mean(perQueryRates) : 0
  const measured = perQueryRates.length

  const result: EngineReproducibility = {
    engine: input.engine,
    method: input.method,
    repeats: input.repeats,
    rate: round(rate),
    observable: measured > 0 && rate >= REPRODUCIBILITY_THRESHOLD,
    queriesMeasured: measured,
    errors,
  }

  if (input.repeats < 2) {
    result.note = 'not measured: reproducibility needs at least two repeats per query'
  } else if (measured === 0) {
    result.note = 'not measured: no query returned two usable observations'
  } else if (!result.observable) {
    result.note = `below the ${REPRODUCIBILITY_THRESHOLD} agreement threshold`
  }

  return result
}

/**
 * Picks the observation a report and the diff should use for a query and
 * engine: the repeat whose card set agrees most with the other repeats, which
 * is the modal rendering rather than an outlier.
 */
export function representativeObservation(observations: Observation[]): Observation | undefined {
  const usable = observations.filter((o) => !o.error)
  if (usable.length === 0) return observations[0]
  if (usable.length === 1) return usable[0]

  const sets = usable.map((o) => new Set(o.cards.map(cardIdentity)))
  let bestIndex = 0
  let bestScore = -1
  for (let i = 0; i < usable.length; i += 1) {
    let total = 0
    for (let j = 0; j < usable.length; j += 1) {
      if (i === j) continue
      const a = sets[i]
      const b = sets[j]
      if (a && b) total += jaccard(a, b)
    }
    if (total > bestScore) {
      bestScore = total
      bestIndex = i
    }
  }
  return usable[bestIndex]
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
