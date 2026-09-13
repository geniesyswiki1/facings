import {
  type AdapterResult,
  type EngineAdapter,
  type ObserveInput,
  readJsonResponse,
  shopperPrompt,
} from '../adapter.js'
import { parseCards } from './openai.js'

/**
 * Perplexity, observed through the Perplexity API for text and citations.
 *
 * SPEC 4.4 notes that card rendering needs the panel; this adapter covers text
 * and citations, which is where price and availability misstatements show up.
 */
export class PerplexityAdapter implements EngineAdapter {
  readonly engine = 'perplexity' as const
  readonly method = 'api' as const
  readonly label = 'Perplexity (API, text and citations)'
  readonly termsNote = 'Perplexity API, automated use within the API terms.'

  constructor(
    private readonly apiKey = process.env.PERPLEXITY_API_KEY ?? '',
    private readonly model = process.env.SHOWING_UP_PERPLEXITY_MODEL ?? 'sonar',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return this.apiKey.length > 0
  }

  configurationHint(): string {
    return 'set PERPLEXITY_API_KEY. Optional: SHOWING_UP_PERPLEXITY_MODEL.'
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const request = {
      model: this.model,
      messages: [{ role: 'user', content: shopperPrompt(input.query, input.market, input.language) }],
      max_tokens: 1500,
    }

    const response = await this.fetchImpl('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: input.signal,
    })

    const { ok, body, status } = await readJsonResponse(response)
    const raw = { request: { ...request, messages: '[prompt omitted, see harness source]' }, response: body, status }
    if (!ok) return { cards: [], raw, error: `Perplexity HTTP ${status}` }

    const payload = body as { choices?: Array<{ message?: { content?: string } }> }
    const text = payload.choices?.[0]?.message?.content ?? ''
    const result = parseCards(text, input.storeDomain)

    // Citations are the engine's own source list. Where a card carries no URL,
    // a citation on the merchant's domain is still evidence of presence.
    const citations = (body as { citations?: string[] }).citations ?? []
    for (const card of result.cards) {
      if (card.url) continue
      const match = citations.find((c) => c.includes(input.storeDomain.replace(/^www\./, '')))
      if (match) card.url = match
    }

    return { ...result, raw }
  }
}
