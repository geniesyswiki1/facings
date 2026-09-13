/**
 * Merchant-facing message catalogue. SPEC 2.3 and 3.3.
 *
 * English is authored once in British spelling and localised to en-US by
 * locale.ts, so there is one English entry per key rather than two. German is
 * authored here, because German is a translation rather than a spelling
 * variant and de-DE, de-AT and de-CH share it.
 *
 * The tax question is the one string that is not a translation of the same
 * sentence. A US merchant is not asked whether prices include sales tax,
 * because the answer is fixed by where the shopper lives rather than by the
 * merchant. See markets.ts and the taxPrompt helper below.
 *
 * SPEC 2.3 applies to every string here: sentence case, no exclamation marks,
 * hyphens only, engine names exact, no promise of a ranking or a revenue
 * effect.
 */

import type { Language, Locale, Market } from './markets.js'
import { MARKETS } from './markets.js'
import { localiseSpelling } from './locale.js'

export type MessageKey =
  | 'country'
  | 'currency'
  | 'costZeroForFree'
  | 'deliveryPromiseByCountry'
  | 'eligible'
  | 'eligibleSurfaces'
  | 'fastestDays'
  | 'feedHealth'
  | 'fixable'
  | 'hostedEndpoints'
  | 'inFeed'
  | 'market'
  | 'months'
  | 'pinnedNotConfirmed'
  | 'platform'
  | 'policies'
  | 'price'
  | 'privacyPolicy'
  | 'product'
  | 'products'
  | 'publishPolicies'
  | 'publishedPages'
  | 'returns'
  | 'returnsPolicyPage'
  | 'saved'
  | 'slowestDays'
  | 'standardRatePercent'
  | 'stock'
  | 'store'
  | 'stores'
  | 'surface'
  | 'surfaces'
  | 'terms'
  | 'warranty'
  | 'whatIsBlocking'
  | 'whatItCovers'
  | 'whoPaysReturnPostage'
  | 'whyNotInFeed'
  | 'whyNot'
  | 'worthAnswering'
  | 'returnsWindowDays'
  | 'statutoryMinimumNote'
  | 'noStatutoryReturnRight'

type Catalogue = Record<MessageKey, string>

/** Authored in British English. localiseSpelling handles en-US on the way out. */
const EN: Catalogue = {
  country: 'Country',
  currency: 'Currency',
  costZeroForFree: 'Cost, 0 for free',
  deliveryPromiseByCountry: 'Delivery promise by country',
  eligible: 'Eligible',
  eligibleSurfaces: 'Eligible surfaces',
  fastestDays: 'Fastest, days',
  feedHealth: 'Feed health',
  fixable: 'Fixable',
  hostedEndpoints: 'Hosted endpoints',
  inFeed: 'In feed',
  market: 'Market',
  months: 'Months',
  pinnedNotConfirmed: 'Pinned, not yet confirmed',
  platform: 'Platform',
  policies: 'Policies',
  price: 'Price',
  privacyPolicy: 'Privacy policy',
  product: 'Product',
  products: 'Products',
  publishPolicies: 'Publish policies',
  publishedPages: 'Published pages',
  returns: 'Returns',
  returnsPolicyPage: 'Returns policy page',
  saved: 'Saved. The feeds and the manifest now carry these values.',
  slowestDays: 'Slowest, days',
  standardRatePercent: 'Standard rate, percent',
  stock: 'Stock',
  store: 'Store',
  stores: 'Stores',
  surface: 'Surface',
  surfaces: 'Surfaces',
  terms: 'Terms',
  warranty: 'Warranty',
  whatIsBlocking: 'What is blocking, and what weakens it',
  whatItCovers: 'What it covers, one sentence',
  whoPaysReturnPostage: 'Who pays return postage',
  whyNotInFeed: 'Why it is not in the feed',
  whyNot: 'Why not',
  worthAnswering: 'Worth answering',
  returnsWindowDays: 'Returns window, days',
  statutoryMinimumNote: 'The law in this market already gives the shopper this many days.',
  noStatutoryReturnRight:
    'This market has no statutory returns window, so whatever you publish is the whole of the shopper protection.',
}

const DE: Catalogue = {
  country: 'Land',
  currency: 'Währung',
  costZeroForFree: 'Kosten, 0 für kostenlos',
  deliveryPromiseByCountry: 'Lieferzusage nach Land',
  eligible: 'Qualifiziert',
  eligibleSurfaces: 'Qualifizierte Oberflächen',
  fastestDays: 'Schnellstens, Tage',
  feedHealth: 'Feed-Zustand',
  fixable: 'Behebbar',
  hostedEndpoints: 'Gehostete Endpunkte',
  inFeed: 'Im Feed',
  market: 'Markt',
  months: 'Monate',
  pinnedNotConfirmed: 'Festgelegt, noch nicht bestätigt',
  platform: 'Plattform',
  policies: 'Richtlinien',
  price: 'Preis',
  privacyPolicy: 'Datenschutzerklärung',
  product: 'Produkt',
  products: 'Produkte',
  publishPolicies: 'Richtlinien veröffentlichen',
  publishedPages: 'Veröffentlichte Seiten',
  returns: 'Rücksendungen',
  returnsPolicyPage: 'Seite zur Rücksendepolitik',
  saved: 'Gespeichert. Die Feeds und das Manifest führen diese Werte jetzt.',
  slowestDays: 'Längstens, Tage',
  standardRatePercent: 'Regelsatz, Prozent',
  stock: 'Bestand',
  store: 'Shop',
  stores: 'Shops',
  surface: 'Oberfläche',
  surfaces: 'Oberflächen',
  terms: 'AGB',
  warranty: 'Garantie',
  whatIsBlocking: 'Was blockiert, und was schwächt',
  whatItCovers: 'Was sie abdeckt, ein Satz',
  whoPaysReturnPostage: 'Wer trägt die Rücksendekosten',
  whyNotInFeed: 'Warum es nicht im Feed ist',
  whyNot: 'Warum nicht',
  worthAnswering: 'Lohnt sich zu beantworten',
  returnsWindowDays: 'Rücksendefrist, Tage',
  statutoryMinimumNote: 'Das Gesetz in diesem Markt gewährt dem Käufer bereits so viele Tage.',
  noStatutoryReturnRight:
    'Dieser Markt kennt keine gesetzliche Rücksendefrist, daher ist Ihre veröffentlichte Frist der gesamte Käuferschutz.',
}

const CATALOGUES: Record<Language, Catalogue> = { en: EN, de: DE }

/**
 * Returns a localised string.
 *
 * German entries are returned verbatim. English entries pass through the
 * spelling localiser, so en-US reads "catalog" without a second catalogue.
 */
export function message(key: MessageKey, locale: Locale): string {
  const language: Language = locale.startsWith('de') ? 'de' : 'en'
  const text = CATALOGUES[language][key]
  return language === 'en' ? localiseSpelling(text, locale) : text
}

/** Binds a locale once so a renderer can call t('price'). */
export function translator(locale: Locale): (key: MessageKey) => string {
  return (key) => message(key, locale)
}

/**
 * The tax question put to a merchant, which is market-specific rather than
 * merely translated.
 *
 * An inclusive market asks whether displayed prices already contain the tax,
 * because the law expects yes and a no is a finding. An exclusive market is
 * told what happens instead, because there is nothing for the merchant to
 * decide: US sales tax depends on the shipping destination and on where the
 * seller has nexus, so no rate belongs on a product page.
 */
export function taxPrompt(market: Market, locale: Locale): string {
  const profile = MARKETS[market]
  const german = locale.startsWith('de')

  if (profile.taxMode === 'exclusive') {
    return german
      ? `Preise werden ohne ${profile.taxLabel} angezeigt. Der Satz hängt vom Lieferziel ab und wird an der Kasse berechnet.`
      : `Prices are shown without ${profile.taxLabel}. The rate depends on the shipping destination and is calculated at checkout.`
  }

  return german
    ? `Enthalten die angezeigten Preise ${profile.taxLabel}? Das Preisrecht in diesem Markt erwartet ja.`
    : `Do displayed prices include ${profile.taxLabel}? Price marking law in this market expects yes.`
}
