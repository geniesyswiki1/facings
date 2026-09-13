import { ALL_ENGINES, type EngineId, type Market, type Platform } from '@showing-up/shared'

/**
 * Platform detection from a store's public homepage.
 *
 * Read-only, one GET of a page the merchant already serves to the public, with
 * a Showing Up user agent so the request is attributable. This is the merchant's
 * own site, not a consumer AI surface, so no panel consent applies.
 */

export interface PlatformSignal {
  platform: Platform
  pattern: string
  weight: number
}

export interface DetectionResult {
  platform: Platform
  confidence: number
  signals: PlatformSignal[]
  /** Set when the page could not be fetched. Detection then falls back to manual. */
  error?: string
}

interface SignalRule {
  platform: Platform
  /** Literal or regex source matched against the HTML. */
  pattern: RegExp
  label: string
  weight: number
}

/**
 * Ordered by specificity: a single high-weight fingerprint beats several weak
 * ones, because generic markers such as "cart" appear on every platform.
 */
const RULES: SignalRule[] = [
  { platform: 'woocommerce', pattern: /woocommerce[-/.]/i, label: 'woocommerce asset path', weight: 0.6 },
  { platform: 'woocommerce', pattern: /wp-content\/plugins\/woocommerce/i, label: 'woocommerce plugin', weight: 0.9 },
  { platform: 'woocommerce', pattern: /wc-block|wc_add_to_cart/i, label: 'woocommerce blocks', weight: 0.5 },
  { platform: 'woocommerce', pattern: /wp-content\/themes/i, label: 'wordpress theme path', weight: 0.2 },

  // The alternative used to be a bare mage\/, which matches "image/". Every
  // page carrying type="image/webp" or an og:image scored Adobe Commerce at
  // 90%, and four stores in one prospect pack were misidentified: three run
  // Next.js or Nuxt and one runs Rails. Platform decides offeringFor(), which
  // decides what a merchant is pitched, so a false positive here is a sales
  // call that falls apart. Anchored to a path segment and a module prefix.
  { platform: 'adobe-commerce', pattern: /\bMagento_|\/mage\/|magento-init/i, label: 'magento modules', weight: 0.9 },
  { platform: 'adobe-commerce', pattern: /static\/version\d+\/frontend/i, label: 'magento static path', weight: 0.8 },
  { platform: 'adobe-commerce', pattern: /data-mage-init/i, label: 'mage init attribute', weight: 0.6 },

  // Same shape as the Shopware fix above and tightened for the same reason: a
  // bare vendor name matches an icon class, a footer credit or a blog post.
  { platform: 'prestashop', pattern: /\/prestashop\/|prestashop\.js|var\s+prestashop|data-prestashop|generator["'][^>]{0,40}prestashop|x-powered-by:\s*prestashop/i, label: 'prestashop marker', weight: 0.9 },
  { platform: 'prestashop', pattern: /\/modules\/ps_/i, label: 'prestashop module path', weight: 0.7 },

  { platform: 'bigcommerce', pattern: /cdn\d*\.bigcommerce\.com/i, label: 'bigcommerce cdn', weight: 0.9 },
  { platform: 'bigcommerce', pattern: /stencil-utils|bigcommerce\.com\/s-/i, label: 'stencil theme', weight: 0.7 },

  { platform: 'wix', pattern: /static\.parastorage\.com|wixstatic\.com/i, label: 'wix static host', weight: 0.9 },
  { platform: 'wix', pattern: /wix-warmup-data|X-Wix-/i, label: 'wix runtime data', weight: 0.7 },

  // Not a bare /shopware/. Font Awesome ships a fa-shopware brand icon, so
  // every site loading the full icon set matched, and Scout & Nimble, which
  // runs Rails and Nuxt, scored Shopware at 80% on the strength of a CSS class
  // it never uses. Anchored to markers a Shopware storefront actually emits.
  { platform: 'shopware', pattern: /\/bundles\/storefront|window\.shopware|data-shopware|\/_shopware\/|x-shopware/i, label: 'shopware storefront', weight: 0.8 },

  { platform: 'shopify', pattern: /cdn\.shopify\.com|shopify-features/i, label: 'shopify cdn', weight: 0.95 },
]

/** Scores HTML against the fingerprint rules. Pure, so it is unit testable. */
export function detectPlatformFromHtml(html: string): DetectionResult {
  const scores = new Map<Platform, number>()
  const signals: PlatformSignal[] = []

  for (const rule of RULES) {
    if (!rule.pattern.test(html)) continue
    signals.push({ platform: rule.platform, pattern: rule.label, weight: rule.weight })
    scores.set(rule.platform, (scores.get(rule.platform) ?? 0) + rule.weight)
  }

  let best: Platform = 'unknown'
  let bestScore = 0
  for (const [platform, score] of scores) {
    if (score > bestScore) {
      best = platform
      bestScore = score
    }
  }

  // A lone weak signal is not a detection. WordPress theme paths alone, for
  // instance, say nothing about whether WooCommerce is installed.
  if (bestScore < 0.5) {
    return { platform: 'unknown', confidence: bestScore, signals }
  }

  return {
    platform: best,
    confidence: Math.min(1, bestScore),
    signals: signals.filter((s) => s.platform === best),
  }
}

export interface DetectOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function detectPlatform(url: string, options: DetectOptions = {}): Promise<DetectionResult> {
  const { timeoutMs = 15_000, fetchImpl = fetch } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'ShowingUpAudit/0.1 (+https://showingup.ai/bot)',
        accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok) {
      return { platform: 'unknown', confidence: 0, signals: [], error: `HTTP ${response.status}` }
    }
    const html = await response.text()
    const result = detectPlatformFromHtml(html)
    // Response headers carry fingerprints the body sometimes hides.
    const headerBlob = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')
    if (result.platform === 'unknown') return detectPlatformFromHtml(headerBlob)
    return result
  } catch (error) {
    return {
      platform: 'unknown',
      confidence: 0,
      signals: [],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Platforms with a first-party catalogue connector.
 *
 * Shopify is read-only: we never write to a Shopify store, because we never
 * sell one presence hosting. Everything else reads and, from Phase 3, writes.
 */
export const CONNECTED_PLATFORMS: Platform[] = [
  'woocommerce',
  'adobe-commerce',
  'prestashop',
  'bigcommerce',
  'wix',
  'shopware',
  'shopify',
]

/** Whether Showing Up has a write-capable connector for this platform. */
export function connectorAvailable(platform: Platform): boolean {
  return CONNECTED_PLATFORMS.includes(platform) && platform !== 'shopify'
}

/**
 * Whether we can read this platform's catalogue at all.
 *
 * Wider than connectorAvailable on purpose. Shopify is read-only here: we
 * never sell a Shopify store presence hosting, because Shopify already
 * publishes its own merchants to the AI surfaces and does it well.
 */
export function readConnectorAvailable(platform: Platform): boolean {
  return connectorAvailable(platform) || platform === 'shopify'
}

/**
 * Surfaces Shopify reaches for its own merchants.
 *
 * Spring 2026 Edition covered ChatGPT, Copilot, Google AI Mode, Gemini and the
 * Shop app. Claude was added on 2 September 2026, when Anthropic launched
 * Claude Commerce Agents with Shopify as a named partner; Shopify's
 * implementation was public on GitHub inside 48 hours.
 *
 * Only Perplexity is left, and it is 2.6% of LLM referral traffic to online
 * stores (Alhena, July 2026, 310 retail brands, 189.76m visitors), inside a
 * channel measured at roughly a quarter of one percent of retail visits. That
 * is not a commercial argument, so surface coverage is no longer something we
 * sell. It stays here as a fact, not a pitch.
 */
export const SHOPIFY_COVERED_ENGINES: EngineId[] = [
  'openai',
  'gemini',
  'google-ai-mode',
  'copilot',
  'claude',
]

/**
 * Surfaces a Shopify merchant has no reporting on. Perplexity alone as at
 * September 2026. Kept for the audit trail rather than for a slide.
 */
export function enginesShopifyDoesNotCover(): EngineId[] {
  return ALL_ENGINES.filter((engine) => !SHOPIFY_COVERED_ENGINES.includes(engine))
}

export type Offering = 'presence' | 'accuracy-only'

/**
 * What we sell a store on this platform.
 *
 * presence: we host the manifest and feeds and monitor the result. Everything
 * except Shopify, in every packaged market.
 *
 * accuracy-only: Shopify, in every packaged market, sold strictly on the three
 * things Shopify does not do for its own merchants.
 *
 * The reasoning, because this was revised twice and the corrected version has
 * to survive. Shopify's Spring 2026 Edition added Search Intelligence, which
 * reports the top AI queries in a merchant's category and which of them they
 * rank for, plus an agentic dashboard doing full channel attribution. So the
 * earlier claim that Shopify "does not observe what the surfaces say back" was
 * false, and any pitch built on it would collapse in the first sales call.
 *
 * What Shopify still does not do, verified against its own wording, is the
 * whole of what we sell a Shopify merchant. It is enumerated in
 * SHOPIFY_SELLABLE below so a screen cannot quietly widen it.
 */
export function offeringFor(platform: Platform): Offering {
  return platform === 'shopify' ? 'accuracy-only' : 'presence'
}

/**
 * The only two things a Shopify merchant may be sold. Anything outside this
 * list, presence hosting and AI channel visibility above all, is something
 * Shopify already gives them in the admin they open every morning.
 */
export const SHOPIFY_SELLABLE = [
  'correctness: whether the price and availability an assistant stated match the live catalogue, not whether the product appeared',
  'the record: every observation dated, method-stamped and hashed, retained 24 months',
] as const

/** True when this is something we may put in front of a Shopify merchant. */
export function sellableToShopify(capability: 'presence' | 'visibility' | 'correctness' | 'record' | 'uncovered-surfaces'): boolean {
  // uncovered-surfaces was sellable until 2 September 2026 and is not any
  // more. Shopify now reaches Claude, leaving only Perplexity, which is 2.6%
  // of a channel that is itself about 0.24% of retail visits.
  return capability === 'correctness' || capability === 'record'
}
