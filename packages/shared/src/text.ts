/**
 * Copy rules from SPEC.md section 2.3, enforced in code because they apply to
 * generated reports and commit messages, not just hand-written marketing.
 */

/** Em dash, en dash, horizontal bar, figure dash, minus sign. */
const BANNED_DASHES = /[\u2012\u2013\u2014\u2015\u2212]/g

/** Words the voice never uses. SPEC 2.3. */
const BANNED_WORDS = [
  'revolutionary',
  'seamless',
  'unlock',
  'supercharge',
  'game-changing',
  'game changer',
]

export interface CopyViolation {
  rule: 'dash' | 'word' | 'exclamation'
  detail: string
  index: number
}

/**
 * Returns every copy-rule violation in a string. Used by the report renderer
 * and by the test suite, which fails the build on any violation in generated
 * output.
 */
export function findCopyViolations(input: string): CopyViolation[] {
  const violations: CopyViolation[] = []

  for (const match of input.matchAll(BANNED_DASHES)) {
    violations.push({
      rule: 'dash',
      detail: `found ${JSON.stringify(match[0])}, use a hyphen`,
      index: match.index ?? 0,
    })
  }

  const lower = input.toLowerCase()
  for (const word of BANNED_WORDS) {
    const at = lower.indexOf(word)
    if (at >= 0) violations.push({ rule: 'word', detail: `banned word "${word}"`, index: at })
  }

  const bang = input.indexOf('!')
  if (bang >= 0) violations.push({ rule: 'exclamation', detail: 'no exclamation marks', index: bang })

  return violations
}

/**
 * Replaces banned dashes with hyphens. Applied to every string that reaches a
 * merchant-facing report, including text copied out of an engine response.
 */
export function enforceDashRule(input: string): string {
  return input.replace(BANNED_DASHES, '-')
}

/** Escapes a string for inclusion in HTML text or an attribute. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Normalises a product title for identity matching: lowercase, strip
 * punctuation and accents, collapse whitespace, drop common retail noise.
 * Deliberately conservative, because a false SKU match produces a false
 * finding and a false finding costs merchant trust.
 */
export function normaliseTitle(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(new|sale|official|genuine|original|free shipping|bestseller)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Token set of a normalised title, for Jaccard style comparison. */
export function titleTokens(input: string): Set<string> {
  return new Set(normaliseTitle(input).split(' ').filter((t) => t.length > 1))
}

/**
 * Jaccard similarity of two token sets, 0 to 1. Used for both title matching
 * and reproducibility scoring.
 */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const item of a) if (b.has(item)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  return `${input.slice(0, Math.max(0, max - 3)).trimEnd()}...`
}

export function slugify(input: string): string {
  return normaliseTitle(input).replace(/\s+/g, '-').slice(0, 60) || 'untitled'
}
