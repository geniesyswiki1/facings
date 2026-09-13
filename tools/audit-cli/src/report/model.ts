import type {
  EngineId,
  EngineReproducibility,
  Finding,
  Observation,
  Presence,
  Product,
  Query,
  RunManifest,
} from '@showing-up/shared'
import { matchCards } from '@showing-up/diff'
import type { Headline } from '@showing-up/diff'

/**
 * The report view model.
 *
 * Built once and rendered to HTML and to the CSV log from the same object, so
 * the PDF a merchant reads and the export a regulator reads cannot disagree.
 */

export type CellState = 'correct' | 'wrong' | 'absent' | 'not_observable' | 'error'

export interface GridCell {
  engine: EngineId
  state: CellState
  /** Product title the engine rendered, when it rendered one of ours. */
  title?: string
  price?: string
  /** Short label for the worst finding on this cell. */
  issue?: string
  position?: number
}

export interface GridRow {
  query: Query
  cells: GridCell[]
}

export interface ReportModel {
  manifest: RunManifest
  engines: EngineId[]
  rows: GridRow[]
  headlines: Headline[]
  presence: Presence[]
  reproducibility: EngineReproducibility[]
  findings: Finding[]
  products: Product[]
  /** Notes printed in the footer: fixture mode, skipped engines, cause pass. */
  notes: string[]
  generatedAt: string
}

const ISSUE_LABELS: Record<Finding['type'], string> = {
  bestseller_absent: 'absent',
  price_mismatch: 'wrong price',
  availability_stale: 'wrong stock',
  discontinued_recommended: 'discontinued',
  competitor_substituted: 'competitor',
  wrong_variant: 'wrong variant',
  broken_image: 'wrong image',
  landing_url_wrong: 'wrong link',
  unverified_rating: 'unverified rating',
  identity_ambiguous: 'no SKU match',
}

export function issueLabel(type: Finding['type']): string {
  return ISSUE_LABELS[type]
}

export interface BuildModelInput {
  manifest: RunManifest
  queries: Query[]
  products: Product[]
  /** One representative observation per query and engine. */
  observations: Observation[]
  findings: Finding[]
  headlines: Headline[]
  notes: string[]
}

export function buildReportModel(input: BuildModelInput): ReportModel {
  const { manifest, queries, products, observations, findings, headlines, notes } = input
  const engines = manifest.engines

  const notObservable = new Set(
    manifest.reproducibility.filter((entry) => !entry.observable).map((entry) => entry.engine),
  )

  const observationIndex = new Map<string, Observation>()
  for (const observation of observations) {
    observationIndex.set(`${observation.engine}::${observation.queryId}`, observation)
  }

  const findingIndex = new Map<string, Finding[]>()
  for (const finding of findings) {
    const key = `${finding.engine}::${finding.queryId}`
    const list = findingIndex.get(key) ?? []
    list.push(finding)
    findingIndex.set(key, list)
  }

  const rows: GridRow[] = queries.map((query) => ({
    query,
    cells: engines.map((engine) => {
      const key = `${engine}::${query.id}`
      if (notObservable.has(engine)) return { engine, state: 'not_observable' as CellState }

      const observation = observationIndex.get(key)
      if (!observation) return { engine, state: 'not_observable' as CellState }
      if (observation.error) return { engine, state: 'error' as CellState, issue: observation.error }

      const cards = matchCards(observation.cards, products)
      const own = cards.filter((card) => card.matchedSku !== undefined)
      const cellFindings = (findingIndex.get(key) ?? []).filter((finding) => finding.type !== 'bestseller_absent')

      if (own.length === 0) {
        const substituted = (findingIndex.get(key) ?? []).some((f) => f.type === 'competitor_substituted')
        const cell: GridCell = { engine, state: 'absent' }
        if (substituted) cell.issue = 'competitor'
        return cell
      }

      const card = own[0]
      const cell: GridCell = {
        engine,
        state: cellFindings.length > 0 ? 'wrong' : 'correct',
        position: card?.position,
      }
      if (card?.title) cell.title = card.title
      if (card?.price !== undefined) cell.price = formatCellPrice(card.price, card.currency)
      const worst = cellFindings[0]
      if (worst) cell.issue = ISSUE_LABELS[worst.type]
      return cell
    }),
  }))

  return {
    manifest,
    engines,
    rows,
    headlines,
    presence: manifest.presence,
    reproducibility: manifest.reproducibility,
    findings,
    products,
    notes,
    generatedAt: new Date().toISOString(),
  }
}

function formatCellPrice(amount: number, currency: string | undefined): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£'
  return `${symbol}${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`
}
