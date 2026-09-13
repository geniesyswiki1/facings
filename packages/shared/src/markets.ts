/**
 * Markets and regions. SPEC 3.3.
 *
 * v1 packages three regions: the US, the UK and DACH. DACH is Germany,
 * Austria and Switzerland, and the third of those is the reason this file is
 * a data table rather than a pair of enums. Switzerland is outside the EU, so
 * it shares a language with Germany and Austria while sharing neither their
 * currency nor their consumer law.
 *
 * Everything downstream reads the market from here: currency, locale, how tax
 * is presented, and what the law already guarantees a shopper before the
 * merchant promises anything. Getting any of those wrong is a consumer law
 * problem rather than a formatting one, so they are declared once and asserted
 * by tests rather than restated per screen.
 */

/** The three packaged regions. Sold, priced and reported on separately. */
export type Region = 'US' | 'UK' | 'DACH'

/** The five packaged markets. FR, NL, ES and IT are roadmap, not v1. */
export type Market = 'US' | 'UK' | 'DE' | 'AT' | 'CH'

/** Locales v1 ships copy in. One per market, because de-CH is not de-DE. */
export type Locale = 'en-US' | 'en-GB' | 'de-DE' | 'de-AT' | 'de-CH'

/** Language of a locale, for query sets and observation prompts. */
export type Language = 'en' | 'de'

/**
 * How a market expects tax to appear in a price shown to a shopper.
 *
 * inclusive: the displayed price already contains the tax, which UK, EU and
 * Swiss price marking law all require of a consumer facing price.
 *
 * exclusive: tax is added at checkout once the destination is known. This is
 * the US, where the rate depends on the shipping address and on the seller's
 * nexus, so no single rate can be shown on a product page.
 */
export type TaxMode = 'inclusive' | 'exclusive'

export interface MarketProfile {
  market: Market
  region: Region
  /** ISO 3166-1 alpha-2. */
  country: string
  /** ISO 4217. */
  currency: string
  locale: Locale
  language: Language
  taxMode: TaxMode
  /**
   * What the tax is called to a merchant in this market. Used in copy, so it
   * is the local term rather than a translation of "VAT".
   */
  taxLabel: string
  /**
   * Standard rate as a percentage. Undefined for the US, where the rate is set
   * per state and locality and there is no national figure to state.
   */
  standardTaxRatePct?: number
  /**
   * Calendar days the law already gives a shopper to change their mind, with
   * no reason required. A merchant may offer more and many do. Zero means the
   * market has no statutory distance selling right, which is true of both the
   * US and Switzerland and surprises people who assume otherwise.
   */
  statutoryReturnDays: number
  inEu: boolean
}

/**
 * The market table.
 *
 * Rates and windows here are the standard national position as at the spec
 * date. They are pinned as data for the same reason protocol versions are: a
 * number that moves belongs somewhere a test can see it change.
 */
export const MARKETS: Record<Market, MarketProfile> = {
  US: {
    market: 'US',
    region: 'US',
    country: 'US',
    currency: 'USD',
    locale: 'en-US',
    language: 'en',
    taxMode: 'exclusive',
    taxLabel: 'sales tax',
    statutoryReturnDays: 0,
    inEu: false,
  },
  UK: {
    market: 'UK',
    region: 'UK',
    country: 'GB',
    currency: 'GBP',
    locale: 'en-GB',
    language: 'en',
    taxMode: 'inclusive',
    taxLabel: 'VAT',
    standardTaxRatePct: 20,
    statutoryReturnDays: 14,
    inEu: false,
  },
  DE: {
    market: 'DE',
    region: 'DACH',
    country: 'DE',
    currency: 'EUR',
    locale: 'de-DE',
    language: 'de',
    taxMode: 'inclusive',
    taxLabel: 'MwSt.',
    standardTaxRatePct: 19,
    statutoryReturnDays: 14,
    inEu: true,
  },
  AT: {
    market: 'AT',
    region: 'DACH',
    country: 'AT',
    currency: 'EUR',
    locale: 'de-AT',
    language: 'de',
    taxMode: 'inclusive',
    taxLabel: 'MwSt.',
    standardTaxRatePct: 20,
    statutoryReturnDays: 14,
    inEu: true,
  },
  CH: {
    market: 'CH',
    region: 'DACH',
    country: 'CH',
    currency: 'CHF',
    locale: 'de-CH',
    language: 'de',
    taxMode: 'inclusive',
    taxLabel: 'MwSt.',
    standardTaxRatePct: 8.1,
    // Switzerland has no statutory right of withdrawal for distance selling.
    // A Swiss shopper only has the returns the merchant chooses to offer, so a
    // published window is worth more there, not less.
    statutoryReturnDays: 0,
    inEu: false,
  },
}

/** Every packaged market, in the order screens list them. */
export const ALL_MARKETS: Market[] = ['US', 'UK', 'DE', 'AT', 'CH']

/** Every packaged region. */
export const ALL_REGIONS: Region[] = ['US', 'UK', 'DACH']

/** Markets belonging to a region. */
export const REGION_MARKETS: Record<Region, Market[]> = {
  US: ['US'],
  UK: ['UK'],
  DACH: ['DE', 'AT', 'CH'],
}

export function marketProfile(market: Market): MarketProfile {
  return MARKETS[market]
}

export function regionOf(market: Market): Region {
  return MARKETS[market].region
}

export function isMarket(value: string): value is Market {
  return Object.prototype.hasOwnProperty.call(MARKETS, value)
}

/** Display names, used in reports and the market switcher. */
export const MARKET_LABELS: Record<Market, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  DE: 'Germany',
  AT: 'Austria',
  CH: 'Switzerland',
}

export const REGION_LABELS: Record<Region, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  DACH: 'DACH',
}
