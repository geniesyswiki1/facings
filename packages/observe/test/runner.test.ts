import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Query, Store } from '@facings/shared'
import { sha256 } from '@facings/shared'
import {
  type AdapterResult,
  type EngineAdapter,
  EvidenceStore,
  type ObserveInput,
  runObservations,
} from '@facings/observe'

const store: Store = {
  id: 's1',
  domain: 'store.example',
  url: 'https://store.example/',
  platform: 'woocommerce',
  market: 'UK',
  language: 'en',
  connectorStatus: 'manual',
}

const queries: Query[] = [
  { id: 'q1', storeId: 's1', text: 'query one', market: 'UK', language: 'en', source: 'catalogue', volumeProxy: 0.9, expectedSkus: ['A1'] },
  { id: 'q2', storeId: 's1', text: 'query two', market: 'UK', language: 'en', source: 'benchmark', volumeProxy: 0.8, expectedSkus: ['A1'] },
]

class StubAdapter implements EngineAdapter {
  readonly engine = 'openai' as const
  readonly method = 'api' as const
  readonly label = 'stub'
  readonly termsNote = 'stub'
  calls = 0

  constructor(private readonly behaviour: (input: ObserveInput) => AdapterResult | Promise<AdapterResult>) {}

  configured(): boolean {
    return true
  }

  configurationHint(): string {
    return 'stub'
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    this.calls += 1
    return this.behaviour(input)
  }
}

class UnconfiguredAdapter implements EngineAdapter {
  readonly engine = 'gemini' as const
  readonly method = 'api' as const
  readonly label = 'gemini'
  readonly termsNote = 'stub'
  configured(): boolean {
    return false
  }
  configurationHint(): string {
    return 'set GEMINI_API_KEY'
  }
  async observe(): Promise<AdapterResult> {
    throw new Error('must not be called')
  }
}

async function evidenceDir(): Promise<{ dir: string; evidence: EvidenceStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'facings-run-'))
  return { dir, evidence: new EvidenceStore(dir) }
}

describe('runObservations', () => {
  it('walks every query and repeat and stores evidence for each', async () => {
    const { dir, evidence } = await evidenceDir()
    const adapter = new StubAdapter(() => ({ cards: [{ position: 1, title: 'Widget' }], raw: { ok: true } }))

    const result = await runObservations({ store, queries, adapters: [adapter], evidence, repeats: 2, delayMs: 0 })

    expect(result.observations).toHaveLength(4)
    expect(adapter.calls).toBe(4)
    const files = await readdir(join(dir, 'raw'))
    expect(files).toHaveLength(4)
    expect(files).toContain('openai__q1__r0.json')
  })

  it('hashes the stored evidence so a finding can be traced to the exact bytes', async () => {
    const { dir, evidence } = await evidenceDir()
    const adapter = new StubAdapter(() => ({ cards: [], raw: { provider: 'payload' } }))
    const result = await runObservations({ store, queries: [queries[0] as Query], adapters: [adapter], evidence, repeats: 1, delayMs: 0 })

    const observation = result.observations[0]
    const body = await readFile(join(dir, observation?.rawRef.path as string), 'utf8')
    expect(sha256(body)).toBe(observation?.rawRef.sha256)
    expect(observation?.rawRef.bytes).toBe(Buffer.byteLength(body, 'utf8'))
  })

  it('stores evidence for a failed attempt too, because the failure is part of the record', async () => {
    const { evidence } = await evidenceDir()
    const adapter = new StubAdapter(() => ({ cards: [], raw: { status: 429 }, error: 'HTTP 429' }))
    const result = await runObservations({ store, queries: [queries[0] as Query], adapters: [adapter], evidence, repeats: 1, delayMs: 0 })
    expect(result.observations[0]?.error).toBe('HTTP 429')
    expect(result.observations[0]?.rawRef.sha256).toHaveLength(64)
  })

  it('survives an adapter that throws, and records the exception', async () => {
    const { evidence } = await evidenceDir()
    const adapter = new StubAdapter(() => {
      throw new Error('socket hang up')
    })
    const result = await runObservations({ store, queries: [queries[0] as Query], adapters: [adapter], evidence, repeats: 1, delayMs: 0 })
    expect(result.observations[0]?.error).toBe('socket hang up')
  })

  it('does not let one surface outage lose another surface run', async () => {
    const { evidence } = await evidenceDir()
    const failing = new StubAdapter(() => {
      throw new Error('down')
    })
    const working = new StubAdapter(() => ({ cards: [{ position: 1, title: 'Widget' }], raw: {} }))
    Object.defineProperty(working, 'engine', { value: 'claude' })

    const result = await runObservations({
      store,
      queries: [queries[0] as Query],
      adapters: [failing, working],
      evidence,
      repeats: 1,
      delayMs: 0,
    })
    expect(result.observations.filter((o) => !o.error)).toHaveLength(1)
    expect(result.observations.filter((o) => o.error)).toHaveLength(1)
  })

  it('skips an unconfigured surface and still lists it as not observable', async () => {
    const { evidence } = await evidenceDir()
    const result = await runObservations({
      store,
      queries: [queries[0] as Query],
      adapters: [new StubAdapter(() => ({ cards: [], raw: {} })), new UnconfiguredAdapter()],
      evidence,
      repeats: 2,
      delayMs: 0,
    })

    expect(result.skipped).toEqual([{ engine: 'gemini', reason: 'set GEMINI_API_KEY' }])
    const gemini = result.reproducibility.find((entry) => entry.engine === 'gemini')
    expect(gemini?.observable).toBe(false)
    expect(gemini?.note).toContain('not run')
  })

  it('reports progress totals that match the work done', async () => {
    const { evidence } = await evidenceDir()
    const events: number[] = []
    await runObservations({
      store,
      queries,
      adapters: [new StubAdapter(() => ({ cards: [], raw: {} }))],
      evidence,
      repeats: 2,
      delayMs: 0,
      onProgress: (event) => events.push(event.total),
    })
    expect(events).toHaveLength(4)
    expect(new Set(events)).toEqual(new Set([4]))
  })

  it('runs a panel adapter in a single lane, since a person runs the sessions', async () => {
    const { evidence } = await evidenceDir()
    let concurrent = 0
    let peak = 0
    const adapter = new StubAdapter(async () => {
      concurrent += 1
      peak = Math.max(peak, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 5))
      concurrent -= 1
      return { cards: [], raw: {} }
    })
    Object.defineProperty(adapter, 'method', { value: 'consented-panel' })

    await runObservations({ store, queries, adapters: [adapter], evidence, repeats: 2, delayMs: 0, concurrency: 4 })
    expect(peak).toBe(1)
  })
})
