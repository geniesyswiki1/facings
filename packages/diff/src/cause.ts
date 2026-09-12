import { z } from 'zod'
import type { Finding, Product } from '@facings/shared'
import { attributeCompleteness } from '@facings/connectors'
import { enforceDashRule, truncate } from '@facings/shared'

/**
 * Model pass for cause inference.
 *
 * SPEC 4.5: deterministic first, model second, and every model-derived cause
 * labelled "inferred cause" in the UI and the log. So this pass may only
 * rewrite the `cause` field and set `causeInferred`. It cannot create, remove
 * or re-grade a finding, which keeps the model out of the part of the report a
 * merchant might have to defend.
 *
 * Optional by design: with no API key the deterministic causes stand and the
 * report says so.
 */

const responseSchema = z.object({
  causes: z.array(
    z.object({
      id: z.string(),
      cause: z.string().min(3).max(300),
    }),
  ),
})

export interface InferCauseOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Cap on findings sent in one request. */
  batchSize?: number
}

export interface InferCauseResult {
  findings: Finding[]
  /** Set when the pass did not run, for the report footer. */
  skippedReason?: string
}

export async function inferCauses(
  findings: Finding[],
  products: Product[],
  options: InferCauseOptions = {},
): Promise<InferCauseResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? ''
  if (!apiKey) {
    return { findings, skippedReason: 'no ANTHROPIC_API_KEY set, so deterministic causes are reported as they are' }
  }
  if (findings.length === 0) return { findings }

  const {
    model = process.env.FACINGS_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
    baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    fetchImpl = fetch,
    batchSize = 25,
  } = options

  const bySku = new Map(products.map((product) => [product.sku, product]))
  const batch = findings.slice(0, batchSize)

  const payload = batch.map((finding) => {
    const product = finding.sku ? bySku.get(finding.sku) : undefined
    return {
      id: finding.id,
      type: finding.type,
      engine: finding.engine,
      query: finding.queryText,
      expected: finding.expected,
      observed: finding.observed,
      deterministicCause: finding.cause,
      product: product
        ? {
            sku: product.sku,
            title: product.title,
            hasGtin: Boolean(product.gtin),
            hasMpn: Boolean(product.mpn),
            attributeCompleteness: Math.round(attributeCompleteness(product) * 100) / 100,
            attributeKeys: Object.keys(product.attributes),
            availability: product.availability,
            catalogueUpdatedAt: product.updatedAt,
          }
        : null,
    }
  })

  const prompt = [
    'You are reviewing findings from an audit of how AI shopping surfaces represent a merchant catalogue.',
    'For each finding, give the most probable cause in one sentence a head of e-commerce would act on.',
    '',
    'Rules:',
    '- Base the cause only on the evidence given. Do not invent catalogue or engine behaviour.',
    '- Prefer a cause the merchant controls: a missing attribute, a stale feed, a price that differs between the page and the feed, absent policy data, no GTIN or MPN.',
    '- If the deterministic cause is already the best explanation, return it unchanged.',
    '- Plain commercial English. No exclamation marks. Use hyphens, never dashes.',
    '',
    'Return only this JSON: {"causes":[{"id":"","cause":""}]}',
    '',
    JSON.stringify(payload),
  ].join('\n')

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      return { findings, skippedReason: `cause inference skipped, Anthropic HTTP ${response.status}` }
    }

    const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }> }
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text as string)
      .join('\n')

    const json = extractJson(text)
    const parsed = responseSchema.safeParse(json)
    if (!parsed.success) {
      return { findings, skippedReason: 'cause inference skipped, the model response did not validate' }
    }

    const causes = new Map(parsed.data.causes.map((entry) => [entry.id, entry.cause]))
    const updated = findings.map((finding) => {
      const cause = causes.get(finding.id)
      if (!cause || cause.trim() === finding.cause.trim()) return finding
      return {
        ...finding,
        cause: enforceDashRule(truncate(cause.trim(), 240)),
        causeInferred: true,
      }
    })

    return { findings: updated }
  } catch (error) {
    return {
      findings,
      skippedReason: `cause inference skipped, ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fence?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1), text].filter(
    Boolean,
  ) as string[]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      continue
    }
  }
  return undefined
}
