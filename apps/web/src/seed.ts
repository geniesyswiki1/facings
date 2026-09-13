import type { Product, Store } from '@showing-up/shared'
import type { Policy, SigningKey } from '@showing-up/protocols'
import type { StoreRecord } from './repository.js'

/**
 * The seeded demo store.
 *
 * A WooCommerce store on Adyen in Germany, which is the exact case SPEC 11
 * sets as the Phase 1 acceptance check. It exists so the hosted endpoints can
 * be exercised end to end before a real merchant connects, and so the check
 * can run in CI rather than only by hand.
 *
 * Nothing here is a real merchant. The domain does not resolve.
 */

/**
 * Public signing key for the demo store.
 *
 * Public halves only. Showing Up publishes nothing signed in Phase 1, so no
 * private key is needed to serve the manifest, and none is stored in this
 * repository. Production reads the key from the environment: see
 * SHOWING_UP_SIGNING_PUBLIC_JWK below.
 */
export const DEMO_PUBLIC_KEY: SigningKey = {
  kid: '20a1bA8KyGBo1NwUzJa-Mn8kWbijmoHWdk7Q8ZPLAFI',
  kty: 'EC',
  crv: 'P-256',
  x: 'k0GncQgShR6XVYtnY_GmNc2zDfjoss2Bb4qyD5i9B7s',
  y: 'OZAjzkN4XmuKHe_CFyokPWozvDOz0faOySOo09jhG0c',
  use: 'sig',
  alg: 'ES256',
}

/**
 * Reads the published signing key from the environment, falling back to the
 * demo key. Secrets never live in code; the public half is not a secret, but
 * keeping the lookup in one place means production and demo differ by
 * configuration rather than by code path.
 */
export function publishedSigningKeys(env: Record<string, string | undefined> = process.env): SigningKey[] {
  const raw = env.SHOWING_UP_SIGNING_PUBLIC_JWK
  if (!raw) return [DEMO_PUBLIC_KEY]
  try {
    const parsed = JSON.parse(raw) as SigningKey | SigningKey[]
    const keys = Array.isArray(parsed) ? parsed : [parsed]
    // A private component in a published key is a leak, not a configuration.
    return keys.filter((key) => !('d' in key))
  } catch {
    return [DEMO_PUBLIC_KEY]
  }
}

export const DEMO_STORE: Store = {
  id: 'nordlicht',
  domain: 'nordlicht-audio.de',
  url: 'https://nordlicht-audio.de/',
  platform: 'woocommerce',
  market: 'DE',
  language: 'de',
  psp: 'adyen',
  connectorStatus: 'connected',
}

export const DEMO_POLICY: Policy = {
  market: 'DE',
  language: 'de',
  returns: {
    windowDays: 30,
    returnShippingPaidBy: 'merchant',
    restockingFee: false,
    exclusions: [],
    url: 'https://nordlicht-audio.de/rueckgabe',
  },
  delivery: [
    { country: 'DE', minDays: 1, maxDays: 3, cost: 0, currency: 'EUR', carrier: 'DHL' },
    { country: 'AT', minDays: 2, maxDays: 5, cost: 9.9, currency: 'EUR', carrier: 'DHL' },
    { country: 'NL', minDays: 2, maxDays: 4, cost: 7.5, currency: 'EUR', carrier: 'DHL' },
  ],
  tax: { mode: 'inclusive' as const, pricesIncludeTax: true, ratePct: 19, registrationNumber: 'DE123456789' },
  warranty: { months: 24, summary: 'Two year manufacturer warranty on all electronics.' },
  privacyPolicyUrl: 'https://nordlicht-audio.de/datenschutz',
  termsUrl: 'https://nordlicht-audio.de/agb',
  updatedAt: '2026-09-12T08:00:00.000Z',
}

function product(
  sku: string,
  title: string,
  price: number,
  overrides: Partial<Product> = {},
): Product {
  return {
    storeId: DEMO_STORE.id,
    sku,
    title,
    price,
    currency: 'EUR',
    availability: 'in_stock',
    url: `https://nordlicht-audio.de/produkte/${sku.toLowerCase()}`,
    image: `https://cdn.nordlicht-audio.de/${sku.toLowerCase()}.jpg`,
    brand: 'Nordlicht Audio',
    gtin: `426000000${Math.abs(hash(sku)) % 10000}`.slice(0, 13).padEnd(13, '0'),
    mpn: sku,
    marginPct: 36,
    attributes: {
      description: `${title}. Aus der Nordlicht Audio Serie, gefertigt in Deutschland.`,
      category: 'Elektronik, Lautsprecher',
      material: 'Walnussfurnier',
    },
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

export const DEMO_PRODUCTS: Product[] = [
  product('NLA-AM10-WAL', 'Nordlicht AM10 Regallautsprecher Paar Walnuss', 749),
  product('NLA-AM10-BLK', 'Nordlicht AM10 Regallautsprecher Paar Schwarz', 729),
  product('NLA-SUB8', 'Nordlicht S8 Aktiver Subwoofer', 449, { availability: 'preorder' }),
  product('NLA-INT200', 'Nordlicht Integra 200 Vollverstaerker', 1199),
  product('NLA-INT100', 'Nordlicht Integra 100 Vollverstaerker', 799),
  product('NLA-DAC2', 'Nordlicht Bridge DAC 2', 529),
  product('NLA-TT1', 'Nordlicht Groove One Plattenspieler', 649),
  product('NLA-HP400', 'Nordlicht Field 400 Kopfhoerer', 319),
  product('NLA-STR1', 'Nordlicht Current Streamer', 899),
  // Two products with a deliberate gap, so the Presence screen has something
  // real to show: one discontinued, one with no description.
  product('NLA-TT2', 'Nordlicht Groove Two Plattenspieler', 1249, { availability: 'discontinued' }),
  product('NLA-CBL3', 'Nordlicht Signal 3 Lautsprecherkabel 3m', 89, {
    attributes: { category: 'Elektronik, Zubehoer' },
  }),
]

export function demoRecord(): StoreRecord {
  return {
    store: DEMO_STORE,
    products: DEMO_PRODUCTS,
    policy: DEMO_POLICY,
    signingKeyIds: publishedSigningKeys().map((key) => key.kid),
  }
}

function hash(input: string): number {
  let value = 0
  for (let index = 0; index < input.length; index += 1) {
    value = (value << 5) - value + input.charCodeAt(index)
    value |= 0
  }
  return value
}
