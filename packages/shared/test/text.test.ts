import { describe, expect, it } from 'vitest'
import { enforceDashRule, findCopyViolations, jaccard, normaliseTitle, titleTokens } from '@facings/shared'

describe('copy rules', () => {
  it('flags every banned dash, because the rule covers generated reports too', () => {
    const violations = findCopyViolations('one \u2014 two \u2013 three')
    expect(violations.filter((v) => v.rule === 'dash')).toHaveLength(2)
  })

  it('accepts hyphens', () => {
    expect(findCopyViolations('a well-known store')).toEqual([])
  })

  it('flags banned words and exclamation marks', () => {
    expect(findCopyViolations('a seamless experience').some((v) => v.rule === 'word')).toBe(true)
    expect(findCopyViolations('now live!').some((v) => v.rule === 'exclamation')).toBe(true)
  })

  it('rewrites dashes to hyphens rather than dropping the text', () => {
    expect(enforceDashRule('price \u2014 now \u2212 lower')).toBe('price - now - lower')
  })
})

describe('normaliseTitle', () => {
  it('strips accents, case, punctuation and retail noise', () => {
    expect(normaliseTitle('  NEW Café-Crème Máker, 2L! ')).toBe('cafe creme maker 2l')
  })

  it('drops single characters from the token set so they cannot carry a match', () => {
    expect([...titleTokens('a bookshelf speaker')]).toEqual(['bookshelf', 'speaker'])
  })
})

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint ones', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0)
  })

  it('treats two empty sets as agreeing, so two empty renderings are reproducible', () => {
    expect(jaccard(new Set(), new Set())).toBe(1)
  })

  it('scores partial overlap', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
  })
})
