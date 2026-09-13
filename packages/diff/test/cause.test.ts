import { describe, expect, it } from 'vitest'
import type { Finding, Product } from '@showing-up/shared'
import { inferCauses } from '@showing-up/diff'

const product: Product = {
  storeId: 's1',
  sku: 'A1',
  title: 'Northfield AM10',
  price: 749,
  currency: 'GBP',
  availability: 'in_stock',
  url: 'https://store.example/am10',
  attributes: {},
  updatedAt: '2026-09-12T08:00:00.000Z',
}

const finding: Finding = {
  id: 'fnd_1',
  observationId: 'obs_1',
  engine: 'openai',
  queryId: 'q1',
  queryText: 'where can I buy Northfield AM10',
  sku: 'A1',
  type: 'price_mismatch',
  severity: 'high',
  expected: { price: 749 },
  observed: { price: 869 },
  cause: 'the price on the page and the price in the feed disagree',
  causeInferred: false,
  revenueAtRisk: 10,
  status: 'open',
}

function reply(text: string, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status })) as typeof fetch
}

describe('inferCauses', () => {
  it('does nothing without a key, and says why', async () => {
    const result = await inferCauses([finding], [product], { apiKey: '' })
    expect(result.findings[0]?.cause).toBe(finding.cause)
    expect(result.skippedReason).toContain('ANTHROPIC_API_KEY')
  })

  it('labels a replaced cause as inferred', async () => {
    const result = await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: reply(JSON.stringify({ causes: [{ id: 'fnd_1', cause: 'the feed has no GTIN, so the engine matched a reseller listing' }] })),
    })
    expect(result.findings[0]?.causeInferred).toBe(true)
    expect(result.findings[0]?.cause).toContain('no GTIN')
  })

  it('leaves the deterministic label in place when the model returns the same cause', async () => {
    const result = await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: reply(JSON.stringify({ causes: [{ id: 'fnd_1', cause: finding.cause }] })),
    })
    expect(result.findings[0]?.causeInferred).toBe(false)
  })

  it('cannot create, remove or re-grade a finding', async () => {
    const result = await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: reply(
        JSON.stringify({
          causes: [
            { id: 'fnd_1', cause: 'a new cause' },
            { id: 'fnd_invented', cause: 'a finding that does not exist' },
          ],
        }),
      ),
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ type: 'price_mismatch', severity: 'high', revenueAtRisk: 10 })
  })

  it('enforces the dash rule on model text', async () => {
    const result = await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: reply(JSON.stringify({ causes: [{ id: 'fnd_1', cause: 'stale feed \u2014 refresh it' }] })),
    })
    expect(result.findings[0]?.cause).toBe('stale feed - refresh it')
  })

  it('keeps the deterministic causes when the API fails', async () => {
    const result = await inferCauses([finding], [product], { apiKey: 'k', fetchImpl: reply('{}', 500) })
    expect(result.findings[0]?.cause).toBe(finding.cause)
    expect(result.skippedReason).toContain('500')
  })

  it('keeps the deterministic causes when the response does not validate', async () => {
    const result = await inferCauses([finding], [product], { apiKey: 'k', fetchImpl: reply('not json at all') })
    expect(result.findings[0]?.causeInferred).toBe(false)
    expect(result.skippedReason).toContain('did not validate')
  })

  it('keeps the deterministic causes when the request throws', async () => {
    const result = await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new Error('socket hang up')
      }) as typeof fetch,
    })
    expect(result.skippedReason).toContain('socket hang up')
  })

  it('sends catalogue evidence rather than the raw catalogue', async () => {
    let body: any
    await inferCauses([finding], [product], {
      apiKey: 'k',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body))
        return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"causes":[]}' }] }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    const prompt = String(body.messages[0].content)
    expect(prompt).toContain('attributeCompleteness')
    expect(prompt).toContain('Do not invent')
  })
})
