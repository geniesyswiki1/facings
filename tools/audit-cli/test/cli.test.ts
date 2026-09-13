import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { panelCaptureSchema } from '@showing-up/observe'

/**
 * Smoke tests for the operator surface. The pipeline is covered end to end
 * elsewhere; what these check is that the commands an operator actually types
 * are wired to it, because a Phase 0 harness nobody can run answers nothing.
 */

const run = promisify(execFile)
const CLI = new URL('../bin/showing-up-audit.mjs', import.meta.url).pathname
const CATALOGUE = new URL('../../../fixtures/demo-catalogue.csv', import.meta.url).pathname

describe('showing-up-audit panel', () => {
  it('writes the session sheet and a capture template per surface', async () => {
    const out = await mkdtemp(join(tmpdir(), 'showing-up-cli-panel-'))
    await run(process.execPath, [CLI, 'panel', '--url', 'https://northfieldaudio.example', '--csv', CATALOGUE, '--out', out])

    const files = await readdir(out)
    expect(files).toContain('session-sheet.md')
    expect(files).toContain('capture-google-ai-mode.template.json')
    expect(files).toContain('capture-copilot.template.json')

    const sheet = await readFile(join(out, 'session-sheet.md'), 'utf8')
    expect(sheet).toContain('signed the panel consent sheet')
    expect(sheet).toContain('where can I buy Northfield AM10 Bookshelf Speaker Pair Walnut')

    const template = panelCaptureSchema.parse(JSON.parse(await readFile(join(out, 'capture-copilot.template.json'), 'utf8')))
    expect(template.sessions).toHaveLength(60)
    expect(template.consentRef).toBe('')
  }, 60_000)

  it('refuses to write a sheet with no catalogue, since the queries would be invented', async () => {
    const out = await mkdtemp(join(tmpdir(), 'showing-up-cli-panel-'))
    // Exits non zero as well as saying why, so a scripted run fails loudly.
    await expect(
      run(process.execPath, [CLI, 'panel', '--url', 'https://northfieldaudio.example', '--out', out]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('no catalogue supplied') })
  }, 60_000)
})

describe('showing-up-audit fixtures', () => {
  it('records a replay fixture for every requested surface', async () => {
    const out = await mkdtemp(join(tmpdir(), 'showing-up-cli-fix-'))
    const path = join(out, 'fixtures.json')
    await run(process.execPath, [
      CLI,
      'fixtures',
      '--url',
      'https://northfieldaudio.example',
      '--csv',
      CATALOGUE,
      '--engines',
      'openai,copilot',
      '--repeats',
      '2',
      '--out',
      path,
    ])

    const fixture = JSON.parse(await readFile(path, 'utf8'))
    expect(Object.keys(fixture.engines).sort()).toEqual(['copilot', 'openai'])
    const takes = Object.values(fixture.engines.openai as Record<string, unknown[]>)
    expect(takes).toHaveLength(20)
    expect(takes[0]).toHaveLength(2)
  }, 60_000)
})

describe('showing-up-audit run', () => {
  it('rejects an unknown surface by name instead of silently skipping it', async () => {
    await expect(
      run(process.execPath, [CLI, 'run', '--url', 'https://northfieldaudio.example', '--engines', 'bing']),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('unknown surface "bing"') })
  }, 60_000)

  it('rejects a market it has no query library for', async () => {
    // FR is on the roadmap, not in the packaged set. US, UK, DE, AT and CH are
    // packaged, so the rejection has to be checked against one that is not.
    await expect(
      run(process.execPath, [CLI, 'run', '--url', 'https://northfieldaudio.example', '--market', 'FR']),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('unknown market') })
  }, 60_000)

  it('names the packaged markets when it rejects one', async () => {
    await expect(
      run(process.execPath, [CLI, 'run', '--url', 'https://northfieldaudio.example', '--market', 'FR']),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('US, UK, DE, AT, CH') })
  }, 60_000)

  it('warns that one repeat cannot measure reproducibility', async () => {
    // Round trips the two commands an operator uses for an offline check:
    // record a fixture, then run the audit against it.
    const out = await mkdtemp(join(tmpdir(), 'showing-up-cli-run-'))
    const fixtures = join(out, 'fixtures.json')
    await run(process.execPath, [
      CLI,
      'fixtures',
      '--url',
      'https://northfieldaudio.example',
      '--csv',
      CATALOGUE,
      '--engines',
      'openai',
      '--repeats',
      '1',
      '--queries',
      '2',
      '--out',
      fixtures,
    ])

    const { stdout } = await run(process.execPath, [
      CLI,
      'run',
      '--url',
      'https://northfieldaudio.example',
      '--csv',
      CATALOGUE,
      '--engines',
      'openai',
      '--repeats',
      '1',
      '--queries',
      '2',
      '--fixtures',
      fixtures,
      '--out',
      out,
    ])
    expect(stdout).toContain('reproducibility needs at least two repeats')
    expect(stdout).toContain('not observable')
  }, 90_000)
})
