import { readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * HTML to PDF through Chromium.
 *
 * The report is laid out in CSS so the grid stays the same object in the app,
 * the emailed PDF and the white-label agency report. Rendering is best effort:
 * if no browser is available the run still produces the HTML, the CSV and the
 * JSON, because a missing PDF must not lose an observation.
 */

export interface PdfResult {
  written: boolean
  path: string
  reason?: string
}

export async function renderPdf(html: string, outPath: string): Promise<PdfResult> {
  let chromium: typeof import('playwright').chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch (error) {
    return {
      written: false,
      path: outPath,
      reason: `playwright is not installed, so only the HTML report was written (${
        error instanceof Error ? error.message : String(error)
      })`,
    }
  }

  const launchAttempts: Array<Record<string, unknown>> = [{}]
  for (const candidate of await executableCandidates()) {
    launchAttempts.push({ executablePath: candidate })
  }

  let lastError = 'unknown launch failure'
  for (const options of launchAttempts) {
    let browser: import('playwright').Browser | undefined
    try {
      browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], ...options })
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'load' })
      // Give the webfonts a moment, then render regardless: the fallback stack
      // is metrically close enough that a missing webfont does not reflow the grid.
      await page.waitForTimeout(600)
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
      })
      await writeFile(outPath, buffer)
      await browser.close()
      return { written: true, path: outPath }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await browser?.close().catch(() => undefined)
    }
  }

  return { written: false, path: outPath, reason: `could not render the PDF: ${lastError}` }
}

/**
 * Pre-installed Chromium locations. PLAYWRIGHT_BROWSERS_PATH is honoured by
 * Playwright itself, but a version mismatch between the package and the
 * installed build needs an explicit executable path.
 */
async function executableCandidates(): Promise<string[]> {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return []

  const candidates: string[] = []
  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.startsWith('chromium')) continue
    for (const relative of [
      'chrome-linux/chrome',
      'chrome-linux/headless_shell',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const path = join(root, entry, relative)
      if (existsSync(path)) candidates.push(path)
    }
    const direct = join(root, entry)
    if (existsSync(direct) && entry === 'chromium') candidates.push(direct)
  }
  return candidates
}
