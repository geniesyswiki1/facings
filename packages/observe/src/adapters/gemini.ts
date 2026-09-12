import {
  type AdapterResult,
  type EngineAdapter,
  type ObserveInput,
  readJsonResponse,
  shopperPrompt,
} from '../adapter.js'
import { parseCards } from './openai.js'

/**
 * Gemini, observed through the Gemini API with Google Search grounding.
 *
 * Google AI Mode is a different surface with no product-search API, so it is
 * handled by the panel adapter and never inferred from this one. SPEC 4.4.
 */
export class GeminiAdapter implements EngineAdapter {
  readonly engine = 'gemini' as const
  readonly method = 'api' as const
  readonly label = 'Gemini (API, Search grounding)'
  readonly termsNote = 'Google AI Studio API with Search grounding, automated use within the API terms.'

  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? '',
    private readonly model = process.env.FACINGS_GEMINI_MODEL ?? 'gemini-2.5-flash',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return this.apiKey.length > 0
  }

  configurationHint(): string {
    return 'set GEMINI_API_KEY (or GOOGLE_AI_API_KEY). Optional: FACINGS_GEMINI_MODEL.'
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const request = {
      contents: [{ role: 'user', parts: [{ text: shopperPrompt(input.query, input.market, input.language) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 1500 },
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(request),
      signal: input.signal,
    })

    const { ok, body, status } = await readJsonResponse(response)
    const raw = { request: { ...request, contents: '[prompt omitted, see harness source]' }, response: body, status }
    if (!ok) return { cards: [], raw, error: `Gemini HTTP ${status}` }

    const payload = body as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n')
    return { ...parseCards(text, input.storeDomain), raw }
  }
}
