import type { Card, Finding, Observation, Product, Query, RunManifest } from '@showing-up/shared'
import { enforceDashRule } from '@showing-up/shared'
import { matchCards } from '@showing-up/diff'

/**
 * The audit log export.
 *
 * SPEC 3.1 job 2: every observation stored with timestamp, engine, method, raw
 * response reference and the catalogue state at that moment, exportable as CSV.
 * The catalogue state is written onto each row rather than referenced, because
 * a row that says "the price was £129 at 08:14 and the surface said £149" is
 * the artefact; a row that points at a catalogue that has since changed is not.
 */

export function observationsCsv(params: {
  manifest: RunManifest
  observations: Observation[]
  queries: Query[]
  findings: Finding[]
  products: Product[]
}): string {
  const queryById = new Map(params.queries.map((query) => [query.id, query]))
  const productBySku = new Map(params.products.map((product) => [product.sku, product]))
  const findingsByObservation = new Map<string, Finding[]>()
  for (const finding of params.findings) {
    const list = findingsByObservation.get(finding.observationId) ?? []
    list.push(finding)
    findingsByObservation.set(finding.observationId, list)
  }

  const header = [
    'run_id',
    'observation_id',
    'observed_at',
    'engine',
    'method',
    'repeat',
    'query',
    'query_source',
    'market',
    'language',
    'cards_returned',
    'own_cards',
    'card_position',
    'card_title',
    'card_price',
    'card_currency',
    'card_availability',
    'card_url',
    'matched_sku',
    'match_confidence',
    'catalogue_title',
    'catalogue_price',
    'catalogue_currency',
    'catalogue_availability',
    'catalogue_updated_at',
    'finding_types',
    'finding_severities',
    'cause',
    'cause_inferred',
    'raw_ref_path',
    'raw_ref_sha256',
    'observation_error',
  ]

  const rows: string[][] = [header]

  for (const observation of params.observations) {
    const query = queryById.get(observation.queryId)
    const findings = findingsByObservation.get(observation.id) ?? []
    // The stored observation holds the cards as the surface rendered them, with
    // no SKU attached. Identity is resolved here rather than read back from the
    // diff, so that every observation in the log carries its SKU and its
    // catalogue state, including the repeats the report did not use.
    const cards: Card[] = matchCards(observation.cards, params.products)
    const ownCards = cards.filter((card) => card.matchedSku !== undefined).length

    const base = [
      params.manifest.runId,
      observation.id,
      observation.observedAt,
      observation.engine,
      observation.method,
      String(observation.repeat),
      query?.text ?? '',
      query?.source ?? '',
      query?.market ?? params.manifest.store.market,
      query?.language ?? params.manifest.store.language,
      String(cards.length),
      String(ownCards),
    ]

    // One row per card keeps the log joinable on SKU. An observation with no
    // cards still gets a row: "the surface rendered nothing" is a result.
    if (cards.length === 0) {
      rows.push([
        ...base,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        findings.map((f) => f.type).join(' '),
        findings.map((f) => f.severity).join(' '),
        findings.map((f) => f.cause).join(' | '),
        findings.some((f) => f.causeInferred) ? 'inferred' : 'deterministic',
        observation.rawRef.path,
        observation.rawRef.sha256,
        observation.error ?? '',
      ])
      continue
    }

    for (const card of cards) {
      const product = card.matchedSku ? productBySku.get(card.matchedSku) : undefined
      const cardFindings = findings.filter((finding) => finding.sku === (card.matchedSku ?? null))
      rows.push([
        ...base,
        String(card.position),
        card.title,
        card.price === undefined ? '' : String(card.price),
        card.currency ?? '',
        card.availability ?? '',
        card.url ?? '',
        card.matchedSku ?? '',
        card.matchConfidence === undefined ? '' : String(card.matchConfidence),
        product?.title ?? '',
        product ? String(product.price) : '',
        product?.currency ?? '',
        product?.availability ?? '',
        product?.updatedAt ?? '',
        cardFindings.map((f) => f.type).join(' '),
        cardFindings.map((f) => f.severity).join(' '),
        cardFindings.map((f) => f.cause).join(' | '),
        cardFindings.some((f) => f.causeInferred) ? 'inferred' : 'deterministic',
        observation.rawRef.path,
        observation.rawRef.sha256,
        observation.error ?? '',
      ])
    }
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function findingsCsv(findings: Finding[]): string {
  const header = [
    'finding_id',
    'observation_id',
    'engine',
    'query',
    'sku',
    'type',
    'severity',
    'revenue_at_risk',
    'expected',
    'observed',
    'cause',
    'cause_inferred',
  ]
  const rows = findings.map((finding) => [
    finding.id,
    finding.observationId,
    finding.engine,
    finding.queryText,
    finding.sku ?? '',
    finding.type,
    finding.severity,
    String(finding.revenueAtRisk),
    JSON.stringify(finding.expected),
    JSON.stringify(finding.observed),
    finding.cause,
    finding.causeInferred ? 'inferred' : 'deterministic',
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

function csvCell(value: string): string {
  const clean = enforceDashRule(value ?? '').replace(/\r?\n/g, ' ')
  if (/[",]/.test(clean)) return `"${clean.replace(/"/g, '""')}"`
  return clean
}
