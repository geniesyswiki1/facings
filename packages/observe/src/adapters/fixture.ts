import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { EngineId } from '@showing-up/shared'
import { ENGINE_LABELS } from '@showing-up/shared'
import type { AdapterResult, EngineAdapter, ObserveInput } from '../adapter.js'
import { normaliseCards, rawCardListSchema } from '../cards.js'

/**
 * Replay adapter for recorded responses.
 *
 * It exists so the harness, the diff rules and the report can be exercised
 * end to end without spending API credit or a panel member's afternoon, and so
 * the test suite is deterministic. Any run that uses it is stamped fixtureMode
 * in the manifest and the report carries a notice, because a replay is not
 * evidence about a live surface.
 */

const fixtureSchema = z.object({
  /** Per engine, per query text, a list of card lists: one per repeat. */
  engines: z.record(
    z.record(
      z.array(
        z.object({
          cards: rawCardListSchema.shape.cards,
          error: z.string().optional(),
        }),
      ),
    ),
  ),
})

export type FixtureFile = z.infer<typeof fixtureSchema>

export async function loadFixtures(path: string): Promise<FixtureFile> {
  return fixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export class FixtureAdapter implements EngineAdapter {
  readonly method = 'fixture' as const
  readonly label: string
  readonly termsNote = 'Recorded response replayed offline. Not evidence about a live surface.'

  constructor(
    readonly engine: EngineId,
    private readonly fixtures: FixtureFile,
  ) {
    this.label = `${ENGINE_LABELS[engine] ?? engine} (recorded fixture)`
  }

  configured(): boolean {
    return this.fixtures.engines[this.engine] !== undefined
  }

  configurationHint(): string {
    return `add an "${this.engine}" block to the fixture file`
  }

  async observe(input: ObserveInput): Promise<AdapterResult> {
    const perQuery = this.fixtures.engines[this.engine] ?? {}
    const recorded = perQuery[input.query.text] ?? perQuery['*']
    if (!recorded || recorded.length === 0) {
      return {
        cards: [],
        raw: { source: 'fixture', engine: this.engine, query: input.query.text, status: 'no fixture' },
        error: 'no fixture recorded for this query',
      }
    }

    // Repeats cycle through the recorded takes, so a fixture can encode an
    // unstable surface and the reproducibility maths can be tested against it.
    const take = recorded[input.repeat % recorded.length]
    if (!take) return { cards: [], raw: { source: 'fixture' }, error: 'no fixture take' }

    const raw = { source: 'fixture', engine: this.engine, query: input.query.text, repeat: input.repeat, take }
    if (take.error) return { cards: [], raw, error: take.error }
    return { cards: normaliseCards(take.cards, input.storeDomain), raw }
  }
}
