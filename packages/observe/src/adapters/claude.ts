import {
  type AdapterResult,
  type EngineAdapter,
  type ObserveInput,
  readJsonResponse,
  shopperPrompt,
} from '../adapter.js'
import { parseCards } from './openai.js'

/**
 * Claude, observed through the Anthropic API with the web search tool.
 *
 * SPEC 4.4 scopes this to how products are named and characterised, which is
 * why a Claude observation raises naming and specification findings more often
 * than card-position ones.
 */
export class ClaudeAdapter implements EngineAdapter {
  readonly engine = 'claude' as const
  readonly method = 'api' as const
  readonly label = 'Claude (API, web search)'
  readonly termsNote = 'Anthropic API with the web search tool, automated use within the API terms.'

  constructor(
    private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? '',
    private readonly model = process.env.FACINGS_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
  ) {}

  configured(): boolean {
    return this.apiKey.length > 0
  }

  configurationHint(): string {
    return 'set ANTHROPIC_API_KEY. Optional: FACINGS_ANTHROPIC_MODEL.'
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const request = {
      model: this.model,
      max_tokens: 1500,
      messages: [{ role: 'user', content: shopperPrompt(input.query, input.market, input.language) }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    }

    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: input.signal,
    })

    const { ok, body, status } = await readJsonResponse(response)
    const raw = { request: { ...request, messages: '[prompt omitted, see harness source]' }, response: body, status }
    if (!ok) return { cards: [], raw, error: `Anthropic HTTP ${status}` }

    const payload = body as { content?: Array<{ type?: string; text?: string }> }
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text as string)
      .join('\n')
    return { ...parseCards(text, input.storeDomain), raw }
  }
}
