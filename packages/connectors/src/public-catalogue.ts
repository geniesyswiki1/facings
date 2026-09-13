import type { Platform, Product } from '@showing-up/shared'
import { decodeEntities, productInputSchema, toProduct } from './catalogue.js'
import { detectPlatform } from './platform.js'

/**
 * Credential-free catalogue discovery from a store's own public endpoints.
 *
 * This is what makes the free audit in SPEC 3.2 a real product rather than a
 * form: a merchant pastes a URL and gets their actual catalogue read back,
 * with no key to generate and no app to install. Nobody grants API access to
 * a vendor they have not heard of, so an audit that requires one is an audit
 * nobody runs.
 *
 * Everything here is a plain GET of a document the store already serves to the
 * public. It is the merchant's own site rather than a consumer AI surface, so
 * the panel consent rule in CLAUDE.md does not apply; the rule that does apply
 * is that the discovery method travels with the result, because a catalogue
 * read from JSON-LD on ten product pages is weaker evidence than one read from
 * a platform product API, and a report must not pretend otherwise.
 */

export type DiscoveryMethod =
  /** Shopify's public products.json. Complete and well typed. */
  | 'shopify-products-json'
  /** WooCommerce Store API, public on modern installs. */
  | 'woocommerce-store-api'
  /** Product JSON-LD scraped from pages found in the sitemap. */
  | 'json-ld'
  /** Nothing public was readable. */
  | 'none'

export interface PublicCatalogueResult {
  products: Product[]
  platform: Platform
  method: DiscoveryMethod
  /** How confident the discovery is, for the report to state plainly. */
  confidence: 'high' | 'medium' | 'low' | 'none'
  warnings: string[]
}

export interface PublicCatalogueOptions {
  limit?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const UA = 'ShowingUpAudit/0.1 (+https://showingup.ai/bot)'

/** Strips markup and decodes entities, in that order. */
function clean(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

async function getJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) return undefined
    return (await response.json()) as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function getText(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/html,application/xml', 'user-agent': UA },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Shopify serves this publicly on almost every store. */
async function fromShopify(
  storeId: string,
  origin: string,
  limit: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ products: Product[]; warnings: string[] } | undefined> {
  const payload = (await getJson(
    new URL(`/products.json?limit=${Math.min(limit, 250)}`, origin).toString(),
    fetchImpl,
    timeoutMs,
  )) as { products?: Record<string, any>[] } | undefined
  if (!payload?.products?.length) return undefined

  const warnings: string[] = [
    'catalogue read from the public products.json, which lists published products in store order and carries no sales rank',
  ]
  const products: Product[] = []

  for (const item of payload.products) {
    const variant = item.variants?.[0]
    if (!variant) continue
    const attributes: Record<string, string> = {}
    if (item.body_html) attributes.description = clean(String(item.body_html))
    if (item.product_type) attributes.category = String(item.product_type)

    const candidate = {
      sku: variant.sku || String(item.handle),
      title: String(item.title ?? ''),
      price: Number.parseFloat(String(variant.price ?? '0')),
      // products.json omits currency. Left to the market default rather than
      // guessed here, because a wrong currency is a wrong price.
      currency: 'USD',
      availability: variant.available === false ? 'out_of_stock' : 'in_stock',
      url: new URL(`/products/${item.handle}`, origin).toString(),
      image: item.images?.[0]?.src,
      brand: item.vendor || undefined,
      attributes,
    }
    const parsed = productInputSchema.safeParse(candidate)
    if (parsed.success) products.push(toProduct(storeId, parsed.data))
  }
  if (!products.length) return undefined
  warnings.push('products.json states no currency, so the market default was applied and should be confirmed before any price finding is raised')
  return { products, warnings }
}

/** WooCommerce Store API is unauthenticated on a default modern install. */
async function fromWooStoreApi(
  storeId: string,
  origin: string,
  limit: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ products: Product[]; warnings: string[] } | undefined> {
  const payload = (await getJson(
    new URL(`/wp-json/wc/store/v1/products?per_page=${Math.min(limit, 100)}&orderby=popularity`, origin).toString(),
    fetchImpl,
    timeoutMs,
  )) as Record<string, any>[] | undefined
  if (!Array.isArray(payload) || !payload.length) return undefined

  const warnings: string[] = [
    'catalogue read from the public WooCommerce Store API, ordered by the popularity ranking the store keeps itself',
  ]
  const products: Product[] = []

  for (const item of payload) {
    const attributes: Record<string, string> = {}
    // short_description is the summary and is commonly left empty, while
    // description is the body every product page has. Reading only the former
    // excluded a whole real catalogue from the feed for "no description",
    // which was our defect being reported as the merchant's.
    const body = clean(String(item.short_description || item.description || ''))
    if (body) attributes.description = body
    const categories = (item.categories ?? []).map((c: { name?: string }) => c.name).filter(Boolean)
    if (categories.length) attributes.category = categories.join(', ')

    // Store API returns minor units as a string plus a currency block.
    const minor = Number.parseInt(String(item.prices?.price ?? '0'), 10)
    const decimals = Number(item.prices?.currency_minor_unit ?? 2)
    const candidate = {
      sku: item.sku || `wc-${item.id}`,
      title: String(item.name ?? ''),
      price: Number.isFinite(minor) ? minor / 10 ** decimals : 0,
      currency: String(item.prices?.currency_code ?? 'GBP'),
      availability: item.is_in_stock === false ? 'out_of_stock' : 'in_stock',
      url: String(item.permalink ?? ''),
      image: item.images?.[0]?.src,
      attributes,
    }
    const parsed = productInputSchema.safeParse(candidate)
    if (parsed.success) products.push(toProduct(storeId, parsed.data))
  }
  if (!products.length) return undefined
  return { products, warnings }
}

/**
 * Sitemap locations to try, robots.txt first.
 *
 * Assuming /sitemap.xml is how this silently found nothing on four of the
 * first five real stores it was pointed at. Rockler publishes its sitemap at
 * /media/sitemap.xml and declares it in robots.txt, which is the documented
 * place to declare it; a request to /sitemap.xml returned the HTML homepage
 * with a 200, so nothing errored and the store looked as though it had no
 * catalogue. An agent reading the store would have found it, so reporting that
 * as the merchant's problem would have been our bug in their report.
 */
async function sitemapCandidates(
  origin: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  const candidates: string[] = []
  const robots = await getText(new URL('/robots.txt', origin).toString(), fetchImpl, timeoutMs)
  if (robots) {
    for (const match of robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
      const declared = match[1]
      if (declared) candidates.push(declared)
    }
  }
  // Conventional locations, kept as a fallback for stores that declare nothing.
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
    candidates.push(new URL(path, origin).toString())
  }
  // Rank before the cap, never after. CustomInk declares eleven sitemaps and
  // sitemap-pdps.xml, the only one holding product pages, is the tenth. Taking
  // the first eight in declaration order threw it away before anything had a
  // chance to prefer it.
  return [...new Set(candidates)].sort((a, b) => sitemapRank(a) - sitemapRank(b)).slice(0, 8)
}

/** True when a body is actually XML, rather than a soft 404 serving the homepage. */
function looksLikeSitemap(body: string): boolean {
  return /<(?:urlset|sitemapindex)\b/i.test(body)
}

/**
 * What we say when nothing was readable.
 *
 * Exported and asserted by a test so the claim cannot drift back into "an
 * agent reading this store would find nothing either", which the capped page
 * sample does not support.
 */
export const NOT_READABLE =
  'no catalogue was readable by any credential-free method: no Shopify or WooCommerce endpoint, and no Product JSON-LD on the sitemap pages sampled. This is not evidence that the store publishes nothing, because the sample is capped. Connect a catalogue to establish what an agent can actually read.'

/** Every <loc> in a sitemap document. */
function sitemapLocs(body: string): string[] {
  // XML requires & to be escaped, so a sitemap URL carrying a query string
  // arrives as ...xmlsitemap.php?type=products&amp;page=1. Fetching that
  // literally sends the wrong query and returns an empty document, which is
  // how Hyperdrug's product sitemap read as zero URLs. Same entity bug already
  // fixed once on the feed side; decodeEntities is the same helper.
  return [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => decodeEntities(match[1] ?? ''))
    .filter(Boolean)
}

/**
 * How likely a sitemap is to hold product pages, from its own URL.
 *
 * CustomInk declares eleven sitemaps, one of which is sitemap-pdps.xml, and
 * pdp is the standard abbreviation for a product detail page. Reading them in
 * declaration order spent the whole page budget on fundraising pages and never
 * reached it. Lower sorts first.
 */
export function sitemapRank(url: string): number {
  // Tokenised, and matched on whole tokens only.
  //
  // The first version tested the whole URL for bare substrings, and one of
  // them was "item". Every sitemap URL contains the word "sitemap", and
  // "sitemap" contains "item", so every candidate scored top rank and the
  // ranking silently did nothing at all on every store. The word that broke it
  // is gone and the rest are matched between delimiters.
  const tokens = url
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((token) => token !== 'sitemap' && token !== 'sitemaps')
  const has = (...words: string[]) => words.some((word) => tokens.includes(word))
  if (has('pdp', 'pdps', 'product', 'products', 'catalog', 'catalogue', 'sku', 'skus')) return 0
  if (has('plp', 'plps', 'category', 'categories', 'shop', 'collection', 'collections', 'brand', 'brands')) return 1
  if (has('blog', 'blogs', 'news', 'article', 'articles', 'idea', 'ideas', 'fundraising', 'design', 'designs', 'stores', 'pages')) return 3
  return 2
}

/**
 * Candidate page URLs from a store's sitemaps.
 *
 * The document type decides what its entries mean: a <sitemapindex> lists
 * child sitemaps, a <urlset> lists pages. An earlier version decided that by
 * matching the URL string for "sitemap" and ".xml", which is a convention and
 * not a rule, and it failed on the first real stores it met: Sportsman's
 * Warehouse indexes children at /customsitemap/HOMEPAGE-en-USD and Garden
 * Trading serves its index from xmlsitemap.php. Neither ends in .xml, so both
 * were discarded and the store looked as though it published nothing.
 */
async function productUrlsFromSitemap(
  origin: string,
  budget: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  // Every declared sitemap, not the first one that parses.
  //
  // Tooled-Up declares sitemap1.xml and sitemap2.xml in robots.txt. The first
  // holds the site pages (/, /blog/, /brand/) and the second holds every
  // product. Stopping at the first sitemap that parsed read the wrong half of
  // the store and reported a hundred thousand SKUs as no catalogue at all.
  const candidates = await sitemapCandidates(origin, fetchImpl, timeoutMs)

  const roots: { body: string; url: string }[] = []
  for (const candidate of candidates) {
    // A soft 404 returns the homepage with a 200, so the shape is the only
    // reliable check that this is a sitemap at all.
    const body = await getText(candidate, fetchImpl, timeoutMs)
    if (body && looksLikeSitemap(body)) roots.push({ body, url: candidate })
  }
  if (roots.length === 0) return []

  // Capped per sitemap. CustomInk's inkofweek.xml alone holds fifty thousand
  // URLs, which swamped every other sitemap it declares including the product
  // one, so each contributes a bounded share and rank decides the order.
  const PER_SITEMAP = Math.max(budget * 5, 200)
  const pages: { url: string; rank: number }[] = []
  for (const root of roots) {
    const rank = sitemapRank(root.url)
    if (/<sitemapindex\b/i.test(root.body)) {
      const children = sitemapLocs(root.body).sort((a, b) => sitemapRank(a) - sitemapRank(b))
      for (const child of children.slice(0, 6)) {
        const body = await getText(child, fetchImpl, timeoutMs)
        if (!body || !looksLikeSitemap(body)) continue
        // One level of nesting only. A deeper index is rare and the page budget
        // is better spent reading product pages than walking more indexes.
        if (/<sitemapindex\b/i.test(body)) continue
        for (const loc of sitemapLocs(body).slice(0, PER_SITEMAP)) {
          pages.push({ url: loc, rank: sitemapRank(child) })
        }
      }
    } else {
      for (const loc of sitemapLocs(root.body).slice(0, PER_SITEMAP)) pages.push({ url: loc, rank })
    }
  }

  // Ranked, not filtered. Whether a page is a product page is decided by
  // whether it carries Product JSON-LD, which the caller checks; the path hint
  // only decides which pages to spend the budget on first. Rockler and three
  // other real stores publish clean URLs such as /hand-tools/clamps, so a
  // /product/ filter removed every candidate they had.

  // No guessing where in a sitemap the products are.
  //
  // An earlier version broke the tie by URL depth, deepest first. That was
  // fitted to Rockler, whose products sit at /hand-tools/clamps, and it is
  // exactly wrong for Hyperdrug, whose products sit at the root as
  // /hedrin-4-lotion-150ml/ while its articles are eight segments deep. The
  // depth heuristic spent the whole budget reading articles on a store whose
  // product markup is textbook correct.
  //
  // Depth is not a signal for productness, and neither is position. So rank
  // only on things that carry real information, the sitemap a URL came from
  // and an explicit /product/ style path segment, then sample the remainder at
  // an even stride across the whole list. A store whose products are shallow,
  // deep, first or last is represented either way.
  const hinted = (loc: string) => (/\/(product|products|shop|p|dp|item|sku)\//i.test(loc) ? 0 : 1)
  const seen = new Set<string>()
  const ordered = pages
    .filter((entry) => !/\.(xml|txt|gz|jpg|png|pdf)($|\?)/i.test(entry.url))
    .filter((entry) => (seen.has(entry.url) ? false : seen.add(entry.url)))
    .sort((a, b) => a.rank - b.rank || hinted(a.url) - hinted(b.url))
    .map((entry) => entry.url)

  if (ordered.length <= budget) return ordered
  const stride = ordered.length / budget
  const sampled: string[] = []
  for (let i = 0; i < budget; i += 1) sampled.push(ordered[Math.floor(i * stride)] as string)
  return [...new Set(sampled)]
}

/** Reads Product JSON-LD out of a rendered page. */
function productFromJsonLd(html: string, pageUrl: string): Record<string, unknown> | undefined {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse((block[1] ?? '').trim())
    } catch {
      continue
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const entry of candidates) {
      const node = entry as Record<string, any>
      const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node]
      for (const item of graph) {
        const type = item?.['@type']
        const types = Array.isArray(type) ? type : [type]
        if (!types.includes('Product')) continue
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers
        return {
          sku: item.sku ?? item.mpn ?? item.productID ?? pageUrl,
          title: item.name,
          price: Number.parseFloat(String(offer?.price ?? '0')),
          currency: offer?.priceCurrency,
          availability: String(offer?.availability ?? '').includes('OutOfStock') ? 'out_of_stock' : 'in_stock',
          url: item.url ?? pageUrl,
          image: Array.isArray(item.image) ? item.image[0] : item.image,
          brand: typeof item.brand === 'string' ? item.brand : item.brand?.name,
          gtin: item.gtin13 ?? item.gtin ?? undefined,
          attributes: item.description ? { description: String(item.description) } : {},
        }
      }
    }
  }
  return undefined
}

async function fromJsonLd(
  storeId: string,
  origin: string,
  limit: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ products: Product[]; warnings: string[] } | undefined> {
  // Most sitemap URLs are category and content pages, so the page budget has
  // to exceed the product limit or a store with clean URLs yields nothing.
  const budget = Math.min(Math.max(limit * 4, 40), 120)
  const urls = await productUrlsFromSitemap(origin, budget, fetchImpl, timeoutMs)
  if (!urls.length) return undefined

  const products: Product[] = []
  const warnings: string[] = [
    'catalogue read from Product JSON-LD on individual pages found in the sitemap, which is the weakest discovery method here and covers only the pages that publish it',
  ]

  let pagesRead = 0
  for (const url of urls) {
    if (products.length >= limit) break
    const html = await getText(url, fetchImpl, timeoutMs)
    pagesRead += 1
    if (!html) continue
    const candidate = productFromJsonLd(html, url)
    if (!candidate) continue
    const parsed = productInputSchema.safeParse(candidate)
    if (parsed.success) products.push(toProduct(storeId, parsed.data))
  }

  if (products.length) {
    warnings.push(
      `${products.length} products found by reading ${pagesRead} pages from the sitemap, so this catalogue is a sample rather than the whole of it`,
    )
  }
  return products.length ? { products, warnings } : undefined
}

/**
 * Reads what a store publishes about itself, in descending order of evidence
 * quality, and reports which method worked.
 *
 * Never invents a catalogue. When nothing is readable the result is zero
 * products with method "none", which is a valid audit result.
 *
 * It is reported as "not readable by these methods", never as "this store
 * publishes nothing". The difference is not pedantry. Discovery samples a
 * capped number of sitemap pages, so on a store with a hundred thousand SKUs a
 * miss is a sampling limit and not a fact about the merchant. Tooled-Up is the
 * case that forced this: its sitemap lists category pages, whose markup is
 * ItemList rather than Product, and the product pages sit deeper than the
 * budget reaches. Telling that merchant they publish no catalogue would be
 * false, and they would know it.
 */
export async function discoverPublicCatalogue(
  storeUrl: string,
  options: PublicCatalogueOptions = {},
): Promise<PublicCatalogueResult> {
  const { limit = 20, fetchImpl = fetch, timeoutMs = 15_000 } = options
  const origin = new URL(storeUrl).origin
  const storeId = new URL(storeUrl).hostname.replace(/^www\./, '')

  const detection = await detectPlatform(origin, { fetchImpl, timeoutMs })
  const warnings: string[] = []
  if (detection.error) warnings.push(`platform detection failed: ${detection.error}`)

  // Ordered by evidence quality, not by likelihood. A platform product API
  // beats a scrape even when the scrape would have been quicker.
  const shopify = await fromShopify(storeId, origin, limit, fetchImpl, timeoutMs)
  if (shopify) {
    return {
      products: shopify.products,
      platform: detection.platform === 'unknown' ? 'shopify' : detection.platform,
      method: 'shopify-products-json',
      confidence: 'high',
      warnings: [...warnings, ...shopify.warnings],
    }
  }

  const woo = await fromWooStoreApi(storeId, origin, limit, fetchImpl, timeoutMs)
  if (woo) {
    return {
      products: woo.products,
      platform: detection.platform === 'unknown' ? 'woocommerce' : detection.platform,
      method: 'woocommerce-store-api',
      confidence: 'high',
      warnings: [...warnings, ...woo.warnings],
    }
  }

  const jsonLd = await fromJsonLd(storeId, origin, limit, fetchImpl, timeoutMs)
  if (jsonLd) {
    return {
      products: jsonLd.products,
      platform: detection.platform,
      method: 'json-ld',
      confidence: 'medium',
      warnings: [...warnings, ...jsonLd.warnings],
    }
  }

  return {
    products: [],
    platform: detection.platform,
    method: 'none',
    confidence: 'none',
    warnings: [
      ...warnings,
      NOT_READABLE,
    ],
  }
}
