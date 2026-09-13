import type { Platform } from '@showing-up/shared'

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

  { platform: 'adobe-commerce', pattern: /Magento_|mage\/|magento-init/i, label: 'magento modules', weight: 0.9 },
  { platform: 'adobe-commerce', pattern: /static\/version\d+\/frontend/i, label: 'magento static path', weight: 0.8 },
  { platform: 'adobe-commerce', pattern: /data-mage-init/i, label: 'mage init attribute', weight: 0.6 },

  { platform: 'prestashop', pattern: /prestashop/i, label: 'prestashop marker', weight: 0.9 },
  { platform: 'prestashop', pattern: /\/modules\/ps_/i, label: 'prestashop module path', weight: 0.7 },

  { platform: 'bigcommerce', pattern: /cdn\d*\.bigcommerce\.com/i, label: 'bigcommerce cdn', weight: 0.9 },
  { platform: 'bigcommerce', pattern: /stencil-utils|bigcommerce\.com\/s-/i, label: 'stencil theme', weight: 0.7 },

  { platform: 'wix', pattern: /static\.parastorage\.com|wixstatic\.com/i, label: 'wix static host', weight: 0.9 },
  { platform: 'wix', pattern: /wix-warmup-data|X-Wix-/i, label: 'wix runtime data', weight: 0.7 },

  { platform: 'shopware', pattern: /shopware|\/bundles\/storefront/i, label: 'shopware storefront', weight: 0.8 },

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

/** Whether Showing Up has a write-capable connector for this platform in Phase 1. */
export function connectorAvailable(platform: Platform): boolean {
  return platform === 'woocommerce' || platform === 'adobe-commerce' || platform === 'wix'
}

/**
 * Whether we can read this platform's catalogue at all.
 *
 * Wider than connectorAvailable on purpose. Shopify is read-only here: the
 * store is sold accuracy monitoring and the audit record rather than presence
 * hosting, because Shopify already publishes its own merchants to the AI
 * surfaces and does not observe what those surfaces then say back.
 */
export function readConnectorAvailable(platform: Platform): boolean {
  return connectorAvailable(platform) || platform === 'shopify'
}

/**
 * What we sell a store on this platform.
 *
 * presence: we host the manifest and feeds and monitor the result.
 * accuracy-only: the platform already publishes, so we monitor and record.
 */
export function offeringFor(platform: Platform): 'presence' | 'accuracy-only' {
  return platform === 'shopify' ? 'accuracy-only' : 'presence'
}
