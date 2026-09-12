import { describe, expect, it } from 'vitest'
import { PALETTE, findCopyViolations, type Finding, type Observation, type Product, type Query, type RunManifest } from '@facings/shared'
import { buildHeadlines, diffObservation } from '@facings/diff'
import { buildReportModel, issueLabel, observationsCsv, findingsCsv, renderReportHtml } from '@facings/audit-cli'

const product: Product = {
  storeId: 's1',
  sku: 'A1',
  title: 'Northfield AM10 Bookshelf Speaker Pair Walnut',
  price: 749,
  currency: 'GBP',
  availability: 'in_stock',
  url: 'https://store.example/products/am10-walnut',
  image: 'https://cdn.store.example/am10.jpg',
  brand: 'Northfield Audio',
  gtin: '5060123456781',
  marginPct: 38,
  attributes: { material: 'Walnut' },
  updatedAt: '2026-09-12T08:00:00.000Z',
}

const queries: Query[] = [
  { id: 'q1', storeId: 's1', text: 'where can I buy Northfield AM10', market: 'UK', language: 'en', source: 'catalogue', volumeProxy: 0.9, expectedSkus: ['A1'] },
  { id: 'q2', storeId: 's1', text: 'best bookshelf speaker under £1000', market: 'UK', language: 'en', source: 'benchmark', volumeProxy: 0.7, expectedSkus: ['A1'] },
]

function observation(queryId: string, engine: Observation['engine'], cards: Observation['cards'], error?: string): Observation {
  const base: Observation = {
    id: `obs_${engine}_${queryId}`,
    storeId: 's1',
    queryId,
    engine,
    method: engine === 'copilot' ? 'consented-panel' : 'api',
    observedAt: '2026-09-12T09:00:00.000Z',
    rawRef: { path: `raw/${engine}__${queryId}__r0.json`, sha256: 'b'.repeat(64), bytes: 120 },
    cards,
    repeat: 0,
  }
  return error ? { ...base, error } : base
}

const correct = {
  position: 1,
  title: 'Northfield AM10 Bookshelf Speaker Pair Walnut',
  brand: 'Northfield Audio',
  price: 749,
  currency: 'GBP',
  availability: 'in_stock' as const,
  url: 'https://store.example/products/am10-walnut',
  image: 'https://cdn.store.example/am10.jpg',
}

const observations = [
  observation('q1', 'openai', [correct]),
  observation('q2', 'openai', [{ ...correct, price: 869 }]),
  observation('q1', 'gemini', []),
  observation('q2', 'gemini', [], 'HTTP 429'),
  observation('q1', 'copilot', [correct]),
  observation('q2', 'copilot', [correct]),
]

const findings: Finding[] = observations.flatMap((obs) => {
  const query = queries.find((q) => q.id === obs.queryId) as Query
  // Copilot failed the floor in this manifest, so its observations are not diffed.
  return obs.engine === 'copilot' ? [] : diffObservation({ query, observation: obs, products: [product] })
})

const manifest: RunManifest = {
  runId: '20260912-090000-abcdef',
  startedAt: '2026-09-12T09:00:00.000Z',
  finishedAt: '2026-09-12T09:05:00.000Z',
  store: { id: 's1', domain: 'store.example', url: 'https://store.example/', platform: 'woocommerce', market: 'UK', language: 'en', connectorStatus: 'manual' },
  harnessVersion: '0.1.0',
  engines: ['openai', 'gemini', 'copilot'],
  repeats: 3,
  productCount: 1,
  queryCount: 2,
  observationCount: 6,
  findingCount: findings.length,
  reproducibility: [
    { engine: 'openai', method: 'api', repeats: 3, rate: 1, observable: true, queriesMeasured: 2, errors: 0 },
    { engine: 'gemini', method: 'api', repeats: 3, rate: 0.9, observable: true, queriesMeasured: 2, errors: 1 },
    { engine: 'copilot', method: 'consented-panel', repeats: 3, rate: 0.31, observable: false, queriesMeasured: 2, errors: 0, note: 'below the 0.8 agreement threshold' },
  ],
  presence: [
    { storeId: 's1', engine: 'openai', state: 'rendering', cardRate: 1, accuracyRate: 0.5, checkedAt: '2026-09-12T09:05:00.000Z' },
    { storeId: 's1', engine: 'gemini', state: 'absent', blocker: 'no product card and no citation of the store in any observed query', cardRate: 0, accuracyRate: 0, checkedAt: '2026-09-12T09:05:00.000Z' },
    { storeId: 's1', engine: 'copilot', state: 'not_observable', blocker: 'below the 0.8 agreement threshold', cardRate: 0, accuracyRate: 0, checkedAt: '2026-09-12T09:05:00.000Z' },
  ],
  fixtureMode: false,
}

const model = buildReportModel({
  manifest,
  queries,
  products: [product],
  observations,
  findings,
  headlines: buildHeadlines(findings, [product], 3),
  notes: ['platform detected as woocommerce at 90% confidence'],
})

describe('buildReportModel', () => {
  it('builds one row per query and one cell per surface', () => {
    expect(model.rows).toHaveLength(2)
    for (const row of model.rows) expect(row.cells).toHaveLength(3)
  })

  it('marks a clean rendering correct and a faulted one wrong', () => {
    expect(model.rows[0]?.cells[0]?.state).toBe('correct')
    expect(model.rows[0]?.cells[0]?.price).toBe('£749')
    expect(model.rows[1]?.cells[0]?.state).toBe('wrong')
    expect(model.rows[1]?.cells[0]?.issue).toBe(issueLabel('price_mismatch'))
  })

  it('marks an empty rendering absent and an errored one an error', () => {
    expect(model.rows[0]?.cells[1]?.state).toBe('absent')
    expect(model.rows[1]?.cells[1]?.state).toBe('error')
  })

  it('shows a surface that failed the floor as not observable even where it rendered cards', () => {
    // Copilot rendered the right card in both observations. It still cannot be
    // reported as correct, because the surface itself was not reproducible.
    expect(model.rows[0]?.cells[2]?.state).toBe('not_observable')
    expect(model.rows[1]?.cells[2]?.state).toBe('not_observable')
  })
})

describe('renderReportHtml', () => {
  const html = renderReportHtml(model)

  it('obeys the copy rules in everything it renders', () => {
    const text = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
    expect(findCopyViolations(text)).toEqual([])
  })

  it('uses only the six brand colours', () => {
    const used = new Set((html.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((hex) => hex.toUpperCase()))
    const allowed = new Set(Object.values(PALETTE).map((hex) => hex.toUpperCase()))
    expect([...used].filter((hex) => !allowed.has(hex))).toEqual([])
  })

  it('has no gradients, shadows or background images', () => {
    expect(html).not.toMatch(/gradient|box-shadow|text-shadow|background-image/i)
  })

  it('names the two brand families', () => {
    expect(html).toContain('Instrument Sans')
    expect(html).toContain('IBM Plex Sans')
  })

  it('prints the positioning line verbatim', () => {
    expect(html).toContain('Show up, and show up correctly, when AI agents shop.')
  })

  it('carries the store, the run id and the harness version, so the report identifies itself', () => {
    expect(html).toContain('store.example')
    expect(html).toContain('20260912-090000-abcdef')
    expect(html).toContain('0.1.0')
  })

  it('prints the method and reproducibility of every surface, including the failed one', () => {
    expect(html).toContain('consented-panel')
    expect(html).toContain('below the 0.8 agreement threshold')
    expect(html).toContain('Copilot')
  })

  it('states the limits of what the report claims', () => {
    expect(html).toContain('does not control any surface')
    expect(html).toContain('not observable, never approximated')
  })

  it('renders the three findings', () => {
    expect(html).toContain('Three findings') // uppercased by CSS, not in the markup
    expect((html.match(/<li>/g) ?? []).length).toBeGreaterThan(0)
  })

  it('warns on the page itself when the run replayed fixtures', () => {
    const fixtureHtml = renderReportHtml({ ...model, manifest: { ...manifest, fixtureMode: true } })
    expect(fixtureHtml).toContain('must not be sent to a merchant')
    expect(html).not.toContain('must not be sent to a merchant')
  })

  it('escapes catalogue and engine text rather than trusting it', () => {
    const hostile = renderReportHtml({
      ...model,
      rows: [{ query: { ...(queries[0] as Query), text: '<script>alert(1)</script>' }, cells: [] }],
    })
    expect(hostile).not.toContain('<script>alert(1)</script>')
    expect(hostile).toContain('&lt;script&gt;')
  })
})

describe('the audit log export', () => {
  const csv = observationsCsv({ manifest, observations, queries, findings, products: [product] })
  const rows = csv.split('\n')
  const header = rows[0]?.split(',') ?? []

  it('carries the method, the timestamp and the evidence hash on every row', () => {
    for (const key of ['method', 'observed_at', 'raw_ref_path', 'raw_ref_sha256']) {
      expect(header).toContain(key)
    }
    expect(rows[1]).toContain('b'.repeat(64))
  })

  it('carries the catalogue state at the moment of observation, not a reference to it', () => {
    for (const key of ['catalogue_price', 'catalogue_availability', 'catalogue_updated_at']) {
      expect(header).toContain(key)
    }
    expect(csv).toContain('2026-09-12T08:00:00.000Z')
  })

  it('writes a row for an observation that rendered nothing, because that is a result', () => {
    const emptyRows = rows.filter((row) => row.includes('gemini') && row.includes(',0,0,'))
    expect(emptyRows.length).toBeGreaterThan(0)
  })

  it('records an errored observation with its error', () => {
    expect(csv).toContain('HTTP 429')
  })

  it('labels each cause as deterministic or inferred', () => {
    expect(header).toContain('cause_inferred')
    expect(csv).toContain('deterministic')
  })

  it('quotes fields containing commas and quotes', () => {
    const withComma = observationsCsv({
      manifest,
      observations: [observation('q1', 'openai', [{ position: 1, title: 'Widget, "large"' }])],
      queries,
      findings: [],
      products: [product],
    })
    expect(withComma).toContain('"Widget, ""large"""')
  })

  it('exports findings with their expected and observed values', () => {
    const csvFindings = findingsCsv(findings)
    expect(csvFindings.split('\n')[0]).toContain('revenue_at_risk')
    expect(csvFindings).toContain('price_mismatch')
    expect(csvFindings).toContain('749')
  })
})
