import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Card, EngineId } from '@facings/shared'
import { ENGINE_LABELS } from '@facings/shared'
import type { AdapterResult, EngineAdapter, ObserveInput } from '../adapter.js'
import { normaliseCards, rawCardListSchema } from '../cards.js'

/**
 * The consented panel adapter.
 *
 * Google AI Mode and Copilot have no product-search API. SPEC 4.4 allows them
 * to be observed only inside a human-initiated session run by a consented
 * panel member, and forbids scraping them otherwise. So this adapter does not
 * touch the network at all: it reads capture files that a panel member produced
 * by running the queries themselves, and stamps every observation
 * 'consented-panel' so the method travels into the report and the audit log.
 *
 * A missing capture is reported as not observed. It is never filled in from an
 * API surface, because "what Gemini's API returned" is not evidence about what
 * Google AI Mode rendered.
 */

const panelCardsSchema = rawCardListSchema.shape.cards

const sessionSchema = z.object({
  queryId: z.string().optional(),
  queryText: z.string(),
  repeat: z.number().int().min(0).default(0),
  /** Empty array is a real observation: the surface rendered no product card. */
  cards: panelCardsSchema,
  /** Relative path to the screenshot the panel member saved. */
  screenshot: z.string().optional(),
  notes: z.string().optional(),
})

export const panelCaptureSchema = z.object({
  engine: z.string(),
  market: z.string(),
  language: z.string().optional(),
  /** Panel member identifier. Not an end user: staff or an opted-in merchant. */
  operator: z.string(),
  /** Pointer to the signed consent and instruction sheet for this member. */
  consentRef: z.string(),
  capturedAt: z.string(),
  sessions: z.array(sessionSchema),
})

export type PanelCapture = z.infer<typeof panelCaptureSchema>

export interface PanelIndexEntry {
  cards: Card[]
  raw: unknown
}

/** Loads and validates every capture file in a directory. */
export async function loadPanelCaptures(
  dir: string,
  storeDomain: string,
): Promise<{ index: Map<string, PanelIndexEntry>; warnings: string[] }> {
  const index = new Map<string, PanelIndexEntry>()
  const warnings: string[] = []

  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    return { index, warnings: [`no panel capture directory at ${dir}`] }
  }

  for (const file of files) {
    const path = join(dir, file)
    let parsed: PanelCapture
    try {
      parsed = panelCaptureSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      warnings.push(`panel capture ${file} rejected: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (!parsed.consentRef.trim() || !parsed.operator.trim()) {
      warnings.push(`panel capture ${file} rejected: operator and consentRef are required`)
      continue
    }

    for (const session of parsed.sessions) {
      const key = panelKey(parsed.engine as EngineId, session.queryId ?? session.queryText, session.repeat)
      index.set(key, {
        cards: normaliseCards(session.cards, storeDomain),
        raw: {
          source: 'consented-panel',
          file,
          engine: parsed.engine,
          operator: parsed.operator,
          consentRef: parsed.consentRef,
          capturedAt: parsed.capturedAt,
          market: parsed.market,
          session,
        },
      })
    }
  }

  return { index, warnings }
}

export function panelKey(engine: EngineId, queryRef: string, repeat: number): string {
  return `${engine}::${queryRef.trim().toLowerCase()}::${repeat}`
}

export class PanelAdapter implements EngineAdapter {
  readonly method = 'consented-panel' as const
  readonly label: string
  readonly termsNote: string

  constructor(
    readonly engine: EngineId,
    private readonly index: Map<string, PanelIndexEntry>,
    private readonly captureDir: string,
  ) {
    this.label = `${ENGINE_LABELS[engine] ?? engine} (consented panel session)`
    this.termsNote = 'Observed by a human-initiated session run by a consented panel member. No automated access.'
  }

  configured(): boolean {
    return this.index.size > 0
  }

  configurationHint(): string {
    return `place panel capture files in ${this.captureDir}. Generate the sheet with: facings-audit panel`
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const byId = this.index.get(panelKey(this.engine, input.query.id, input.repeat))
    const byText = this.index.get(panelKey(this.engine, input.query.text, input.repeat))
    const entry = byId ?? byText

    if (!entry) {
      return {
        cards: [],
        raw: {
          source: 'consented-panel',
          engine: this.engine,
          query: input.query.text,
          repeat: input.repeat,
          status: 'no capture supplied',
        },
        error: 'no consented panel capture for this query and repeat',
      }
    }

    return { cards: entry.cards, raw: entry.raw }
  }
}

/**
 * The one-page instruction sheet from SPEC 12.2. Generated per run so the
 * panel member runs exactly the queries the audit will diff, in order.
 */
export function panelInstructionSheet(params: {
  storeDomain: string
  market: string
  language: string
  engines: EngineId[]
  repeats: number
  queries: Array<{ id: string; text: string }>
}): string {
  const lines: string[] = []
  lines.push('# Facings panel session sheet')
  lines.push('')
  lines.push(`Store: ${params.storeDomain}`)
  lines.push(`Market: ${params.market}. Language: ${params.language}.`)
  lines.push(`Surfaces: ${params.engines.map((e) => ENGINE_LABELS[e] ?? e).join(', ')}`)
  lines.push(`Repeats per query: ${params.repeats}`)
  lines.push('')
  lines.push('## Before you start')
  lines.push('')
  lines.push('1. You must have signed the panel consent sheet. Put its reference in the capture file.')
  lines.push('2. Use your own account in a normal browser session. Do not use an automation tool.')
  lines.push('3. Set the browser region and language to the market above.')
  lines.push('4. Do not click sponsored placements or shopping ads, and do not sign in to the merchant.')
  lines.push('5. Start each repeat in a fresh conversation or a fresh tab.')
  lines.push('')
  lines.push('## What to record per query')
  lines.push('')
  lines.push('For every product the surface showed as a card or named in its answer, record the title, brand,')
  lines.push('price, availability, rating, image URL, the link target and the retailer. Copy only what is on')
  lines.push('screen. If a field is not shown, leave it empty. If nothing was shown, record an empty card list:')
  lines.push('that is a real result and the report needs it.')
  lines.push('')
  lines.push('Save a screenshot per session and put the filename in the capture file.')
  lines.push('')
  lines.push('## Queries')
  lines.push('')
  for (const [index, query] of params.queries.entries()) {
    lines.push(`${index + 1}. ${query.text}`)
  }
  lines.push('')
  lines.push('## Where the file goes')
  lines.push('')
  lines.push('Fill in the generated capture template, one file per surface, and save it into the panel')
  lines.push('directory the run points at. Then re-run the audit with the same run id.')
  lines.push('')
  return lines.join('\n')
}

/** Pre-filled capture template: the panel member types into the empty fields. */
export function panelCaptureTemplate(params: {
  engine: EngineId
  market: string
  language: string
  repeats: number
  queries: Array<{ id: string; text: string }>
}): PanelCapture {
  const sessions: PanelCapture['sessions'] = []
  for (const query of params.queries) {
    for (let repeat = 0; repeat < params.repeats; repeat += 1) {
      sessions.push({
        queryId: query.id,
        queryText: query.text,
        repeat,
        cards: [],
        screenshot: '',
        notes: '',
      })
    }
  }
  return {
    engine: params.engine,
    market: params.market,
    language: params.language,
    operator: '',
    consentRef: '',
    capturedAt: new Date().toISOString(),
    sessions,
  }
}
