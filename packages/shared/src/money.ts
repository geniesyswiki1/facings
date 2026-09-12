/** Currency handling. Prices are compared numerically, never as strings. */

const CURRENCY_SYMBOLS: Record<string, string> = {
  '£': 'GBP',
  '€': 'EUR',
  $: 'USD',
}

export const MARKET_CURRENCY: Record<string, string> = {
  UK: 'GBP',
  DE: 'EUR',
  FR: 'EUR',
  NL: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
}

export interface ParsedMoney {
  amount: number
  currency?: string
}

/**
 * Parses a price out of free text such as "£1,299.00", "1.299,00 EUR" or
 * "about 89 euros". Returns undefined rather than guessing when the text holds
 * no unambiguous number: an unparsed price must not become a price mismatch.
 */
export function parseMoney(input: string): ParsedMoney | undefined {
  const text = input.trim()
  if (!text) return undefined

  let currency: string | undefined
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) currency = code
  }
  const codeMatch = text.match(/\b(GBP|EUR|USD|CHF|SEK|DKK|PLN)\b/i)
  if (codeMatch?.[1]) currency = codeMatch[1].toUpperCase()
  if (/\beuros?\b/i.test(text)) currency ??= 'EUR'
  if (/\bpounds?\b|\bsterling\b/i.test(text)) currency ??= 'GBP'

  const numeric = text.match(/\d[\d.,\s]*\d|\d/)
  if (!numeric) return undefined

  const amount = parseNumber(numeric[0])
  if (amount === undefined) return undefined
  return currency ? { amount, currency } : { amount }
}

/** Handles both 1,299.00 and 1.299,00 conventions. */
function parseNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/\s/g, '')
  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalised = cleaned

  if (lastComma >= 0 && lastDot >= 0) {
    // The rightmost separator is the decimal separator.
    normalised =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1
    normalised = decimals === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.')
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1
    if (decimals === 3 && cleaned.split('.').length === 2) normalised = cleaned.replace('.', '')
  }

  const value = Number.parseFloat(normalised)
  return Number.isFinite(value) ? value : undefined
}

/** Formats for display in a report. VAT-inclusive presentation is a Phase 1 concern. */
export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''
  const value = amount.toFixed(2)
  return symbol ? `${symbol}${value}` : `${value} ${currency}`
}

/** Relative difference between two prices, 0 to 1 plus. */
export function priceDelta(expected: number, observed: number): number {
  if (expected === 0) return observed === 0 ? 0 : 1
  return Math.abs(observed - expected) / expected
}
