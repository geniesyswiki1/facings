import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '@showing-up/shared'
import { FIELD_LIMITS, buildAcpFeed, formatAcpPrice, gzip, toCsv, toJsonl, validateAcpItem } from '@showing-up/protocols'
import { catalogue, germanPolicy, product } from './fixtures.js'

describe('buildAcpFeed', () => {
  it('publishes every required field for a complete product', () => {
    const { items } = buildAcpFeed([product()], { policy: germanPolicy() })
    expect(items[0]).toMatchObject({
      id: 'NLA-AM10-WAL',
      title: 'Nordlicht AM10 Regallautsprecher Paar Walnuss',
      link: 'https://nordlicht-audio.de/produkte/am10-walnuss',
      image_link: 'https://cdn.nordlicht-audio.de/am10-walnuss.jpg',
      price: '749.00 EUR',
      availability: 'in_stock',
      enable_search: true,
      enable_checkout: false,
    })
  })

  it('never enables checkout, on any product', () => {
    // SPEC 1: Showing Up is not a checkout. Publishing true would advertise a
    // capability neither Showing Up nor the merchant has wired up.
    const { items } = buildAcpFeed(catalogue(), { policy: germanPolicy() })
    expect(items.every((item) => item.enable_checkout === false)).toBe(true)
  })

  it('excludes a discontinued product rather than calling it out of stock', () => {
    // Out of stock tells an agent the product is coming back. SPEC 3.1 counts
    // recommending a discontinued item as a critical finding, so publishing
    // one would have Showing Up creating the defect it sells the detection of.
    const { items, exclusions } = buildAcpFeed(catalogue(), { policy: germanPolicy() })
    expect(items.some((item) => item.id === 'NLA-TT2')).toBe(false)
    const excluded = exclusions.find((entry) => entry.sku === 'NLA-TT2')
    expect(excluded?.reason).toContain('coming back')
    expect(excluded?.fixable).toBe(false)
  })

  it('carries preorder through, which the specification does allow', () => {
    const { items } = buildAcpFeed(catalogue(), { policy: germanPolicy() })
    expect(items.find((item) => item.id === 'NLA-SUB8')?.availability).toBe('preorder')
  })

  it('excludes a product with no description and says how to fix it', () => {
    const bare = product({ sku: 'NLA-X', attributes: { category: 'Elektronik' } })
    const { items, exclusions } = buildAcpFeed([bare])
    expect(items).toHaveLength(0)
    expect(exclusions[0]?.reason).toContain('no description')
    expect(exclusions[0]?.fixable).toBe(true)
  })

  it('excludes a product with no image', () => {
    const noImage = product({ sku: 'NLA-Y', image: undefined })
    expect(buildAcpFeed([noImage]).exclusions[0]?.reason).toContain('no image')
  })

  it('publishes the policy pages the specification asks for', () => {
    const { items } = buildAcpFeed([product()], { policy: germanPolicy() })
    expect(items[0]?.seller_privacy_policy).toBe('https://nordlicht-audio.de/datenschutz')
    expect(items[0]?.seller_tos).toBe('https://nordlicht-audio.de/agb')
  })

  it('normalises a category into the path form the specification uses', () => {
    const { items } = buildAcpFeed([product()], { policy: germanPolicy() })
    expect(items[0]?.product_category).toBe('Elektronik > Lautsprecher')
  })

  it('truncates rather than publishing an over-length field', () => {
    const long = product({ title: 'A'.repeat(400), attributes: { description: 'B'.repeat(6000) } })
    const { items } = buildAcpFeed([long])
    expect(items[0]?.title.length).toBeLessThanOrEqual(FIELD_LIMITS.title)
    expect(items[0]?.description.length).toBeLessThanOrEqual(FIELD_LIMITS.description)
  })

  it('applies the dash rule to catalogue text, because agents quote it back', () => {
    const dashed = product({ title: 'Nordlicht AM10 \u2014 Walnuss', attributes: { description: 'Ein Paar \u2013 Walnuss.' } })
    const { items } = buildAcpFeed([dashed])
    expect(findCopyViolations(items[0]?.title ?? '')).toEqual([])
    expect(findCopyViolations(items[0]?.description ?? '')).toEqual([])
  })
})

describe('formatAcpPrice', () => {
  it('puts the amount first and the ISO code after, to two decimals', () => {
    expect(formatAcpPrice(749, 'EUR')).toBe('749.00 EUR')
    expect(formatAcpPrice(29.9, 'gbp')).toBe('29.90 GBP')
  })
})

describe('validateAcpItem', () => {
  const valid = () => buildAcpFeed([product()], { policy: germanPolicy() }).items[0]!

  it('passes a built item', () => {
    expect(validateAcpItem(valid())).toEqual([])
  })

  it('rejects a missing required field', () => {
    const item = { ...valid(), image_link: '' }
    expect(validateAcpItem(item).some((issue) => issue.field === 'image_link')).toBe(true)
  })

  it('rejects a malformed price', () => {
    expect(validateAcpItem({ ...valid(), price: '749 EUR' }).some((issue) => issue.field === 'price')).toBe(true)
    expect(validateAcpItem({ ...valid(), price: '€749.00' }).some((issue) => issue.field === 'price')).toBe(true)
  })

  it('rejects an availability outside the three the specification allows', () => {
    const item = { ...valid(), availability: 'discontinued' as never }
    expect(validateAcpItem(item).some((issue) => issue.field === 'availability')).toBe(true)
  })

  it('rejects an item that enables checkout', () => {
    expect(validateAcpItem({ ...valid(), enable_checkout: true }).some((issue) => issue.field === 'enable_checkout')).toBe(true)
  })

  it('rejects a relative URL', () => {
    expect(validateAcpItem({ ...valid(), link: '/produkte/am10' }).some((issue) => issue.field === 'link')).toBe(true)
  })

  it('rejects a rating outside 0 to 5', () => {
    expect(validateAcpItem({ ...valid(), product_review_rating: 9 }).length).toBeGreaterThan(0)
  })
})

describe('serialisation', () => {
  const items = buildAcpFeed(catalogue(), { policy: germanPolicy() }).items

  it('writes one JSON object per line', () => {
    const lines = toJsonl(items).split('\n')
    expect(lines).toHaveLength(items.length)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('writes a CSV with a header row and one row per item', () => {
    const rows = toCsv(items).split('\n')
    expect(rows[0]).toContain('enable_checkout')
    expect(rows).toHaveLength(items.length + 1)
  })

  it('quotes CSV fields containing a comma', () => {
    const csv = toCsv(buildAcpFeed([product({ title: 'AM10, Walnuss' })], { policy: germanPolicy() }).items)
    expect(csv).toContain('"AM10, Walnuss"')
  })

  it('gzips to something that decompresses back to the same bytes', () => {
    const body = toJsonl(items)
    expect(gunzipSync(gzip(body)).toString('utf8')).toBe(body)
  })
})
