#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Command, InvalidArgumentError } from 'commander'
import {
  ENGINE_LABELS,
  HARNESS_VERSION,
  REPRODUCIBILITY_THRESHOLD,
  type EngineId,
  type Language,
  type Market,
} from '@facings/shared'
import { detectPlatform } from '@facings/connectors'
import { buildQueries } from '@facings/benchmark'
import { panelCaptureTemplate, panelInstructionSheet } from '@facings/observe'
import { importCsvFile, importFeedFile, importFeedUrl } from '@facings/connectors'
import { ALL_ENGINES, API_ENGINES, PANEL_ENGINES, normaliseUrl, runAudit } from './audit.js'
import { ALL_DEFECTS, type DefectKind, makeFixtures } from './make-fixtures.js'

/**
 * facings-audit: the Phase 0 validation instrument.
 *
 * Deliberately a CLI and a PDF rather than a product. Its job is to answer one
 * question, whether these surfaces can be observed compliantly and repeatably,
 * and to put a real result in front of ten merchants. SPEC 0 and SPEC 11.
 */

const program = new Command()

program
  .name('facings-audit')
  .description('Facings Phase 0 audit harness. Store URL and SKUs in, accuracy report out.')
  .version(HARNESS_VERSION)

program
  .command('run', { isDefault: true })
  .description('run an audit and write the report, the audit log and the reproducibility result')
  .requiredOption('-u, --url <url>', 'store URL')
  .option('--csv <path>', 'catalogue CSV, columns sku, title, price, url and optionally currency, availability, image, brand, gtin, mpn')
  .option('--feed <path>', 'Google Merchant Center XML feed file')
  .option('--feed-url <url>', 'Google Merchant Center XML feed URL')
  .option('--woo-key <key>', 'WooCommerce read-scope consumer key')
  .option('--woo-secret <secret>', 'WooCommerce consumer secret')
  .option('-m, --market <market>', 'market: UK, DE, FR, NL, ES or IT', 'UK')
  .option('-l, --language <language>', 'language: en, de, fr, nl, es or it')
  .option('-e, --engines <list>', `comma separated surfaces, or "api", "panel", "all". Available: ${ALL_ENGINES.join(', ')}`, 'api')
  .option('-r, --repeats <n>', 'repeats per query per surface, two or more to measure reproducibility', parseCount, 3)
  .option('-n, --skus <n>', 'SKUs to audit', parseCount, 20)
  .option('-q, --queries <n>', 'queries to build', parseCount, 20)
  .option('--seed-queries <list>', 'comma separated queries to use before generated ones')
  .option('--panel-dir <path>', 'directory holding consented panel capture files', 'panel')
  .option('--fixtures <path>', 'replay recorded responses instead of calling providers')
  .option('--out <path>', 'output root', 'runs')
  .option('--infer-cause', 'run the model cause-inference pass, labelled as inferred', false)
  .option('--price-tolerance <n>', 'tolerated relative price difference, for example 0.01', parseRatio, 0.01)
  .action(async (options) => {
    const market = parseMarket(options.market)
    const language = (options.language ?? defaultLanguage(market)) as Language
    const engines = parseEngines(options.engines)

    if (options.repeats < 2) {
      console.log(
        `note: reproducibility needs at least two repeats. With --repeats ${options.repeats} the run will report it as not measured, and no surface can pass the ${REPRODUCIBILITY_THRESHOLD} threshold.`,
      )
    }

    const auditOptions = {
      url: options.url as string,
      market,
      language,
      engines,
      repeats: options.repeats as number,
      skuLimit: options.skus as number,
      queryCount: options.queries as number,
      outRoot: options.out as string,
      panelDir: options.panelDir as string,
      inferCause: Boolean(options.inferCause),
      priceTolerance: options.priceTolerance as number,
      onStage: (message: string) => console.log(`> ${message}`),
      // Redrawn in place on a terminal, and every tenth observation when the
      // output is piped to a file or a log, so a CI transcript stays readable.
      onProgress: (event: { engine: EngineId; done: number; total: number; error?: string }) => {
        const percent = event.total ? Math.round((event.done / event.total) * 100) : 0
        const suffix = event.error ? ` (${event.error})` : ''
        if (process.stdout.isTTY) {
          process.stdout.write(
            `\r  ${String(percent).padStart(3)}%  ${event.done}/${event.total} observations${suffix}${' '.repeat(12)}`,
          )
        } else if (event.done === event.total || event.done % 25 === 0 || event.error) {
          console.log(`  ${String(percent).padStart(3)}%  ${event.done}/${event.total} observations${suffix}`)
        }
      },
    } as Parameters<typeof runAudit>[0]

    if (options.csv) auditOptions.csvPath = options.csv
    if (options.feed) auditOptions.feedPath = options.feed
    if (options.feedUrl) auditOptions.feedUrl = options.feedUrl
    if (options.wooKey && options.wooSecret) {
      auditOptions.woo = { consumerKey: options.wooKey, consumerSecret: options.wooSecret }
    }
    if (options.fixtures) auditOptions.fixturePath = options.fixtures
    if (options.seedQueries) {
      auditOptions.seedQueries = String(options.seedQueries)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    }

    try {
      const result = await runAudit(auditOptions)
      if (process.stdout.isTTY) process.stdout.write('\n')
      printSummary(result)
    } catch (error) {
      if (process.stdout.isTTY) process.stdout.write('\n')
      console.error(`the audit stopped: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  })

program
  .command('detect')
  .description('detect the e-commerce platform behind a store URL')
  .requiredOption('-u, --url <url>', 'store URL')
  .action(async (options) => {
    const result = await detectPlatform(normaliseUrl(options.url))
    if (result.error) {
      console.error(`could not read the homepage: ${result.error}`)
      process.exitCode = 1
      return
    }
    console.log(`platform: ${result.platform}`)
    console.log(`confidence: ${(result.confidence * 100).toFixed(0)}%`)
    for (const signal of result.signals) console.log(`  signal: ${signal.pattern} (${signal.weight})`)
  })

program
  .command('panel')
  .description('generate the consented panel session sheet and capture templates for the surfaces with no API')
  .requiredOption('-u, --url <url>', 'store URL')
  .option('--csv <path>', 'catalogue CSV')
  .option('--feed <path>', 'Merchant Center XML feed file')
  .option('--feed-url <url>', 'Merchant Center XML feed URL')
  .option('-m, --market <market>', 'market', 'UK')
  .option('-l, --language <language>', 'language')
  .option('-e, --engines <list>', 'panel surfaces', PANEL_ENGINES.join(','))
  .option('-r, --repeats <n>', 'repeats per query', parseCount, 3)
  .option('-n, --skus <n>', 'SKUs', parseCount, 20)
  .option('-q, --queries <n>', 'queries', parseCount, 20)
  .option('--out <path>', 'output directory', 'panel')
  .action(async (options) => {
    const market = parseMarket(options.market)
    const language = (options.language ?? defaultLanguage(market)) as Language
    const url = normaliseUrl(options.url)
    const domain = new URL(url).host.replace(/^www\./, '')
    const storeId = `panel-${domain}`

    const products = await loadProductsForPanel(storeId, options)
    if (products.length === 0) {
      console.error('no catalogue supplied. Pass --csv, --feed or --feed-url so the sheet lists the real queries.')
      process.exitCode = 1
      return
    }

    const queries = buildQueries(products, {
      storeId,
      market,
      language,
      count: options.queries as number,
    })

    await mkdir(options.out, { recursive: true })
    const sheet = panelInstructionSheet({
      storeDomain: domain,
      market,
      language,
      engines: parseEngines(options.engines),
      repeats: options.repeats as number,
      queries: queries.map((query) => ({ id: query.id, text: query.text })),
    })
    const sheetPath = join(options.out, 'session-sheet.md')
    await writeFile(sheetPath, sheet, 'utf8')
    console.log(`wrote ${sheetPath}`)

    for (const engine of parseEngines(options.engines)) {
      const template = panelCaptureTemplate({
        engine,
        market,
        language,
        repeats: options.repeats as number,
        queries: queries.map((query) => ({ id: query.id, text: query.text })),
      })
      const path = join(options.out, `capture-${engine}.template.json`)
      await writeFile(path, JSON.stringify(template, null, 2), 'utf8')
      console.log(`wrote ${path}`)
    }

    console.log('')
    console.log('Panel members fill in a copy of each template, drop it in this directory without the')
    console.log('".template" suffix, then the audit is run again with the same panel directory.')
  })

program
  .command('fixtures')
  .description('build a replay fixture from a catalogue, with defects seeded on purpose, for offline checks')
  .requiredOption('-u, --url <url>', 'store URL, used for the query set')
  .option('--csv <path>', 'catalogue CSV')
  .option('--feed <path>', 'Merchant Center XML feed file')
  .option('-m, --market <market>', 'market', 'UK')
  .option('-l, --language <language>', 'language')
  .option('-e, --engines <list>', 'surfaces to record', 'all')
  .option('-r, --repeats <n>', 'takes per query', parseCount, 3)
  .option('-q, --queries <n>', 'queries', parseCount, 20)
  .option('-n, --skus <n>', 'SKUs', parseCount, 20)
  .option('--defects <list>', `comma separated defects to seed. Available: ${ALL_DEFECTS.join(', ')}`, ALL_DEFECTS.join(','))
  .option('--defect-rate <n>', 'share of queries carrying a defect', parseRatio, 0.45)
  .option('--unstable <list>', 'surfaces that return a different card set on each take, to exercise the not-observable path', 'copilot')
  .option('--out <path>', 'fixture file to write', 'fixtures/demo-observations.json')
  .action(async (options) => {
    const market = parseMarket(options.market)
    const language = (options.language ?? defaultLanguage(market)) as Language
    const url = normaliseUrl(options.url)
    const storeId = `fixture-${new URL(url).host.replace(/^www\./, '')}`

    const products = (await loadProductsForPanel(storeId, options)).slice(0, options.skus as number)
    if (products.length === 0) {
      console.error('no catalogue supplied. Pass --csv or --feed.')
      process.exitCode = 1
      return
    }

    const queries = buildQueries(products, { storeId, market, language, count: options.queries as number })
    const unstable = String(options.unstable ?? '')
      .split(',')
      .map((entry: string) => entry.trim())
      .filter(Boolean)
      .filter((entry: string) => ALL_ENGINES.includes(entry as EngineId)) as EngineId[]

    const fixture = makeFixtures({
      products,
      queries,
      engines: parseEngines(options.engines),
      repeats: options.repeats as number,
      defects: String(options.defects)
        .split(',')
        .map((entry: string) => entry.trim())
        .filter((entry: string): entry is DefectKind => (ALL_DEFECTS as string[]).includes(entry)),
      unstable,
      defectRate: options.defectRate as number,
    })

    await mkdir(dirname(options.out), { recursive: true })
    await writeFile(options.out, JSON.stringify(fixture, null, 2), 'utf8')
    console.log(`wrote ${options.out}`)
    console.log(`${queries.length} queries, ${options.repeats} takes each, ${parseEngines(options.engines).length} surfaces`)
    if (unstable.length) console.log(`unstable surfaces: ${unstable.join(', ')}`)
  })

program.parseAsync(process.argv)

function printSummary(result: Awaited<ReturnType<typeof runAudit>>): void {
  const { manifest } = result
  console.log('')
  console.log(`run ${manifest.runId}, ${manifest.store.domain}, ${manifest.store.market}`)
  console.log(
    `${manifest.productCount} SKUs, ${manifest.queryCount} queries, ${manifest.observationCount} observations, ${manifest.findingCount} findings`,
  )
  console.log('')
  console.log('reproducibility per surface, the number that decides Phase 1:')
  for (const entry of manifest.reproducibility) {
    const label = ENGINE_LABELS[entry.engine] ?? entry.engine
    const rate = entry.queriesMeasured ? `${(entry.rate * 100).toFixed(0)}%` : 'not measured'
    const verdict = entry.observable ? 'observable' : 'not observable'
    console.log(
      `  ${label.padEnd(18)} ${entry.method.padEnd(16)} ${rate.padStart(12)}  ${verdict}${entry.note ? `, ${entry.note}` : ''}`,
    )
  }

  console.log('')
  console.log('presence:')
  for (const presence of manifest.presence) {
    const label = ENGINE_LABELS[presence.engine] ?? presence.engine
    console.log(
      `  ${label.padEnd(18)} ${presence.state.padEnd(15)} card rate ${(presence.cardRate * 100).toFixed(0)}%, correct ${(
        presence.accuracyRate * 100
      ).toFixed(0)}%${presence.blocker ? `, ${presence.blocker}` : ''}`,
    )
  }

  if (result.findings.length) {
    console.log('')
    console.log('top findings:')
    for (const finding of result.findings.slice(0, 5)) {
      console.log(
        `  ${finding.severity.padEnd(9)} ${finding.type.padEnd(26)} ${finding.sku ?? '-'}  ${finding.queryText}`,
      )
    }
  }

  console.log('')
  for (const [name, path] of Object.entries(result.files)) console.log(`  ${name.padEnd(16)} ${path}`)
  if (!result.pdfWritten) console.log('\nthe PDF was not rendered, the HTML report holds the same content')
}

async function loadProductsForPanel(storeId: string, options: Record<string, string>) {
  if (options.csv) return (await importCsvFile(storeId, options.csv)).products
  if (options.feed) return (await importFeedFile(storeId, options.feed)).products
  if (options.feedUrl) return (await importFeedUrl(storeId, options.feedUrl)).products
  return []
}

function parseEngines(raw: string): EngineId[] {
  const value = raw.trim().toLowerCase()
  if (value === 'all') return ALL_ENGINES
  if (value === 'api') return API_ENGINES
  if (value === 'panel') return PANEL_ENGINES

  const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
  const engines: EngineId[] = []
  for (const part of parts) {
    if (!ALL_ENGINES.includes(part as EngineId)) {
      throw new InvalidArgumentError(`unknown surface "${part}". Available: ${ALL_ENGINES.join(', ')}`)
    }
    engines.push(part as EngineId)
  }
  if (engines.length === 0) throw new InvalidArgumentError('no surfaces selected')
  return engines
}

function parseMarket(raw: string): Market {
  const value = raw.trim().toUpperCase()
  const markets: Market[] = ['UK', 'DE', 'FR', 'NL', 'ES', 'IT']
  if (!markets.includes(value as Market)) {
    throw new InvalidArgumentError(`unknown market "${raw}". Available: ${markets.join(', ')}`)
  }
  return value as Market
}

function defaultLanguage(market: Market): Language {
  const map: Record<Market, Language> = { UK: 'en', DE: 'de', FR: 'fr', NL: 'nl', ES: 'es', IT: 'it' }
  return map[market]
}

function parseCount(raw: string): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 1) throw new InvalidArgumentError('expected a positive whole number')
  return value
}

function parseRatio(raw: string): number {
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new InvalidArgumentError('expected a number between 0 and 1')
  return value
}
