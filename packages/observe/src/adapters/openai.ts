import type { Card } from '@showing-up/shared'
import {
  type AdapterResult,
  type EngineAdapter,
  type ObserveInput,
  readJsonResponse,
  shopperPrompt,
} from '../adapter.js'
import { extractCardJson, normaliseCards, rawCardListSchema } from '../cards.js'

/**
 * ChatGPT, observed through the OpenAI Responses API with web search.
 *
 * SPEC 4.4 pairs this with a consented panel for the consumer shopping surface,
 * which the panel adapter covers. This adapter observes what the API renders,
 * and the report labels it as such: it is not a claim about what a logged-in
 * shopper sees in the ChatGPT app.
 */
export class OpenAiAdapter implements EngineAdapter {
  readonly engine = 'openai' as const
  readonly method = 'api' as const
  readonly label = 'ChatGPT (Responses API, web search)'
  readonly termsNote = 'OpenAI API, automated use within the API terms. No consumer surface scraped.'

  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY ?? '',
    private readonly model = process.env.SHOWING_UP_OPENAI_MODEL ?? 'gpt-4.1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return this.apiKey.length > 0
  }

  configurationHint(): string {
    return 'set OPENAI_API_KEY. Optional: SHOWING_UP_OPENAI_MODEL.'
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const request = {
      model: this.model,
      input: shopperPrompt(input.query, input.market, input.language),
      tools: [{ type: 'web_search' }],
      // Deterministic sampling is not available with the search tool, so
      // reproducibility is measured rather than assumed.
      max_output_tokens: 1500,
    }

    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: input.signal,
    })

    const { ok, body, status } = await readJsonResponse(response)
    const raw = { request: { ...request, input: '[prompt omitted, see harness source]' }, response: body, status }
    if (!ok) return { cards: [], raw, error: `OpenAI HTTP ${status}` }

    const text = collectOutputText(body)
    return { ...parseCards(text, input.storeDomain), raw }
  }
}

/** Responses API returns a typed output array; concatenate the text parts. */
function collectOutputText(body: unknown): string {
  const payload = body as {
    output_text?: string
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text) parts.push(content.text)
    }
  }
  return parts.join('\n')
}

/** Shared by every API adapter: validate then normalise, never guess. */
export function parseCards(text: string, storeDomain: string): { cards: Card[]; error?: string } {
  if (!text.trim()) return { cards: [], error: 'the engine returned no text' }
  const json = extractCardJson(text)
  if (json === undefined) return { cards: [], error: 'no JSON card block in the response' }
  const parsed = rawCardListSchema.safeParse(json)
  if (!parsed.success) return { cards: [], error: `card JSON failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}` }
  return { cards: normaliseCards(parsed.data.cards, storeDomain) }
}
