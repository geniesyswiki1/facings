import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '@facings/shared'

/**
 * SPEC 2.3 puts the dash rule on everything, "including generated reports and
 * commit messages". A rule that only a person remembers is a rule that ends up
 * in a merchant's PDF, so it is checked here across the repository's own
 * tracked text as well.
 */

const TEXT_FILE = /\.(ts|tsx|md|json|csv|html|css|yml|yaml)$/
const EXCLUDED = /^package-lock\.json$/

function trackedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  return output
    .split('\n')
    .filter((path) => path && TEXT_FILE.test(path) && !EXCLUDED.test(path))
}

describe('the repository copy rules', () => {
  const files = trackedTextFiles()

  it('finds files to check, so a broken glob cannot pass this silently', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('uses hyphens everywhere, never an em dash or an en dash', () => {
    const offenders: string[] = []
    for (const path of files) {
      const violations = findCopyViolations(readFileSync(path, 'utf8')).filter((v) => v.rule === 'dash')
      if (violations.length) offenders.push(`${path}: ${violations.length}`)
    }
    expect(offenders).toEqual([])
  })
})
