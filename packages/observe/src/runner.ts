import type {
  EngineId,
  EngineReproducibility,
  Observation,
  Query,
  Store,
} from '@showing-up/shared'
import { stableId } from '@showing-up/shared'
import type { EngineAdapter } from './adapter.js'
import { EvidenceStore } from './evidence.js'
import { scoreReproducibility } from './reproducibility.js'

/**
 * The observation runner.
 *
 * Walks queries by engines by repeats, stores raw evidence for every attempt
 * including failed ones, and never lets one engine's outage lose another
 * engine's run. Concurrency is per engine so a provider's rate limit is the
 * only thing that throttles that provider.
 */

export interface RunnerOptions {
  store: Store
  queries: Query[]
  adapters: EngineAdapter[]
  evidence: EvidenceStore
  /** Repeats per query per engine. Reproducibility needs at least 2. */
  repeats: number
  /** In-flight requests per engine. */
  concurrency?: number
  /** Pause between requests to one engine, in milliseconds. */
  delayMs?: number
  onProgress?: (event: ProgressEvent) => void
}

export interface ProgressEvent {
  engine: EngineId
  queryText: string
  repeat: number
  done: number
  total: number
  error?: string
}

export interface RunnerResult {
  observations: Observation[]
  reproducibility: EngineReproducibility[]
  /** Engines that were skipped, with the reason, for the report legend. */
  skipped: Array<{ engine: EngineId; reason: string }>
}

export async function runObservations(options: RunnerOptions): Promise<RunnerResult> {
  const {
    store,
    queries,
    adapters,
    evidence,
    repeats,
    concurrency = 2,
    delayMs = 400,
    onProgress,
  } = options

  await evidence.init()

  const active: EngineAdapter[] = []
  const skipped: RunnerResult['skipped'] = []
  for (const adapter of adapters) {
    if (adapter.configured()) active.push(adapter)
    else skipped.push({ engine: adapter.engine, reason: adapter.configurationHint() })
  }

  const total = active.length * queries.length * repeats
  let done = 0

  const perEngine = await Promise.all(
    active.map(async (adapter) => {
      const tasks: Array<{ query: Query; repeat: number }> = []
      for (const query of queries) {
        for (let repeat = 0; repeat < repeats; repeat += 1) tasks.push({ query, repeat })
      }

      const observations: Observation[] = []
      let cursor = 0

      const worker = async (): Promise<void> => {
        while (cursor < tasks.length) {
          const index = cursor
          cursor += 1
          const task = tasks[index]
          if (!task) return

          const observedAt = new Date().toISOString()
          let cards: Observation['cards'] = []
          let error: string | undefined
          let raw: unknown

          try {
            const result = await adapter.observe({
              query: task.query,
              storeDomain: store.domain,
              market: store.market,
              language: store.language,
              repeat: task.repeat,
            })
            cards = result.cards
            error = result.error
            raw = result.raw
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught)
            raw = { source: 'adapter-exception', engine: adapter.engine, error }
          }

          // Evidence is written for failures too: "the provider returned 429 at
          // this timestamp" is part of the record.
          const rawRef = await evidence.put({
            engine: adapter.engine,
            queryId: task.query.id,
            repeat: task.repeat,
            payload: raw,
          })

          const observation: Observation = {
            id: stableId('obs', store.id, adapter.engine, task.query.id, String(task.repeat), observedAt),
            storeId: store.id,
            queryId: task.query.id,
            engine: adapter.engine,
            method: adapter.method,
            observedAt,
            rawRef,
            cards,
            repeat: task.repeat,
          }
          if (error) observation.error = error
          observations.push(observation)

          done += 1
          onProgress?.({
            engine: adapter.engine,
            queryText: task.query.text,
            repeat: task.repeat,
            done,
            total,
            error,
          })

          if (delayMs > 0 && cursor < tasks.length) await sleep(delayMs)
        }
      }

      const lanes = adapter.method === 'api' ? Math.max(1, concurrency) : 1
      await Promise.all(Array.from({ length: lanes }, () => worker()))

      return {
        adapter,
        observations,
        reproducibility: scoreReproducibility({
          engine: adapter.engine,
          method: adapter.method,
          observations,
          repeats,
        }),
      }
    }),
  )

  const observations = perEngine.flatMap((entry) => entry.observations)
  const reproducibility = perEngine.map((entry) => entry.reproducibility)

  // A skipped engine still appears in the reproducibility table, as not
  // measured, so the Phase 0 report never silently omits a surface.
  for (const entry of skipped) {
    reproducibility.push({
      engine: entry.engine,
      method: 'api',
      repeats,
      rate: 0,
      observable: false,
      queriesMeasured: 0,
      errors: 0,
      note: `not run: ${entry.reason}`,
    })
  }

  return { observations, reproducibility, skipped }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
