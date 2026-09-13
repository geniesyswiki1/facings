import type { Card, EngineId, ObservationMethod, Query } from '@showing-up/shared'

/**
 * The adapter contract. One per engine, per SPEC 4.4.
 *
 * An adapter either observes the surface through an official API, or it does
 * not observe it at all and says so. There is no third path: approximating a
 * surface Showing Up cannot reach would put an unfalsifiable claim into a document
 * we sell as a compliance record.
 */
export interface EngineAdapter {
  engine: EngineId
  /** What this adapter is: the method stamped on every observation it makes. */
  method: ObservationMethod
  /** Human label for the report legend. */
  label: string
  /** Which provider terms the operator agreed to. Printed in the run manifest. */
  termsNote: string
  /** False when required credentials are missing. */
  configured(): boolean
  /** Why the adapter is not configured, for the operator's console output. */
  configurationHint(): string
  observe(input: ObserveInput): Promise<AdapterResult>
}

export interface ObserveInput {
  query: Query
  /** The merchant's domain, used to tell own cards from third-party cards. */
  storeDomain: string
  market: string
  language: string
  repeat: number
  signal?: AbortSignal
}

export interface AdapterResult {
  cards: Card[]
  /** The provider payload, stored verbatim in the evidence store. */
  raw: unknown
  /** Set when the surface could not be observed on this attempt. */
  error?: string
}

/**
 * The shopper prompt, shared by every API adapter.
 *
 * One prompt across engines is deliberate: a diff between engines is only
 * meaningful if the question was identical. It asks for the engine's own
 * shopping answer and then for that answer restated as cards, so the cards are
 * a transcription of the response rather than a separate generation.
 */
export function shopperPrompt(query: Query, market: string, language: string): string {
  return [
    `You are answering a shopper in ${market}. Their language is ${language}.`,
    `Shopper question: "${query.text}"`,
    '',
    'Answer it the way you normally would, using current web information, then restate the specific products you surfaced as JSON.',
    '',
    'Return only this JSON object and nothing else:',
    '{"cards":[{"title":"","brand":"","price":"","currency":"","availability":"","rating":"","image":"","url":"","retailer":"","evidence":""}]}',
    '',
    'Rules for the JSON:',
    '- One entry per product you actually named, in the order you presented them.',
    '- Copy price, availability and rating only if you stated them. Leave the field as an empty string if you did not. Do not look up a value to fill a gap.',
    '- "url" is the product page you linked or cited. "retailer" is who sells it.',
    '- "evidence" is the sentence from your answer that names this product.',
    '- If you named no specific product, return {"cards":[]}.',
  ].join('\n')
}

/** Shared JSON body reader that keeps the error body for the evidence store. */
export async function readJsonResponse(response: Response): Promise<{ ok: boolean; body: unknown; status: number }> {
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { nonJsonBody: text.slice(0, 4000) }
  }
  return { ok: response.ok, body, status: response.status }
}
