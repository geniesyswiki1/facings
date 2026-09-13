import type { Product } from '@showing-up/shared'
import type { Policy } from '@showing-up/protocols'

/**
 * A WooCommerce store on Adyen in Germany: the exact case SPEC 11 uses as the
 * Phase 1 acceptance check, so the fixtures are shared across these tests.
 */

export function germanPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
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
    ],
    tax: { mode: 'inclusive' as const, pricesIncludeTax: true, ratePct: 19, registrationNumber: 'DE123456789' },
    warranty: { months: 24, summary: 'Two year manufacturer warranty on all electronics.' },
    privacyPolicyUrl: 'https://nordlicht-audio.de/datenschutz',
    termsUrl: 'https://nordlicht-audio.de/agb',
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

export function product(overrides: Partial<Product> = {}): Product {
  return {
    storeId: 'str_1',
    sku: 'NLA-AM10-WAL',
    title: 'Nordlicht AM10 Regallautsprecher Paar Walnuss',
    price: 749,
    currency: 'EUR',
    availability: 'in_stock',
    url: 'https://nordlicht-audio.de/produkte/am10-walnuss',
    image: 'https://cdn.nordlicht-audio.de/am10-walnuss.jpg',
    brand: 'Nordlicht Audio',
    gtin: '4260000000001',
    mpn: 'AM10-WAL',
    marginPct: 38,
    attributes: {
      description: 'Ein Paar Regallautsprecher mit Walnussfurnier.',
      category: 'Elektronik, Lautsprecher',
      material: 'Walnussfurnier',
      colour: 'Walnuss',
    },
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

export function catalogue(): Product[] {
  return [
    product(),
    product({ sku: 'NLA-AM10-BLK', title: 'Nordlicht AM10 Regallautsprecher Paar Schwarz', price: 729 }),
    product({ sku: 'NLA-SUB8', title: 'Nordlicht S8 Aktiver Subwoofer', price: 449, availability: 'preorder' }),
    product({ sku: 'NLA-TT2', title: 'Nordlicht Groove Two Plattenspieler', price: 1249, availability: 'discontinued' }),
  ]
}
