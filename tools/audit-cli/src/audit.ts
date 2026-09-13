import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type EngineId,
  type Finding,
  type Language,
  type Market,
  type Observation,
  type Presence,
  type Product,
  type Query,
  type RunManifest,
  type Store,
  HARNESS_VERSION,
  MARKET_CURRENCY,
  newRunId,
  stableId,
} from '@showing-up/shared'
import {
  connectorAvailable,
  detectPlatform,
  fetchWooProducts,
  importCsvFile,
  importFeedFile,
  importFeedUrl,
  discoverPublicCatalogue,
} from '@showing-up/connectors'
import { buildQueries } from '@showing-up/benchmark'
import {
  ClaudeAdapter,
  type EngineAdapter,
  EvidenceStore,
  FixtureAdapter,
  GeminiAdapter,
  OpenAiAdapter,
  PanelAdapter,
  PerplexityAdapter,
  loadFixtures,
  loadPanelCaptures,
  representativeObservation,
  runObservations,
  type ProgressEvent,
} from '@showing-up/observe'
import { buildHeadlines, diffObservation, inferCauses, scorePresence } from '@showing-up/diff'
import { buildReportModel } from './report/model.js'
import { renderReportHtml } from './report/html.js'
import { renderPdf } from './report/pdf.js'
import { findingsCsv, observationsCsv } from './report/audit-log.js'

/**
 * Phase 0 audit run. SPEC 11, Phase 0.
 *
 * URL and SKUs in, a one-page report plus a reproducibility number out. The
 * reproducibility number is the point: it decides whether Phase 1 starts.
 */

/** The surfaces observed through a provider API. */
export const API_ENGINES: EngineId[] = ['openai', 'gemini', 'perplexity', 'claude']
/** The surfaces with no product-search API, observable only by consented panel. */
export const PANEL_ENGINES: EngineId[] = ['google-ai-mode', 'copilot']
export const ALL_ENGINES: EngineId[] = [...API_ENGINES, ...PANEL_ENGINES]

export interface AuditOptions {
  url: string
  market: Market
  language: Language
  engines: EngineId[]
  repeats: number
  skuLimit: number
  queryCount: number
  outRoot: string
  /** Ingest sources, in precedence order. */
  csvPath?: string
  feedPath?: string
  feedUrl?: string
  woo?: { consumerKey: string; consumerSecret: string }
  /** Set false to require an explicit catalogue source. Defaults to true. */
  discoverPublic?: boolean
  /** Directory holding consented panel capture files. */
  panelDir?: string
  /** Replay recorded responses instead of calling providers. */
  fixturePath?: string
  seedQueries?: string[]
  /** Run the model cause-inference pass. */
  inferCause: boolean
  priceTolerance?: number
  onProgress?: (event: ProgressEvent) => void
  onStage?: (message: string) => void
}

export interface AuditResult {
  runId: string
  outDir: string
  manifest: RunManifest
  findings: Finding[]
  queries: Query[]
  products: Product[]
  observations: Observation[]
  files: Record<string, string>
  notes: string[]
  reportHtmlPath: string
  pdfWritten: boolean
}

export async function runAudit(options: AuditOptions): Promise<AuditResult> {
  const stage = options.onStage ?? (() => undefined)
  const runId = newRunId()
  const outDir = join(options.outRoot, runId)
  await mkdir(outDir, { recursive: true })

  const notes: string[] = []
  const url = normaliseUrl(options.url)
  const domain = new URL(url).host.replace(/^www\./, '').toLowerCase()
  const storeId = stableId('str', domain, options.market)

  // 1. Platform detection.
  stage(`detecting the platform at ${domain}`)
  const detection = await detectPlatform(url)
  if (detection.error) notes.push(`platform detection could not read the homepage: ${detection.error}`)
  else if (detection.platform === 'unknown') notes.push('the platform could not be identified from the homepage')
  else
    notes.push(
      `platform detected as ${detection.platform} at ${(detection.confidence * 100).toFixed(0)}% confidence, from ${detection.signals
        .map((signal) => signal.pattern)
        .join(', ')}`,
    )

  // 2. Catalogue ingest.
  stage('ingesting the catalogue')
  const ingest = await ingestProducts(storeId, options, notes)
  if (ingest.products.length === 0) {
    throw new Error(
      'no products were ingested. Supply --csv, --feed, --feed-url or WooCommerce credentials, and check the file has sku, title, price and url columns.',
    )
  }

  const store: Store = {
    id: storeId,
    domain,
    url,
    platform: detection.platform,
    market: options.market,
    language: options.language,
    connectorStatus: options.woo ? 'connected' : options.csvPath ? 'manual' : 'feed',
  }
  if (detection.platform !== 'unknown' && !connectorAvailable(detection.platform)) {
    notes.push(`Showing Up has no write connector for ${detection.platform} yet, so fixes would be suggestions only`)
  }

  // 3. Query set.
  stage('building the query set')
  const queries = buildQueries(ingest.products, {
    storeId,
    market: options.market,
    language: options.language,
    count: options.queryCount,
    seedQueries: options.seedQueries ?? [],
  })

  // 4. Adapters.
  const { adapters, fixtureMode, panelWarnings } = await buildAdapters(options, domain)
  notes.push(...panelWarnings)
  if (fixtureMode) notes.push('this run replayed recorded fixtures, so it is not evidence about a live surface')

  // 5. Observation.
  stage(`observing ${adapters.length} surfaces across ${queries.length} queries, ${options.repeats} repeats each`)
  const evidence = new EvidenceStore(outDir)
  const run = await runObservations({
    store,
    queries,
    adapters,
    evidence,
    repeats: options.repeats,
    // The pause between requests is there to stay inside a provider's rate
    // limits. A replay calls no provider, so it runs flat out.
    delayMs: fixtureMode ? 0 : 400,
    onProgress: options.onProgress,
  })

  for (const skip of run.skipped) {
    notes.push(`${skip.engine} was not observed: ${skip.reason}`)
  }

  // 6. One representative observation per query and engine, so a single
  //    unstable repeat cannot drive the report.
  const representative: Observation[] = []
  const engines = [...new Set(run.observations.map((observation) => observation.engine))]
  for (const engine of engines) {
    for (const query of queries) {
      const group = run.observations.filter(
        (observation) => observation.engine === engine && observation.queryId === query.id,
      )
      const pick = representativeObservation(group)
      if (pick) representative.push(pick)
    }
  }

  // 7. Diff.
  stage('diffing the observations against the catalogue')
  const observableEngines = new Set(
    run.reproducibility.filter((entry) => entry.observable).map((entry) => entry.engine),
  )
  let findings: Finding[] = []
  for (const observation of representative) {
    // A surface that failed the reproducibility floor produces no findings:
    // reporting a misrepresentation from an unstable surface would put an
    // unfalsifiable claim in the log. SPEC 4.4.
    if (!observableEngines.has(observation.engine)) continue
    const query = queries.find((candidate) => candidate.id === observation.queryId)
    if (!query) continue
    findings.push(
      ...diffObservation({
        query,
        observation,
        products: ingest.products,
        priceTolerance: options.priceTolerance,
        feedAgeHours: ingest.feedAgeHours,
      }),
    )
  }
  findings.sort((a, b) => b.revenueAtRisk - a.revenueAtRisk)

  // 8. Cause inference, optional and always labelled.
  if (options.inferCause && findings.length > 0) {
    stage('inferring probable causes')
    const inferred = await inferCauses(findings, ingest.products)
    findings = inferred.findings
    if (inferred.skippedReason) notes.push(inferred.skippedReason)
    else notes.push('causes marked "inferred" were produced by a model from the evidence in this run')
  } else {
    notes.push('all causes in this run are deterministic, derived from the catalogue and the observation')
  }

  // 9. Presence.
  const presence: Presence[] = ALL_ENGINES.filter((engine) => options.engines.includes(engine)).map((engine) =>
    scorePresence({
      storeId,
      engine,
      queries,
      observations: representative.filter((observation) => observation.engine === engine),
      findings: findings.filter((finding) => finding.engine === engine),
      products: ingest.products,
      reproducibility: run.reproducibility.find((entry) => entry.engine === engine),
    }),
  )

  // 10. Manifest, report, exports.
  const manifest: RunManifest = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    store,
    harnessVersion: HARNESS_VERSION,
    engines: options.engines,
    repeats: options.repeats,
    productCount: ingest.products.length,
    queryCount: queries.length,
    observationCount: run.observations.length,
    findingCount: findings.length,
    reproducibility: run.reproducibility,
    presence,
    fixtureMode,
  }

  const headlines = buildHeadlines(findings, ingest.products, 3)
  const model = buildReportModel({
    manifest,
    queries,
    products: ingest.products,
    observations: representative,
    findings,
    headlines,
    notes,
  })

  stage('rendering the report')
  const html = renderReportHtml(model)
  const htmlPath = join(outDir, 'report.html')
  await writeFile(htmlPath, html, 'utf8')

  const pdf = await renderPdf(html, join(outDir, 'report.pdf'))
  if (!pdf.written && pdf.reason) notes.push(pdf.reason)

  const files: Record<string, string> = {
    report_html: htmlPath,
    manifest: join(outDir, 'manifest.json'),
    observations: join(outDir, 'observations.json'),
    findings: join(outDir, 'findings.json'),
    queries: join(outDir, 'queries.json'),
    products: join(outDir, 'catalogue-snapshot.json'),
    reproducibility: join(outDir, 'reproducibility.json'),
    audit_log_csv: join(outDir, 'audit-log.csv'),
    findings_csv: join(outDir, 'findings.csv'),
  }
  if (pdf.written) files.report_pdf = pdf.path

  await Promise.all([
    writeFile(files.manifest as string, JSON.stringify(manifest, null, 2), 'utf8'),
    writeFile(files.observations as string, JSON.stringify(run.observations, null, 2), 'utf8'),
    writeFile(files.findings as string, JSON.stringify(findings, null, 2), 'utf8'),
    writeFile(files.queries as string, JSON.stringify(queries, null, 2), 'utf8'),
    writeFile(files.products as string, JSON.stringify(ingest.products, null, 2), 'utf8'),
    writeFile(files.reproducibility as string, JSON.stringify(run.reproducibility, null, 2), 'utf8'),
    writeFile(
      files.audit_log_csv as string,
      observationsCsv({
        manifest,
        observations: run.observations,
        queries,
        findings,
        products: ingest.products,
      }),
      'utf8',
    ),
    writeFile(files.findings_csv as string, findingsCsv(findings), 'utf8'),
  ])

  return {
    runId,
    outDir,
    manifest,
    findings,
    queries,
    products: ingest.products,
    observations: run.observations,
    files,
    notes,
    reportHtmlPath: htmlPath,
    pdfWritten: pdf.written,
  }
}

interface IngestResult {
  products: Product[]
  feedAgeHours?: number
}

async function ingestProducts(storeId: string, options: AuditOptions, notes: string[]): Promise<IngestResult> {
  const currency = MARKET_CURRENCY[options.market] ?? 'GBP'

  if (options.csvPath) {
    const result = await importCsvFile(storeId, options.csvPath, currency)
    notes.push(...result.warnings.map((warning) => `catalogue CSV: ${warning}`))
    return { products: result.products.slice(0, options.skuLimit) }
  }

  if (options.feedPath || options.feedUrl) {
    const result = options.feedPath
      ? await importFeedFile(storeId, options.feedPath, options.skuLimit)
      : await importFeedUrl(storeId, options.feedUrl as string, options.skuLimit)
    notes.push(...result.warnings.map((warning) => `product feed: ${warning}`))
    if (result.feedAgeHours !== undefined) {
      notes.push(`the product feed was built ${Math.round(result.feedAgeHours)} hours ago`)
    }
    const ingest: IngestResult = { products: result.products }
    if (result.feedAgeHours !== undefined) ingest.feedAgeHours = result.feedAgeHours
    return ingest
  }

  if (options.woo) {
    const result = await fetchWooProducts(
      storeId,
      { baseUrl: normaliseUrl(options.url), ...options.woo },
      { limit: options.skuLimit, defaultCurrency: currency },
    )
    notes.push(...result.warnings.map((warning) => `WooCommerce: ${warning}`))
    return { products: result.products }
  }

  // Last resort and the most important one: read what the store already
  // publishes to the public. This is what makes the free audit in SPEC 3.2 a
  // real product rather than a form, because nobody generates an API key for
  // a vendor they have not heard of yet.
  if (options.discoverPublic !== false) {
    const discovered = await discoverPublicCatalogue(normaliseUrl(options.url), { limit: options.skuLimit })
    notes.push(`catalogue discovery: ${discovered.method}, confidence ${discovered.confidence}`)
    notes.push(...discovered.warnings.map((warning) => `catalogue discovery: ${warning}`))
    return { products: discovered.products }
  }

  return { products: [] }
}

async function buildAdapters(
  options: AuditOptions,
  domain: string,
): Promise<{ adapters: EngineAdapter[]; fixtureMode: boolean; panelWarnings: string[] }> {
  const panelWarnings: string[] = []

  if (options.fixturePath) {
    const fixtures = await loadFixtures(options.fixturePath)
    return {
      adapters: options.engines.map((engine) => new FixtureAdapter(engine, fixtures)),
      fixtureMode: true,
      panelWarnings,
    }
  }

  const adapters: EngineAdapter[] = []
  for (const engine of options.engines) {
    switch (engine) {
      case 'openai':
        adapters.push(new OpenAiAdapter())
        break
      case 'gemini':
        adapters.push(new GeminiAdapter())
        break
      case 'perplexity':
        adapters.push(new PerplexityAdapter())
        break
      case 'claude':
        adapters.push(new ClaudeAdapter())
        break
      default:
        break
    }
  }

  const panelEngines = options.engines.filter((engine) => PANEL_ENGINES.includes(engine))
  if (panelEngines.length > 0) {
    const dir = options.panelDir ?? 'panel'
    const { index, warnings } = await loadPanelCaptures(dir, domain)
    panelWarnings.push(...warnings.map((warning) => `panel: ${warning}`))
    for (const engine of panelEngines) adapters.push(new PanelAdapter(engine, index, dir))
  }

  return { adapters, fixtureMode: false, panelWarnings }
}

export function normaliseUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`
  const url = new URL(withScheme)
  url.hash = ''
  return url.toString().replace(/\/$/, '') + '/'
}
