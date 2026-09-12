import { describe, expect, it } from 'vitest'
import { XMLParser } from 'fast-xml-parser'
import { buildMerchantFeed } from '@facings/protocols'
import { catalogue, germanPolicy, product } from './fixtures.js'

const options = {
  title: 'Nordlicht Audio',
  link: 'https://nordlicht-audio.de/',
  policy: germanPolicy(),
}

function parse(xml: string) {
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml)
}

describe('buildMerchantFeed', () => {
  it('writes a parseable RSS 2.0 document with the g namespace', () => {
    const xml = buildMerchantFeed(catalogue(), { ...options, kind: 'google' })
    const doc = parse(xml)
    expect(doc.rss['@_version']).toBe('2.0')
    expect(doc.rss['@_xmlns:g']).toBe('http://base.google.com/ns/1.0')
    expect(doc.rss.channel.title).toBe('Nordlicht Audio')
  })

  it('keys every item on the SKU, since a supplementary feed matches on id', () => {
    const doc = parse(buildMerchantFeed(catalogue(), { ...options, kind: 'google' }))
    const ids = doc.rss.channel.item.map((item: Record<string, string>) => item['g:id'])
    expect(ids).toEqual(['NLA-AM10-WAL', 'NLA-AM10-BLK', 'NLA-SUB8', 'NLA-TT2'])
  })

  it('publishes the returns policy on every item', () => {
    const doc = parse(buildMerchantFeed([product()], { ...options, kind: 'google' }))
    expect(doc.rss.channel.item['g:return_window_days']).toBe('30')
    expect(doc.rss.channel.item['g:return_policy_link']).toBe('https://nordlicht-audio.de/rueckgabe')
  })

  it('carries shipping on the Microsoft feed and leaves it off the Google one', () => {
    // Google takes shipping at account level, Microsoft on the item.
    const microsoft = buildMerchantFeed([product()], { ...options, kind: 'microsoft' })
    const google = buildMerchantFeed([product()], { ...options, kind: 'google' })
    expect(microsoft).toContain('<g:shipping>')
    expect(google).not.toContain('<g:shipping>')
  })

  it('escapes merchant supplied text rather than trusting it', () => {
    const hostile = product({ title: 'AM10 <script>alert(1)</script>', attributes: { material: 'a & b' } })
    const xml = buildMerchantFeed([hostile], { ...options, kind: 'google' })
    expect(xml).not.toContain('<script>')
    expect(xml).toContain('&amp;')
    expect(() => parse(xml)).not.toThrow()
  })

  it('publishes the product codes an engine resolves identity with', () => {
    const doc = parse(buildMerchantFeed([product()], { ...options, kind: 'google' }))
    expect(doc.rss.channel.item['g:gtin']).toBe('4260000000001')
    expect(doc.rss.channel.item['g:mpn']).toBe('AM10-WAL')
    expect(doc.rss.channel.item['g:brand']).toBe('Nordlicht Audio')
  })
})
