/**
 * Core types for the Showing Up Phase 0 audit harness.
 *
 * These mirror the data model in SPEC.md section 4.3. Phase 0 keeps them in
 * memory and on disk; Phase 2 persists the same shapes to Postgres, so field
 * names are chosen to match the table columns rather than to read nicely here.
 */

/** Engines observed in Phase 0. SPEC 4.4. */
export type EngineId =
  | 'openai'
  | 'gemini'
  | 'google-ai-mode'
  | 'copilot'
  | 'perplexity'
  | 'claude'

/** Every engine, in the order screens and reports list them. */
export const ALL_ENGINES: EngineId[] = ['openai', 'gemini', 'google-ai-mode', 'copilot', 'perplexity', 'claude']

/**
 * How an observation was made. Recorded on every stored result, without
 * exception: the audit log is only defensible if the method travels with the
 * finding. SPEC 4.4.
 */
export type ObservationMethod =
  /** Official provider API, automated, within the provider's terms. */
  | 'api'
  /** Human-initiated session run by a consented panel member. */
  | 'consented-panel'
  /** Merchant Center style eligibility diagnostics. */
  | 'diagnostics'
  /** Recorded fixture, replayed. Never valid evidence for a merchant report. */
  | 'fixture'

// Markets, regions, locales and languages live in markets.js, which is the
// single source of truth for what each one implies about currency, tax
// presentation and statutory returns. Imported for use below and re-exported
// so existing imports of Market and Language keep working.
import type { Language, Market } from './markets.js'

export type { Language, Locale, Market, MarketProfile, Region, TaxMode } from './markets.js'

export type Platform =
  | 'woocommerce'
  | 'adobe-commerce'
  | 'prestashop'
  | 'bigcommerce'
  | 'wix'
  | 'shopware'
  | 'shopify'
  | 'unknown'

export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued' | 'unknown'

export interface Store {
  id: string
  domain: string
  url: string
  platform: Platform
  market: Market
  language: Language
  /** Payment service provider, when known. Drives the Stripe hand-off in Phase 1. */
  psp?: string
  connectorStatus: 'connected' | 'manual' | 'feed' | 'none'
}

export interface Product {
  storeId: string
  sku: string
  title: string
  price: number
  currency: string
  availability: Availability
  url: string
  image?: string
  brand?: string
  gtin?: string
  mpn?: string
  /** Free-form catalogue attributes. Completeness feeds cause inference. */
  attributes: Record<string, string>
  /** Merchant-supplied margin, used for the revenue-at-risk proxy. */
  marginPct?: number
  updatedAt: string
}

export interface Query {
  id: string
  storeId: string
  text: string
  market: Market
  language: Language
  source: 'catalogue' | 'benchmark' | 'manual' | 'search-console'
  /** Relative demand proxy, 0 to 1. Phase 0 has no volume data, so this is a heuristic. */
  volumeProxy: number
  /** SKUs the merchant expects to see for this query. */
  expectedSkus: string[]
  /** Category label from the benchmark library, used for query dedupe in Phase 2. */
  category?: string
  /**
   * True when this query names no specific product, so its text is identical
   * for every store selling the same kind of thing in the same market. One
   * observation of it then answers for all of them.
   *
   * This is the unit economic of the whole business and not a detail. The cost
   * of an observation scales with product type times market times query times
   * engine times repeat; revenue scales with store count. Those are different
   * denominators, so gross margin improves with density only to the extent
   * that queries are shared. A query naming a product is shared with nobody
   * and its whole cost falls on one store.
   *
   * Optional because a hand-built Query in a test does not measure this.
   * Undefined counts as not shareable, which is the conservative direction.
   */
  shareable?: boolean
  /**
   * The dedupe key for a shareable query: market, language and the exact
   * normalised text. Set only when `shareable` is true.
   *
   * Derived from the rendered text rather than from a taxonomy on purpose.
   * The text is what an engine is actually asked, so two stores share an
   * observation when and only when their texts match, and a coarse category
   * key would wrongly merge "bookshelf speaker under 1000" with "bookshelf
   * speaker under 200". Phase 2 groups scheduled observations by this.
   */
  shareKey?: string
}

/**
 * One product card as an engine rendered it, normalised across engines.
 * Absent fields mean the engine did not state the value, which is itself a
 * finding: a card with no price is not the same as a card with a wrong price.
 */
export interface Card {
  position: number
  title: string
  brand?: string
  price?: number
  currency?: string
  availability?: Availability
  rating?: number
  image?: string
  url?: string
  /** SKU this card was matched to, when identity matching succeeded. */
  matchedSku?: string
  /** 0 to 1 confidence of the SKU match. */
  matchConfidence?: number
  /** True when the card is a product from another retailer or brand. */
  thirdParty?: boolean
  /** Verbatim engine text this card was read from. */
  evidence?: string
}

export interface Observation {
  id: string
  storeId: string
  queryId: string
  engine: EngineId
  method: ObservationMethod
  observedAt: string
  /** Pointer into the evidence store: relative path plus content hash. */
  rawRef: RawRef
  cards: Card[]
  /** Repeat index, 0 based. Reproducibility is measured across repeats. */
  repeat: number
  /** Set when the adapter could not observe the surface at all. */
  error?: string
}

export interface RawRef {
  path: string
  sha256: string
  bytes: number
}

export type FindingType =
  | 'bestseller_absent'
  | 'price_mismatch'
  | 'availability_stale'
  | 'discontinued_recommended'
  | 'competitor_substituted'
  | 'wrong_variant'
  | 'broken_image'
  | 'landing_url_wrong'
  | 'unverified_rating'
  | 'identity_ambiguous'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Finding {
  id: string
  observationId: string
  engine: EngineId
  queryId: string
  queryText: string
  sku: string | null
  type: FindingType
  severity: Severity
  expected: Record<string, unknown>
  observed: Record<string, unknown>
  /** Probable cause. Deterministic where possible. */
  cause: string
  /**
   * True when `cause` came from a model rather than a rule. Surfaced in the UI
   * and the log as "inferred cause". SPEC 4.5.
   */
  causeInferred: boolean
  /** Revenue at risk proxy: volume proxy times margin. Unitless in Phase 0. */
  revenueAtRisk: number
  status: 'open'
}

export type PresenceState = 'rendering' | 'ingested' | 'eligible' | 'absent' | 'not_observable'

export interface Presence {
  storeId: string
  engine: EngineId
  state: PresenceState
  /** Why the store is not rendering, when it is not. */
  blocker?: string
  /** Share of queries where at least one of the merchant's SKUs rendered. */
  cardRate: number
  /** Share of rendered cards that carried no finding. */
  accuracyRate: number
  checkedAt: string
}

export interface EngineReproducibility {
  engine: EngineId
  method: ObservationMethod
  repeats: number
  /** Mean pairwise agreement of card identity sets across repeats, 0 to 1. */
  rate: number
  /**
   * False when rate is below the 0.8 threshold in SPEC 4.4. The surface is then
   * reported as not observable rather than approximated.
   */
  observable: boolean
  queriesMeasured: number
  errors: number
  note?: string
}

export interface RunManifest {
  runId: string
  startedAt: string
  finishedAt?: string
  store: Store
  /** Harness version, so a re-read of an old log knows what produced it. */
  harnessVersion: string
  engines: EngineId[]
  repeats: number
  productCount: number
  queryCount: number
  observationCount: number
  findingCount: number
  reproducibility: EngineReproducibility[]
  presence: Presence[]
  /**
   * Share of this run's queries that one observation could answer for every
   * store in the same category and market, 0 to 1. Phase 0 reports it because
   * it is the cheapest available test of whether the scale economy exists.
   * See Query.shareable.
   */
  shareableQueryFraction: number
  /** Set when any engine ran on fixtures. Marks the run as non-evidential. */
  fixtureMode: boolean
}
