import { describe, expect, it } from 'vitest'
import { cardIdentity, extractCardJson, normaliseCardAvailability, normaliseCards, rawCardListSchema } from '@showing-up/observe'

describe('extractCardJson', () => {
  it('reads a bare JSON object', () => {
    expect(extractCardJson('{"cards":[]}')).toEqual({ cards: [] })
  })

  it('reads JSON inside a fenced block', () => {
    expect(extractCardJson('Here you go:\n```json\n{"cards":[]}\n```')).toEqual({ cards: [] })
  })

  it('reads JSON wrapped in prose, which engines do often enough to matter', () => {
    expect(extractCardJson('I found two options. {"cards":[]} Hope that helps.')).toEqual({ cards: [] })
  })

  it('returns undefined when there is no JSON', () => {
    expect(extractCardJson('I could not find anything.')).toBeUndefined()
  })
})

describe('normaliseCards', () => {
  it('keeps stated values and leaves unstated ones undefined', () => {
    const [card] = normaliseCards(
      [{ title: 'Widget', price: '£10.50', currency: 'GBP', availability: 'in stock', url: 'https://store.example/w' }],
      'store.example',
    )
    expect(card).toMatchObject({ position: 1, title: 'Widget', price: 10.5, currency: 'GBP', availability: 'in_stock' })

    const [bare] = normaliseCards([{ title: 'Widget' }], 'store.example')
    expect(bare?.price).toBeUndefined()
    expect(bare?.availability).toBeUndefined()
    expect(bare?.rating).toBeUndefined()
  })

  it('marks a card as third party when it links off the merchant domain', () => {
    const cards = normaliseCards(
      [
        { title: 'Ours', url: 'https://www.store.example/p/1' },
        { title: 'Theirs', url: 'https://other.example/p/1' },
      ],
      'store.example',
    )
    expect(cards[0]?.thirdParty).toBe(false)
    expect(cards[1]?.thirdParty).toBe(true)
  })

  it('strips engine tracking parameters so a URL comparison is about the page', () => {
    const [card] = normaliseCards(
      [{ title: 'Widget', url: 'https://store.example/p/1?utm_source=chatgpt&size=large' }],
      'store.example',
    )
    expect(card?.url).toBe('https://store.example/p/1?size=large')
  })

  it('drops a URL that is not http, rather than passing it to the diff', () => {
    const [card] = normaliseCards([{ title: 'Widget', url: 'not a url' }], 'store.example')
    expect(card?.url).toBeUndefined()
  })

  it('rewrites dashes in engine text, because it reaches the report', () => {
    const [card] = normaliseCards([{ title: 'Widget \u2014 Walnut' }], 'store.example')
    expect(card?.title).toBe('Widget - Walnut')
  })

  it('numbers cards in the order the engine presented them', () => {
    const cards = normaliseCards([{ title: 'A' }, { title: 'B' }, { title: 'C' }], 'store.example')
    expect(cards.map((c) => c.position)).toEqual([1, 2, 3])
  })
})

describe('normaliseCardAvailability', () => {
  it('reads the phrasings engines use, in English and German', () => {
    expect(normaliseCardAvailability('currently in stock')).toBe('in_stock')
    expect(normaliseCardAvailability('sold out')).toBe('out_of_stock')
    expect(normaliseCardAvailability('available for pre-order')).toBe('preorder')
    expect(normaliseCardAvailability('no longer available')).toBe('discontinued')
    expect(normaliseCardAvailability('nicht verfuegbar')).toBe('out_of_stock')
    expect(normaliseCardAvailability(undefined)).toBeUndefined()
  })
})

describe('rawCardListSchema', () => {
  it('rejects a card with no title, since a nameless card cannot be matched', () => {
    expect(rawCardListSchema.safeParse({ cards: [{ title: '' }] }).success).toBe(false)
  })

  it('caps the card list, so one runaway response cannot dominate a run', () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ title: `p${i}` }))
    expect(rawCardListSchema.safeParse({ cards }).success).toBe(false)
  })
})

describe('cardIdentity', () => {
  it('ignores price and position, which move for reasons that are findings', () => {
    const a = { position: 1, title: 'Widget', brand: 'North', price: 10 }
    const b = { position: 4, title: 'widget', brand: 'north', price: 99 }
    expect(cardIdentity(a)).toBe(cardIdentity(b))
  })
})
