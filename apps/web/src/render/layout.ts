import { DISPLAY_FONT, PALETTE, POSITIONING, TEXT_FONT, escapeHtml, logoSvg } from '@facings/shared'

/**
 * The app shell. Same six colours and two families as the audit report, per
 * SPEC 2.4, so the PDF a merchant is sent and the screen they log in to read
 * as one product rather than two.
 */

export interface LayoutOptions {
  title: string
  storeId?: string
  active?: 'presence' | 'products' | 'policies' | 'home'
  /** Rendered into the header, right aligned. */
  meta?: string[]
}

export function layout(options: LayoutOptions, body: string): string {
  const nav = options.storeId
    ? [
        { href: `/presence/${options.storeId}`, label: 'Presence', key: 'presence' as const },
        { href: `/products/${options.storeId}`, label: 'Products', key: 'products' as const },
        { href: `/policies/${options.storeId}`, label: 'Policies', key: 'policies' as const },
      ]
    : []

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} | Facings</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;700&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${PALETTE.shelf};
    color: ${PALETTE.ink};
    font-family: ${TEXT_FONT};
    font-size: 15px;
    line-height: 1.5;
  }
  a { color: ${PALETTE.present}; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }

  header.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; border-bottom: 2px solid ${PALETTE.ink}; padding-bottom: 10px; }
  .brand { display: flex; align-items: center; gap: 8px; }
  .wordmark { font-family: ${DISPLAY_FONT}; font-weight: 700; font-size: 22px; }
  .tagline { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 13px; color: ${PALETTE.muted}; margin-top: 2px; }
  .meta { text-align: right; color: ${PALETTE.muted}; font-size: 13px; }
  .meta strong { color: ${PALETTE.ink}; font-weight: 500; }

  nav { display: flex; gap: 2px; margin-top: 14px; }
  nav a { display: block; padding: 7px 14px; border: 1px solid ${PALETTE.rule}; border-bottom: none; text-decoration: none; color: ${PALETTE.muted}; font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 14px; }
  nav a.on { color: ${PALETTE.ink}; border-color: ${PALETTE.ink}; background: transparent; }
  nav + section { border-top: 1px solid ${PALETTE.rule}; padding-top: 18px; }

  h1 { font-family: ${DISPLAY_FONT}; font-weight: 700; font-size: 24px; margin: 18px 0 2px; }
  h2 { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: ${PALETTE.muted}; margin: 26px 0 8px; }
  p.lead { color: ${PALETTE.muted}; margin: 0 0 18px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 13px; color: ${PALETTE.muted}; border-bottom: 1px solid ${PALETTE.ink}; padding: 6px 8px; }
  td { border-bottom: 1px solid ${PALETTE.rule}; padding: 8px; vertical-align: top; font-size: 14px; }

  .yes { color: ${PALETTE.present}; font-weight: 500; }
  .no { color: ${PALETTE.wrong}; font-weight: 500; }
  .muted { color: ${PALETTE.muted}; }
  ul.reasons { margin: 4px 0 0; padding-left: 16px; }
  ul.reasons li { font-size: 13px; margin-bottom: 3px; }
  ul.reasons li.warn { color: ${PALETTE.muted}; }

  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .endpoint { display: flex; justify-content: space-between; gap: 12px; align-items: center; border: 1px solid ${PALETTE.rule}; padding: 8px 10px; margin-bottom: 6px; flex-wrap: wrap; }
  .endpoint .label { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 13px; }

  form { border: 1px solid ${PALETTE.rule}; padding: 16px; }
  fieldset { border: none; border-top: 1px solid ${PALETTE.rule}; padding: 12px 0 0; margin: 0 0 16px; }
  legend { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: ${PALETTE.muted}; padding-right: 8px; }
  label { display: block; font-size: 13px; margin-bottom: 10px; }
  label span { display: block; color: ${PALETTE.muted}; margin-bottom: 3px; }
  input, select { font-family: ${TEXT_FONT}; font-size: 14px; padding: 6px 8px; border: 1px solid ${PALETTE.rule}; background: transparent; color: ${PALETTE.ink}; width: 100%; max-width: 420px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; }
  .row label { flex: 1; min-width: 150px; }
  button { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 14px; padding: 9px 18px; border: 1px solid ${PALETTE.present}; background: ${PALETTE.present}; color: ${PALETTE.shelf}; cursor: pointer; }
  button:disabled { background: transparent; color: ${PALETTE.muted}; border-color: ${PALETTE.rule}; cursor: not-allowed; }

  .notice { border: 1px solid ${PALETTE.wrong}; color: ${PALETTE.wrong}; padding: 8px 12px; margin-bottom: 16px; font-size: 14px; }
  .ok-notice { border: 1px solid ${PALETTE.present}; color: ${PALETTE.present}; padding: 8px 12px; margin-bottom: 16px; font-size: 14px; }
  footer { margin-top: 40px; border-top: 1px solid ${PALETTE.rule}; padding-top: 12px; color: ${PALETTE.muted}; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="brand">${logoSvg(20)}<span class="wordmark">facings</span></div>
      <div class="tagline">${escapeHtml(POSITIONING)}</div>
    </div>
    <div class="meta">${(options.meta ?? []).map((line) => `<div>${line}</div>`).join('')}</div>
  </header>
  ${
    nav.length
      ? `<nav>${nav
          .map((item) => `<a href="${item.href}" class="${options.active === item.key ? 'on' : ''}">${item.label}</a>`)
          .join('')}</nav>`
      : ''
  }
  <section>
${body}
  </section>
  <footer>
    Facings reports what each surface rendered at a point in time. It does not control any surface, and it does not
    claim a ranking or a revenue effect.
  </footer>
</div>
</body>
</html>`
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
