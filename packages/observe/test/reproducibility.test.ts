import { describe, expect, it } from 'vitest'
import type { Card, EngineId, Observation } from '@showing-up/shared'
import { REPRODUCIBILITY_THRESHOLD } from '@showing-up/shared'
import { representativeObservation, scoreReproducibility } from '@showing-up/observe'

/**
 * These tests guard the number Phase 0 exists to produce. If the threshold
 * logic drifts, the harness starts claiming a surface is observable when it is
 * not, and every accuracy claim built on it becomes indefensible.
 */

let counter = 0
function observation(engine: EngineId, queryId: string, repeat: number, titles: string[], error?: string): Observation {
  counter += 1
  const cards: Card[] = titles.map((title, index) => ({ position: index + 1, title }))
  const base: Observation = {
    id: `obs_${counter}`,
    storeId: 's1',
    queryId,
    engine,
    method: 'api',
    observedAt: new Date().toISOString(),
    rawRef: { path: 'raw/x.json', sha256: 'abc', bytes: 10 },
    cards,
    repeat,
  }
  return error ? { ...base, error } : base
}

describe('scoreReproducibility', () => {
  it('scores a stable surface as observable', () => {
    const observations = [0, 1, 2].map((r) => observation('openai', 'q1', r, ['Widget', 'Gadget']))
    const result = scoreReproducibility({ engine: 'openai', method: 'api', observations, repeats: 3 })
    expect(result.rate).toBe(1)
    expect(result.observable).toBe(true)
    expect(result.queriesMeasured).toBe(1)
  })

  it('scores a surface that names different products each time as not observable', () => {
    const observations = [
      observation('copilot', 'q1', 0, ['Widget']),
      observation('copilot', 'q1', 1, ['Gadget']),
      observation('copilot', 'q1', 2, ['Doohickey']),
    ]
    const result = scoreReproducibility({ engine: 'copilot', method: 'consented-panel', observations, repeats: 3 })
    expect(result.rate).toBe(0)
    expect(result.observable).toBe(false)
    expect(result.note).toContain('threshold')
  })

  it('treats reordering the same products as reproducible, because it is', () => {
    const observations = [
      observation('gemini', 'q1', 0, ['Widget', 'Gadget']),
      observation('gemini', 'q1', 1, ['Gadget', 'Widget']),
    ]
    expect(scoreReproducibility({ engine: 'gemini', method: 'api', observations, repeats: 2 }).rate).toBe(1)
  })

  it('treats two empty renderings as agreeing, so a consistently absent store is measurable', () => {
    const observations = [observation('gemini', 'q1', 0, []), observation('gemini', 'q1', 1, [])]
    const result = scoreReproducibility({ engine: 'gemini', method: 'api', observations, repeats: 2 })
    expect(result.rate).toBe(1)
    expect(result.observable).toBe(true)
  })

  it('sits just the wrong side of the threshold for a half stable surface', () => {
    const observations = [
      observation('openai', 'q1', 0, ['A', 'B']),
      observation('openai', 'q1', 1, ['A', 'C']),
    ]
    const result = scoreReproducibility({ engine: 'openai', method: 'api', observations, repeats: 2 })
    expect(result.rate).toBeCloseTo(1 / 3)
    expect(result.rate).toBeLessThan(REPRODUCIBILITY_THRESHOLD)
    expect(result.observable).toBe(false)
  })

  it('averages across queries rather than across observations', () => {
    const observations = [
      observation('openai', 'stable', 0, ['A']),
      observation('openai', 'stable', 1, ['A']),
      observation('openai', 'unstable', 0, ['B']),
      observation('openai', 'unstable', 1, ['C']),
    ]
    const result = scoreReproducibility({ engine: 'openai', method: 'api', observations, repeats: 2 })
    expect(result.rate).toBe(0.5)
    expect(result.queriesMeasured).toBe(2)
  })

  it('cannot be measured with a single repeat, and says so instead of claiming 100%', () => {
    const observations = [observation('openai', 'q1', 0, ['A'])]
    const result = scoreReproducibility({ engine: 'openai', method: 'api', observations, repeats: 1 })
    expect(result.observable).toBe(false)
    expect(result.rate).toBe(0)
    expect(result.note).toContain('at least two repeats')
  })

  it('counts errored attempts and excludes them from the agreement maths', () => {
    const observations = [
      observation('perplexity', 'q1', 0, ['A']),
      observation('perplexity', 'q1', 1, ['A']),
      observation('perplexity', 'q1', 2, [], 'HTTP 429'),
    ]
    const result = scoreReproducibility({ engine: 'perplexity', method: 'api', observations, repeats: 3 })
    expect(result.errors).toBe(1)
    expect(result.rate).toBe(1)
  })

  it('reports not measured when every attempt failed', () => {
    const observations = [
      observation('perplexity', 'q1', 0, [], 'HTTP 500'),
      observation('perplexity', 'q1', 1, [], 'HTTP 500'),
    ]
    const result = scoreReproducibility({ engine: 'perplexity', method: 'api', observations, repeats: 2 })
    expect(result.observable).toBe(false)
    expect(result.note).toContain('no query returned two usable observations')
  })
})

describe('representativeObservation', () => {
  it('picks the modal rendering rather than an outlier', () => {
    const group = [
      observation('openai', 'q1', 0, ['A', 'B']),
      observation('openai', 'q1', 1, ['A', 'B']),
      observation('openai', 'q1', 2, ['Z']),
    ]
    expect(representativeObservation(group)?.repeat).not.toBe(2)
  })

  it('prefers a usable observation over an errored one', () => {
    const group = [observation('openai', 'q1', 0, [], 'HTTP 429'), observation('openai', 'q1', 1, ['A'])]
    expect(representativeObservation(group)?.error).toBeUndefined()
  })

  it('returns the errored observation when every attempt failed, so the run records it', () => {
    const group = [observation('openai', 'q1', 0, [], 'HTTP 429')]
    expect(representativeObservation(group)?.error).toBe('HTTP 429')
  })
})
