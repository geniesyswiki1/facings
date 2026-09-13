/**
 * Locale handling for merchant-facing copy. SPEC 2.3 and 3.3.
 *
 * Two separate jobs, deliberately not merged:
 *
 * 1. Spelling. The codebase is written in British English and stays that way,
 *    identifiers included. A US merchant should still read "catalog", so the
 *    conversion happens at the point copy is rendered, not at the point it is
 *    authored. One source string, localised on the way out.
 *
 * 2. Formatting. Numbers, currency and dates differ by locale in ways that
 *    matter to a reader checking a price: 1,299.00 in en-US and en-GB, but
 *    1.299,00 in de-DE and 1'299.00 in de-CH.
 *
 * Copy rules from SPEC 2.3 survive localisation. The dash rule in particular
 * is a property of the output, so nothing here may introduce one.
 */

import type { Locale, Market } from './markets.js'
import { MARKETS } from './markets.js'

export type { Locale }

/**
 * British to American spellings, restricted to words that actually appear in
 * merchant-facing copy. A general -ise to -ize rule would corrupt words such
 * as "enterprise" and "merchandise", so the map is explicit and tested.
 *
 * Keys are lowercase; casing of the source word is preserved on replacement.
 */
const US_SPELLINGS: Record<string, string> = {
  catalogue: 'catalog',
  catalogues: 'catalogs',
  analyse: 'analyze',
  analysed: 'analyzed',
  analyses: 'analyzes',
  normalise: 'normalize',
  normalised: 'normalized',
  optimise: 'optimize',
  optimised: 'optimized',
  personalise: 'personalize',
  personalised: 'personalized',
  prioritise: 'prioritize',
  prioritised: 'prioritized',
  recognise: 'recognize',
  recognised: 'recognized',
  summarise: 'summarize',
  summarised: 'summarized',
  authorise: 'authorize',
  authorised: 'authorized',
  organisation: 'organization',
  organisations: 'organizations',
  licence: 'license',
  licences: 'licenses',
  centre: 'center',
  centres: 'centers',
  colour: 'color',
  colours: 'colors',
  behaviour: 'behavior',
  behaviours: 'behaviors',
  fulfilment: 'fulfillment',
  enrolment: 'enrollment',
  cancelled: 'canceled',
  cancelling: 'canceling',
  labelled: 'labeled',
  labelling: 'labeling',
  grey: 'gray',
  artefact: 'artifact',
  artefacts: 'artifacts',
  cheque: 'check',
  cheques: 'checks',
  despatch: 'dispatch',
  despatched: 'dispatched',
}

const US_PATTERN = new RegExp(`\\b(${Object.keys(US_SPELLINGS).join('|')})\\b`, 'gi')

/** Applies the casing of the source word to the replacement. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase()
  if (source[0] === source[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/**
 * Converts British spellings to American ones for en-US. Every other locale
 * gets the string unchanged: German copy comes from the message catalogue and
 * never passes through here.
 */
export function localiseSpelling(text: string, locale: Locale): string {
  if (locale !== 'en-US') return text
  return text.replace(US_PATTERN, (match) => {
    const replacement = US_SPELLINGS[match.toLowerCase()]
    return replacement ? matchCase(match, replacement) : match
  })
}

export function localeFor(market: Market): Locale {
  return MARKETS[market].locale
}

/**
 * Formats a price for a locale.
 *
 * Uses Intl so de-CH gets its own group separator rather than the German one.
 * Falls back to a plain rendering if the runtime lacks the locale data, which
 * is better than throwing inside a report renderer.
 */
export function formatCurrency(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** Formats a plain number, for counts and percentages in a report. */
export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value)
  } catch {
    return value.toFixed(fractionDigits)
  }
}

/**
 * Formats an ISO date for a locale. Audit log entries keep their ISO form in
 * storage; this is presentation only.
 */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
  } catch {
    return iso.slice(0, 10)
  }
}
