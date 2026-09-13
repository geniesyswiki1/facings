import { describe, expect, it } from 'vitest'
import {
  ALL_MARKETS,
  ALL_REGIONS,
  MARKETS,
  MARKET_CURRENCY,
  REGION_MARKETS,
  isMarket,
  localeFor,
  localiseSpelling,
  marketProfile,
  message,
  regionOf,
  taxPrompt,
  formatCurrency,
  GBP_LIST,
  REGION_BILLING_CURRENCY,
  convertFromGbp,
  priceCard,
  tierPrice,
} from '../src/index.js'

describe('the packaged markets', () => {
  it('ships exactly the US, the UK and DACH', () => {
    expect(ALL_REGIONS).toEqual(['US', 'UK', 'DACH'])
    expect(ALL_MARKETS).toEqual(['US', 'UK', 'DE', 'AT', 'CH'])
    expect(REGION_MARKETS.DACH).toEqual(['DE', 'AT', 'CH'])
  })

  it('gives every market a currency, a locale and a region', () => {
    for (const market of ALL_MARKETS) {
      const profile = marketProfile(market)
      expect(profile.currency).toMatch(/^[A-Z]{3}$/)
      expect(profile.locale).toMatch(/^(en|de)-[A-Z]{2}$/)
      expect(ALL_REGIONS).toContain(profile.region)
    }
  })

  it('keeps the money table and the market table in agreement', () => {
    for (const market of ALL_MARKETS) {
      expect(MARKET_CURRENCY[market]).toBe(MARKETS[market].currency)
    }
  })

  it('does not put Switzerland on the euro', () => {
    // The DACH trap: one language, three currencies is wrong, but so is
    // assuming one currency. AT is EUR, CH is not.
    expect(marketProfile('AT').currency).toBe('EUR')
    expect(marketProfile('CH').currency).toBe('CHF')
    expect(regionOf('CH')).toBe('DACH')
  })

  it('treats the US as tax exclusive and everywhere else as inclusive', () => {
    expect(marketProfile('US').taxMode).toBe('exclusive')
    for (const market of ['UK', 'DE', 'AT', 'CH'] as const) {
      expect(marketProfile(market).taxMode).toBe('inclusive')
    }
  })

  it('states no national rate for the US, because there is not one', () => {
    expect(marketProfile('US').standardTaxRatePct).toBeUndefined()
    expect(marketProfile('DE').standardTaxRatePct).toBe(19)
    expect(marketProfile('AT').standardTaxRatePct).toBe(20)
    expect(marketProfile('CH').standardTaxRatePct).toBe(8.1)
  })

  it('records that the US and Switzerland have no statutory returns window', () => {
    // Both surprise people. Austria and Germany have the EU fourteen days,
    // Switzerland has none at all despite sharing their language.
    expect(marketProfile('US').statutoryReturnDays).toBe(0)
    expect(marketProfile('CH').statutoryReturnDays).toBe(0)
    expect(marketProfile('DE').statutoryReturnDays).toBe(14)
    expect(marketProfile('AT').statutoryReturnDays).toBe(14)
    expect(marketProfile('UK').statutoryReturnDays).toBe(14)
  })

  it('knows which markets are in the EU', () => {
    expect(marketProfile('DE').inEu).toBe(true)
    expect(marketProfile('AT').inEu).toBe(true)
    expect(marketProfile('CH').inEu).toBe(false)
    expect(marketProfile('UK').inEu).toBe(false)
    expect(marketProfile('US').inEu).toBe(false)
  })

  it('rejects a market that is on the roadmap but not packaged', () => {
    expect(isMarket('FR')).toBe(false)
    expect(isMarket('US')).toBe(true)
  })
})

describe('copy localisation', () => {
  it('converts British spellings for en-US only', () => {
    const source = 'Your catalogue is analysed and normalised.'
    expect(localiseSpelling(source, 'en-US')).toBe('Your catalog is analyzed and normalized.')
    expect(localiseSpelling(source, 'en-GB')).toBe(source)
  })

  it('preserves the casing of the word it replaces', () => {
    expect(localiseSpelling('Catalogue', 'en-US')).toBe('Catalog')
    expect(localiseSpelling('CATALOGUE', 'en-US')).toBe('CATALOG')
    expect(localiseSpelling('catalogue', 'en-US')).toBe('catalog')
  })

  it('leaves words that merely end in -ise alone', () => {
    // A blanket -ise to -ize rule would produce "merchandize" and "enterprize".
    const source = 'merchandise for an enterprise, otherwise unchanged'
    expect(localiseSpelling(source, 'en-US')).toBe(source)
  })

  it('does not touch German', () => {
    expect(localiseSpelling('Der Katalog', 'de-CH')).toBe('Der Katalog')
  })

  it('maps each market to its locale', () => {
    expect(localeFor('US')).toBe('en-US')
    expect(localeFor('UK')).toBe('en-GB')
    expect(localeFor('CH')).toBe('de-CH')
  })
})

describe('the message catalogue', () => {
  it('answers in the language of the locale', () => {
    expect(message('returns', 'en-GB')).toBe('Returns')
    expect(message('returns', 'de-DE')).toBe('Rücksendungen')
    expect(message('returns', 'de-CH')).toBe('Rücksendungen')
  })

  it('asks an inclusive market whether prices include the local tax', () => {
    expect(taxPrompt('DE', 'de-DE')).toContain('MwSt.')
    expect(taxPrompt('UK', 'en-GB')).toContain('VAT')
    expect(taxPrompt('UK', 'en-GB')).toContain('include')
  })

  it('tells a US merchant what happens instead of asking them for a rate', () => {
    const prompt = taxPrompt('US', 'en-US')
    expect(prompt).toContain('sales tax')
    expect(prompt).toContain('destination')
    expect(prompt).not.toContain('Do displayed prices include')
  })

  it('obeys the copy rules', async () => {
    const { findCopyViolations } = await import('../src/text.js')
    for (const market of ALL_MARKETS) {
      const locale = localeFor(market)
      expect(findCopyViolations(taxPrompt(market, locale))).toEqual([])
      expect(findCopyViolations(message('saved', locale))).toEqual([])
    }
  })
})

describe('formatting', () => {
  it('uses the locale conventions rather than one global format', () => {
    // de-CH does not group like de-DE, which is exactly the sort of detail a
    // merchant checking a price notices.
    expect(formatCurrency(1299, 'EUR', 'de-DE')).toContain('1.299')
    expect(formatCurrency(1299, 'USD', 'en-US')).toContain('1,299')
    expect(formatCurrency(1299, 'GBP', 'en-GB')).toContain('1,299')
  })
})

describe('pricing across the regions', () => {
  it('bills each region in its own currency', () => {
    expect(REGION_BILLING_CURRENCY.US).toBe('USD')
    expect(REGION_BILLING_CURRENCY.UK).toBe('GBP')
    expect(REGION_BILLING_CURRENCY.DACH).toBe('EUR')
  })

  it('leaves the GBP list price untouched', () => {
    expect(convertFromGbp(GBP_LIST.growth, 'GBP')).toBe(149)
  })

  it('converts at the fixed rate and rounds to a whole unit', () => {
    // 149 GBP at 1.27 is 189.23, which bills as 189 rather than 189.23.
    expect(convertFromGbp(149, 'USD')).toBe(189)
    expect(convertFromGbp(149, 'EUR')).toBe(174)
    expect(Number.isInteger(convertFromGbp(499, 'CHF'))).toBe(true)
  })

  it('keeps the free tier free in every currency', () => {
    for (const currency of ['GBP', 'USD', 'EUR', 'CHF']) {
      expect(tierPrice('audit', currency).amount).toBe(0)
    }
  })

  it('carries the per client store fee on the agency tier only', () => {
    expect(tierPrice('agency', 'USD').perClientStore).toBe(126)
    expect(tierPrice('growth', 'USD').perClientStore).toBeUndefined()
  })

  it('builds a full price card per region', () => {
    const card = priceCard('DACH')
    expect(card).toHaveLength(5)
    expect(card.every((row) => row.currency === 'EUR')).toBe(true)
  })

  it('refuses a currency it has no pinned rate for', () => {
    expect(() => convertFromGbp(49, 'JPY')).toThrow(/no fixed rate/)
  })
})
