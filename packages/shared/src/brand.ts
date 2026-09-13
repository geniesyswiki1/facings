/**
 * Brand tokens from SPEC.md section 2.4. Exactly six colours and two
 * families; the report renderer may use no others.
 */
export const PALETTE = {
  /** Page background, warm grey like a shelf edge. */
  shelf: '#F5F4F0',
  /** All text. */
  ink: '#1B1D22',
  /** Borders, dividers, empty card outlines. */
  rule: '#D3D1CA',
  /** Secondary text. */
  muted: '#676A72',
  /** The one accent: buttons, links, correct cards. */
  present: '#1A6FD1',
  /** Misrepresented or missing cards only. */
  wrong: '#C0392B',
} as const

export type PaletteToken = keyof typeof PALETTE

/** Headlines and report headers. */
export const DISPLAY_FONT = "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif"
/** Interface, tables and long copy. */
export const TEXT_FONT = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif"

/** SPEC 2.2. Used verbatim wherever a positioning line is needed. */
export const POSITIONING = 'Show up, and show up correctly, when AI agents shop.'

/**
 * The logo mark: a 3x2 grid of six rounded rectangles in --rule with the
 * top-left filled in --present, followed by the wordmark. SPEC 2.4.
 */
export function logoSvg(height = 18): string {
  const cell = 5
  const gap = 2
  const w = cell * 3 + gap * 2
  const h = cell * 2 + gap
  const rects: string[] = []
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const filled = row === 0 && col === 0
      rects.push(
        `<rect x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}" rx="1.2" fill="${
          filled ? PALETTE.present : PALETTE.rule
        }"/>`,
      )
    }
  }
  const scale = height / h
  return `<svg width="${(w * scale).toFixed(1)}" height="${height}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Showing Up">${rects.join(
    '',
  )}</svg>`
}

/** Display names for engines. Used exactly and neutrally. SPEC 2.3. */
export const ENGINE_LABELS: Record<string, string> = {
  openai: 'ChatGPT',
  gemini: 'Gemini',
  'google-ai-mode': 'Google AI Mode',
  copilot: 'Copilot',
  perplexity: 'Perplexity',
  claude: 'Claude',
}
