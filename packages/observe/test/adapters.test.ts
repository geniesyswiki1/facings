import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Query } from '@showing-up/shared'
import {
  ClaudeAdapter,
  GeminiAdapter,
  OpenAiAdapter,
  PanelAdapter,
  PerplexityAdapter,
  loadPanelCaptures,
  panelCaptureTemplate,
  panelInstructionSheet,
} from '@showing-up/observe'

const query: Query = {
  id: 'qry_1',
  storeId: 's1',
  text: 'where can I buy a Northfield AM10',
  market: 'UK',
  language: 'en',
  source: 'catalogue',
  volumeProxy: 0.9,
  expectedSkus: ['A1'],
}

const input = { query, storeDomain: 'store.example', market: 'UK', language: 'en', repeat: 0 }

const cardJson = JSON.stringify({
  cards: [
    { title: 'Northfield AM10', brand: 'Northfield', price: '749.00', currency: 'GBP', availability: 'in stock', url: 'https://store.example/am10' },
  ],
})

describe('API adapters', () => {
  it('reads the OpenAI Responses output and records the request', async () => {
    const adapter = new OpenAiAdapter(
      'key',
      'gpt-4.1',
      async () => new Response(JSON.stringify({ output_text: cardJson }), { status: 200 }),
    )
    const result = await adapter.observe(input)
    expect(result.cards[0]).toMatchObject({ title: 'Northfield AM10', price: 749 })
    expect(result.error).toBeUndefined()
    expect(adapter.method).toBe('api')
  })

  it('reads the Responses output array when there is no output_text', async () => {
    const adapter = new OpenAiAdapter(
      'key',
      'gpt-4.1',
      async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: cardJson }] }] }), { status: 200 }),
    )
    expect((await adapter.observe(input)).cards).toHaveLength(1)
  })

  it('asks OpenAI for web search, since a model with no search cannot observe a surface', async () => {
    let body: any
    const adapter = new OpenAiAdapter('key', 'gpt-4.1', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ output_text: cardJson }), { status: 200 })
    })
    await adapter.observe(input)
    expect(body.tools?.[0]?.type).toBe('web_search')
  })

  it('reads Gemini candidates and asks for Search grounding', async () => {
    let body: any
    const adapter = new GeminiAdapter('key', 'gemini-2.5-flash', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: cardJson }] } }] }), { status: 200 })
    })
    expect((await adapter.observe(input)).cards).toHaveLength(1)
    expect(body.tools?.[0]).toHaveProperty('google_search')
  })

  it('reads Perplexity choices and promotes a citation onto a card with no URL', async () => {
    const withoutUrl = JSON.stringify({ cards: [{ title: 'Northfield AM10', price: '749' }] })
    const adapter = new PerplexityAdapter('key', 'sonar', async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: withoutUrl } }],
          citations: ['https://store.example/am10'],
        }),
        { status: 200 },
      ),
    )
    const result = await adapter.observe(input)
    expect(result.cards[0]?.url).toBe('https://store.example/am10')
  })

  it('reads Anthropic text blocks and asks for the web search tool', async () => {
    let body: any
    const adapter = new ClaudeAdapter('key', 'claude-sonnet-4-5', async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ content: [{ type: 'text', text: cardJson }] }), { status: 200 })
    })
    expect((await adapter.observe(input)).cards).toHaveLength(1)
    expect(body.tools?.[0]?.name).toBe('web_search')
  })

  it('records an HTTP failure as an error rather than as an empty rendering', async () => {
    const adapter = new OpenAiAdapter('key', 'gpt-4.1', async () => new Response('{"error":"rate limit"}', { status: 429 }))
    const result = await adapter.observe(input)
    expect(result.error).toContain('429')
    expect(result.cards).toEqual([])
    expect(result.raw).toMatchObject({ status: 429 })
  })

  it('reports unparseable output as an error, so it is never read as absence', async () => {
    const adapter = new OpenAiAdapter('key', 'gpt-4.1', async () => new Response(JSON.stringify({ output_text: 'I cannot help with that.' }), { status: 200 }))
    expect((await adapter.observe(input)).error).toContain('no JSON card block')
  })

  it('is unconfigured without a key, and says which one', () => {
    expect(new OpenAiAdapter('').configured()).toBe(false)
    expect(new OpenAiAdapter('').configurationHint()).toContain('OPENAI_API_KEY')
    expect(new GeminiAdapter('').configurationHint()).toContain('GEMINI_API_KEY')
    expect(new PerplexityAdapter('').configurationHint()).toContain('PERPLEXITY_API_KEY')
    expect(new ClaudeAdapter('').configurationHint()).toContain('ANTHROPIC_API_KEY')
  })

  it('never omits the observation method or the terms note', () => {
    for (const adapter of [new OpenAiAdapter('k'), new GeminiAdapter('k'), new PerplexityAdapter('k'), new ClaudeAdapter('k')]) {
      expect(adapter.method).toBe('api')
      expect(adapter.termsNote.length).toBeGreaterThan(10)
    }
  })
})

describe('consented panel', () => {
  async function panelDir(capture: unknown, name = 'capture-copilot.json'): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'showing-up-panel-'))
    await writeFile(join(dir, name), JSON.stringify(capture), 'utf8')
    return dir
  }

  const validCapture = {
    engine: 'copilot',
    market: 'UK',
    language: 'en',
    operator: 'panel-member-2',
    consentRef: 'consent-2026-09-01-pm2',
    capturedAt: '2026-09-12T09:00:00.000Z',
    sessions: [
      {
        queryId: 'qry_1',
        queryText: 'where can I buy a Northfield AM10',
        repeat: 0,
        cards: [{ title: 'Northfield AM10', price: '749', url: 'https://store.example/am10' }],
        screenshot: 'copilot-q1-r0.png',
      },
    ],
  }

  it('never touches the network, and stamps the observation as a panel session', async () => {
    const dir = await panelDir(validCapture)
    const { index } = await loadPanelCaptures(dir, 'store.example')
    const adapter = new PanelAdapter('copilot', index, dir)
    expect(adapter.method).toBe('consented-panel')
    const result = await adapter.observe(input)
    expect(result.cards[0]?.title).toBe('Northfield AM10')
    expect(result.raw).toMatchObject({ source: 'consented-panel', consentRef: 'consent-2026-09-01-pm2' })
  })

  it('rejects a capture with no operator or consent reference', async () => {
    const dir = await panelDir({ ...validCapture, consentRef: '' })
    const { index, warnings } = await loadPanelCaptures(dir, 'store.example')
    expect(index.size).toBe(0)
    expect(warnings[0]).toContain('operator and consentRef are required')
  })

  it('rejects a malformed capture with a reason instead of silently ignoring it', async () => {
    const dir = await panelDir({ engine: 'copilot' })
    const { warnings } = await loadPanelCaptures(dir, 'store.example')
    expect(warnings[0]).toContain('rejected')
  })

  it('reports a missing capture as not observed, never as an empty rendering', async () => {
    const dir = await panelDir(validCapture)
    const { index } = await loadPanelCaptures(dir, 'store.example')
    const adapter = new PanelAdapter('copilot', index, dir)
    const result = await adapter.observe({ ...input, repeat: 2 })
    expect(result.error).toContain('no consented panel capture')
    expect(result.cards).toEqual([])
  })

  it('keeps an empty card list as a real observation: the surface rendered nothing', async () => {
    const dir = await panelDir({
      ...validCapture,
      sessions: [{ ...validCapture.sessions[0], cards: [] }],
    })
    const { index } = await loadPanelCaptures(dir, 'store.example')
    const result = await new PanelAdapter('copilot', index, dir).observe(input)
    expect(result.error).toBeUndefined()
    expect(result.cards).toEqual([])
  })

  it('matches a capture by query text when the id is missing', async () => {
    const dir = await panelDir({
      ...validCapture,
      sessions: [{ queryText: 'where can I buy a Northfield AM10', repeat: 0, cards: [{ title: 'Northfield AM10' }] }],
    })
    const { index } = await loadPanelCaptures(dir, 'store.example')
    expect((await new PanelAdapter('copilot', index, dir).observe(input)).cards).toHaveLength(1)
  })

  it('reports a missing panel directory without failing the run', async () => {
    const { index, warnings } = await loadPanelCaptures('/nonexistent/panel/dir', 'store.example')
    expect(index.size).toBe(0)
    expect(warnings[0]).toContain('no panel capture directory')
  })

  it('writes a sheet that states the consent and no-automation rules', () => {
    const sheet = panelInstructionSheet({
      storeDomain: 'store.example',
      market: 'UK',
      language: 'en',
      engines: ['copilot', 'google-ai-mode'],
      repeats: 3,
      queries: [{ id: 'qry_1', text: 'where can I buy a Northfield AM10' }],
    })
    expect(sheet).toContain('signed the panel consent sheet')
    expect(sheet).toContain('Do not use an automation tool')
    expect(sheet).toContain('where can I buy a Northfield AM10')
  })

  it('templates one session per query and repeat, with consent left blank to be filled', () => {
    const template = panelCaptureTemplate({
      engine: 'copilot',
      market: 'UK',
      language: 'en',
      repeats: 3,
      queries: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }],
    })
    expect(template.sessions).toHaveLength(6)
    expect(template.consentRef).toBe('')
    expect(template.operator).toBe('')
  })
})
