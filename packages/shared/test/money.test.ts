import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney, priceDelta } from '@facings/shared'

describe('parseMoney', () => {
  it('reads the UK convention', () => {
    expect(parseMoney('£1,299.00')).toEqual({ amount: 1299, currency: 'GBP' })
  })

  it('reads the German convention', () => {
    expect(parseMoney('1.299,00 EUR')).toEqual({ amount: 1299, currency: 'EUR' })
  })

  it('reads a price stated in words', () => {
    expect(parseMoney('about 89 euros')).toEqual({ amount: 89, currency: 'EUR' })
  })

  it('reads a bare number without inventing a currency', () => {
    expect(parseMoney('449.00')).toEqual({ amount: 449 })
  })

  it('returns undefined rather than guessing, so an unparsed price is never a mismatch', () => {
    expect(parseMoney('price on application')).toBeUndefined()
    expect(parseMoney('')).toBeUndefined()
  })

  it('keeps a thousands separator out of the amount', () => {
    expect(parseMoney('$12,000')?.amount).toBe(12000)
  })
})

describe('priceDelta', () => {
  it('is relative to the expected price', () => {
    expect(priceDelta(100, 116)).toBeCloseTo(0.16)
    expect(priceDelta(100, 100)).toBe(0)
  })

  it('treats any non zero observation against a zero expectation as fully wrong', () => {
    expect(priceDelta(0, 10)).toBe(1)
  })
})

describe('formatMoney', () => {
  it('uses the market symbol', () => {
    expect(formatMoney(749, 'GBP')).toBe('£749.00')
    expect(formatMoney(749, 'EUR')).toBe('€749.00')
    expect(formatMoney(749, 'SEK')).toBe('749.00 SEK')
  })
})
