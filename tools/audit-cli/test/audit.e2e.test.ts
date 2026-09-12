import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { importCsvText } from '@facings/connectors'
import { buildQueries } from '@facings/benchmark'
import { sha256 } from '@facings/shared'
import { type AuditResult, makeFixtures, normaliseUrl, runAudit } from '@facings/audit-cli'

/**
 * The whole harness, end to end, on recorded responses: URL and SKUs in, a
 * one-page report plus a reproducibility number out. This is the check SPEC 11
 * Phase 0 asks for, run on every commit instead of only against a live
 * provider, so a regression in the pipeline shows up before a merchant sees it.
 */

const STORE_URL = 'https://northfieldaudio.example'
const CATALOGUE = new URL('../../../fixtures/demo-catalogue.csv', import.meta.url).pathname

let result: AuditResult
let outRoot: string

beforeAll(async () => {
  outRoot = await mkdtemp(join(tmpdir(), 'facings-e2e-'))
  const csv = await readFile(CATALOGUE, 'utf8')
  const { products } = importCsvText('fixture-store', csv)
  const queries = buildQueries(products, { storeId: 'fixture-store', market: 'UK', language: 'en', count: 20 })

  const fixtures = makeFixtures({
    products,
    queries,
    engines: ['openai', 'gemini', 'perplexity', 'claude', 'google-ai-mode', 'copilot'],
    repeats: 3,
    defects: ['price', 'discontinued', 'absent', 'competitor', 'variant', 'availability'],
    unstable: ['copilot'],
  })
  const fixturePath = join(outRoot, 'fixtures.json')
  await writeFile(fixturePath, JSON.stringify(fixtures), 'utf8')

  result = await runAudit({
    url: STORE_URL,
    market: 'UK',
    language: 'en',
    engines: ['openai', 'gemini', 'perplexity', 'claude', 'google-ai-mode', 'copilot'],
    repeats: 3,
    skuLimit: 20,
    queryCount: 20,
    outRoot,
    csvPath: CATALOGUE,
    fixturePath,
    inferCause: false,
  })
}, 120_000)

describe('a Phase 0 run', () => {
  it('ingests the catalogue and builds the query set', () => {
    expect(result.products).toHaveLength(20)
    expect(result.queries).toHaveLength(20)
  })

  it('observes every surface for every query and repeat', () => {
    expect(result.manifest.observationCount).toBe(6 * 20 * 3)
  })

  it('reports reproducibility per surface, which is the point of Phase 0', () => {
    expect(result.manifest.reproducibility).toHaveLength(6)
    const stable = result.manifest.reproducibility.find((entry) => entry.engine === 'openai')
    const unstable = result.manifest.reproducibility.find((entry) => entry.engine === 'copilot')
    expect(stable?.observable).toBe(true)
    expect(stable?.rate).toBe(1)
    expect(unstable?.observable).toBe(false)
    expect(unstable?.rate).toBeLessThan(0.8)
  })

  it('raises no findings on the surface that failed the floor', () => {
    expect(result.findings.filter((finding) => finding.engine === 'copilot')).toEqual([])
  })

  it('detects the seeded defects', () => {
    const types = new Set(result.findings.map((finding) => finding.type))
    expect(types.has('price_mismatch')).toBe(true)
    expect(types.has('bestseller_absent')).toBe(true)
    expect([...types].some((type) => type === 'wrong_variant' || type === 'availability_stale')).toBe(true)
  })

  it('ties every finding to a SKU or states it is a substitution, and to its observation', () => {
    const observationIds = new Set(result.observations.map((observation) => observation.id))
    for (const finding of result.findings) {
      expect(observationIds.has(finding.observationId)).toBe(true)
      if (finding.type !== 'competitor_substituted' && finding.type !== 'identity_ambiguous') {
        expect(finding.sku).toBeTruthy()
      }
    }
  })

  it('ranks findings by revenue at risk', () => {
    const risks = result.findings.map((finding) => finding.revenueAtRisk)
    expect([...risks].sort((a, b) => b - a)).toEqual(risks)
  })

  it('marks the run as fixture mode so it cannot be mistaken for evidence', () => {
    expect(result.manifest.fixtureMode).toBe(true)
    expect(result.notes.some((note) => note.includes('not evidence about a live surface'))).toBe(true)
  })

  it('records that platform detection could not reach the invalid demo domain', () => {
    expect(result.manifest.store.platform).toBe('unknown')
    expect(result.notes.some((note) => note.includes('platform detection could not read the homepage'))).toBe(true)
  })

  it('scores presence for every requested surface', () => {
    expect(result.manifest.presence).toHaveLength(6)
    expect(result.manifest.presence.find((p) => p.engine === 'copilot')?.state).toBe('not_observable')
  })
})

describe('the run output', () => {
  it('writes the report, the log and the machine readable record', async () => {
    const files = await readdir(result.outDir)
    for (const expected of [
      'report.html',
      'report.pdf',
      'manifest.json',
      'observations.json',
      'findings.json',
      'queries.json',
      'catalogue-snapshot.json',
      'reproducibility.json',
      'audit-log.csv',
      'findings.csv',
      'raw',
    ]) {
      expect(files).toContain(expected)
    }
  })

  it('renders the PDF on one page', async () => {
    const pdf = await readFile(join(result.outDir, 'report.pdf'), 'latin1')
    expect(pdf.startsWith('%PDF')).toBe(true)
    expect(pdf).toMatch(/\/Count 1\b/)
  })

  it('stores raw evidence for every observation, with a hash that verifies', async () => {
    const raw = await readdir(join(result.outDir, 'raw'))
    expect(raw).toHaveLength(result.manifest.observationCount)

    for (const observation of result.observations.slice(0, 10)) {
      const body = await readFile(join(result.outDir, observation.rawRef.path), 'utf8')
      expect(sha256(body)).toBe(observation.rawRef.sha256)
    }
  })

  it('writes an audit log row for every card of every observation', async () => {
    const csv = await readFile(join(result.outDir, 'audit-log.csv'), 'utf8')
    const rows = csv.trim().split('\n')
    const cardCount = result.observations.reduce(
      (sum, observation) => sum + Math.max(1, observation.cards.length),
      0,
    )
    expect(rows).toHaveLength(cardCount + 1)
    expect(rows[0]).toContain('raw_ref_sha256')
  })

  it('links each audit log row to evidence on disk', async () => {
    const csv = await readFile(join(result.outDir, 'audit-log.csv'), 'utf8')
    const raw = new Set(await readdir(join(result.outDir, 'raw')))
    const paths = new Set(
      csv
        .trim()
        .split('\n')
        .slice(1)
        .map((row) => row.split(',').at(-3) ?? ''),
    )
    expect(paths.size).toBeGreaterThan(0)
    for (const path of paths) expect(raw.has(path.replace('raw/', ''))).toBe(true)
  })

  it('carries the catalogue state on the rows where a SKU was matched', async () => {
    const csv = await readFile(join(result.outDir, 'audit-log.csv'), 'utf8')
    const header = (csv.split('\n')[0] ?? '').split(',')
    const skuColumn = header.indexOf('matched_sku')
    const cataloguePriceColumn = header.indexOf('catalogue_price')
    const matched = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((row) => row.split(','))
      .filter((row) => (row[skuColumn] ?? '').startsWith('NFA-'))

    expect(matched.length).toBeGreaterThan(0)
    for (const row of matched.slice(0, 20)) expect(Number(row[cataloguePriceColumn])).toBeGreaterThan(0)
  })
})

describe('runAudit input handling', () => {
  it('refuses to run without a catalogue, and says how to supply one', async () => {
    await expect(
      runAudit({
        url: STORE_URL,
        market: 'UK',
        language: 'en',
        engines: ['openai'],
        repeats: 2,
        skuLimit: 20,
        queryCount: 20,
        outRoot,
        inferCause: false,
      }),
    ).rejects.toThrow(/--csv, --feed, --feed-url or WooCommerce credentials/)
  })
})

describe('normaliseUrl', () => {
  it('adds a scheme, drops a fragment and normalises the trailing slash', () => {
    expect(normaliseUrl('store.example')).toBe('https://store.example/')
    expect(normaliseUrl('https://store.example/shop#top')).toBe('https://store.example/shop/')
  })
})
