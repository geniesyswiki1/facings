import {
  DISPLAY_FONT,
  ENGINE_LABELS,
  PALETTE,
  POSITIONING,
  REPRODUCIBILITY_THRESHOLD,
  TEXT_FONT,
  enforceDashRule,
  escapeHtml,
  logoSvg,
  truncate,
} from '@facings/shared'
import type { EngineId, Presence } from '@facings/shared'
import type { GridCell, ReportModel } from './model.js'

/**
 * The one-page audit report.
 *
 * SPEC 2.4: the core screen is a grid, rows are queries, columns are engines,
 * cells are the card the engine rendered or an empty outline. Six colours, two
 * families, no gradients, no shadows, no illustrations. The grid is the
 * memorable moment, so nothing else on the page competes with it.
 */

export function renderReportHtml(model: ReportModel): string {
  const store = model.manifest.store
  const date = new Date(model.generatedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const engineColumns = model.engines
  const colWidth = `${Math.floor(64 / Math.max(1, engineColumns.length))}%`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Facings audit, ${escapeHtml(store.domain)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;700&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
  /*
   * The report is one A4 page at the Phase 0 defaults of 20 queries and 6
   * surfaces. Every size below is part of that budget: the grid gets the space
   * it needs for 20 rows, and nothing else on the page is allowed to grow into
   * it. A merchant reads this once, printed or on a phone, and a report that
   * runs to three pages is a report whose first page buries the finding.
   */
  @page { size: A4 portrait; margin: 10mm 9mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${PALETTE.shelf};
    color: ${PALETTE.ink};
    font-family: ${TEXT_FONT};
    font-size: 8pt;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { width: 100%; }
  h1, h2, .display { font-family: ${DISPLAY_FONT}; font-weight: 700; margin: 0; }
  h2 { font-size: 8pt; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; color: ${PALETTE.muted}; }
  section { break-inside: avoid; }

  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1.5px solid ${PALETTE.ink}; padding-bottom: 4px; }
  .brand { display: flex; align-items: center; gap: 6px; }
  .wordmark { font-family: ${DISPLAY_FONT}; font-weight: 700; font-size: 13pt; letter-spacing: -0.01em; }
  header h1 { font-size: 11.5pt; margin-top: 2px; }
  .meta { text-align: right; color: ${PALETTE.muted}; font-size: 7pt; line-height: 1.3; }
  .meta strong { color: ${PALETTE.ink}; font-weight: 500; }

  section { margin-top: 7px; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
  .section-head .hint { color: ${PALETTE.muted}; font-size: 6.8pt; }

  .presence { display: flex; gap: 4px; }
  .tile { flex: 1; border: 1px solid ${PALETTE.rule}; padding: 3px 4px; background: transparent; min-width: 0; }
  .tile .engine { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 7.6pt; }
  .tile .state { font-size: 7pt; margin-top: 1px; }
  .tile .rates { color: ${PALETTE.muted}; font-size: 6.4pt; margin-top: 1px; }
  .state-rendering { color: ${PALETTE.present}; }
  .state-absent, .state-not_observable { color: ${PALETTE.wrong}; }
  .state-ingested { color: ${PALETTE.muted}; }

  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 7pt; text-align: left; padding: 0 2px 2px; border-bottom: 1px solid ${PALETTE.ink}; }
  table.grid th.q { width: 34%; }
  table.grid td { border-bottom: 1px solid ${PALETTE.rule}; padding: 1.5px 2px; vertical-align: middle; }
  td.q { font-size: 7pt; color: ${PALETTE.ink}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; }

  /* One line per cell. The grid's job is the shape of the problem across the
   * shelf, not the detail of one card: the detail is in the audit log. */
  .cell { border: 1px solid ${PALETTE.rule}; padding: 1px 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell .mark { font-weight: 700; font-size: 7pt; }
  .cell .name { font-size: 6.4pt; color: ${PALETTE.muted}; margin-left: 2px; }
  .cell.correct { border-color: ${PALETTE.present}; }
  .cell.correct .mark { color: ${PALETTE.present}; }
  .cell.wrong { border-color: ${PALETTE.wrong}; }
  .cell.wrong .mark, .cell.wrong .name { color: ${PALETTE.wrong}; }
  .cell.absent { border-style: dotted; }
  .cell.absent .mark { color: ${PALETTE.wrong}; }
  .cell.not_observable, .cell.error { border-style: dashed; }
  .cell.not_observable .mark, .cell.error .mark { color: ${PALETTE.muted}; font-weight: 500; }

  ol.findings { margin: 0; padding-left: 14px; }
  ol.findings li { margin-bottom: 2px; font-size: 7.8pt; }
  ol.findings li .sev { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 6.8pt; text-transform: uppercase; letter-spacing: 0.05em; color: ${PALETTE.wrong}; margin-right: 4px; }
  ol.findings li .sev.low, ol.findings li .sev.medium { color: ${PALETTE.muted}; }

  table.method { width: 100%; border-collapse: collapse; font-size: 6.8pt; }
  table.method th { text-align: left; font-weight: 500; color: ${PALETTE.muted}; border-bottom: 1px solid ${PALETTE.rule}; padding: 1px 3px; }
  table.method td { padding: 1px 3px; border-bottom: 1px solid ${PALETTE.rule}; }
  .yes { color: ${PALETTE.present}; }
  .no { color: ${PALETTE.wrong}; }

  footer { margin-top: 6px; border-top: 1px solid ${PALETTE.rule}; padding-top: 4px; color: ${PALETTE.muted}; font-size: 6.2pt; }
  footer .line { margin-bottom: 1.5px; }
  .notice { border: 1px solid ${PALETTE.wrong}; color: ${PALETTE.wrong}; padding: 2px 5px; font-size: 7pt; margin-top: 5px; }
  .positioning { font-family: ${DISPLAY_FONT}; font-weight: 500; font-size: 7.2pt; color: ${PALETTE.muted}; }
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <div class="brand">${logoSvg(14)}<span class="wordmark">facings</span></div>
      <h1>Accuracy audit, ${escapeHtml(store.domain)}</h1>
      <div class="positioning">${escapeHtml(POSITIONING)}</div>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(date)}</strong></div>
      <div>${escapeHtml(store.market)}, ${escapeHtml(store.language)}, platform ${escapeHtml(store.platform)}</div>
      <div>${model.manifest.productCount} SKUs, ${model.manifest.queryCount} queries, ${model.manifest.engines.length} surfaces</div>
      <div>run ${escapeHtml(model.manifest.runId)}</div>
    </div>
  </header>

  ${model.manifest.fixtureMode ? `<div class="notice">This run replayed recorded fixtures. It is not evidence about a live surface and must not be sent to a merchant.</div>` : ''}

  <section>
    <div class="section-head"><h2>Presence</h2><span class="hint">eligible, ingested and rendering per surface</span></div>
    <div class="presence">
      ${model.presence.map(presenceTile).join('')}
    </div>
  </section>

  <section>
    <div class="section-head"><h2>The grid</h2><span class="hint">rows are your queries, columns are the surfaces, cells are the card each one rendered</span></div>
    <table class="grid">
      <thead>
        <tr>
          <th class="q">Query</th>
          ${engineColumns.map((engine) => `<th style="width:${colWidth}">${escapeHtml(ENGINE_LABELS[engine] ?? engine)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${model.rows.map((row) => `<tr>
          <td class="q" title="${escapeHtml(enforceDashRule(row.query.text))}">${escapeHtml(enforceDashRule(row.query.text))}</td>
          ${row.cells.map(renderCell).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section>
    <div class="section-head"><h2>Three findings</h2><span class="hint">ranked by revenue at risk</span></div>
    ${
      model.headlines.length
        ? `<ol class="findings">${model.headlines
            .map(
              (headline) =>
                `<li><span class="sev ${headline.severity}">${escapeHtml(headline.severity)}</span>${escapeHtml(
                  enforceDashRule(headline.text),
                )}</li>`,
            )
            .join('')}</ol>`
        : `<p>No misrepresentation was found on the surfaces that could be observed in this run.</p>`
    }
  </section>

  <section>
    <div class="section-head"><h2>Observation method and reproducibility</h2><span class="hint">a surface below ${REPRODUCIBILITY_THRESHOLD} agreement is reported as not observable, never approximated</span></div>
    <table class="method">
      <thead><tr><th>Surface</th><th>Method</th><th>Repeats</th><th>Agreement</th><th>Observable</th><th>Note</th></tr></thead>
      <tbody>
        ${model.reproducibility
          .map(
            (entry) => `<tr>
          <td>${escapeHtml(ENGINE_LABELS[entry.engine] ?? entry.engine)}</td>
          <td>${escapeHtml(entry.method)}</td>
          <td>${entry.repeats}</td>
          <td>${entry.queriesMeasured ? (entry.rate * 100).toFixed(0) + '%' : 'not measured'}</td>
          <td class="${entry.observable ? 'yes' : 'no'}">${entry.observable ? 'yes' : 'no'}</td>
          <td>${escapeHtml(entry.note ? enforceDashRule(entry.note) : '')}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>

  <footer>
    ${model.notes.map((note) => `<div class="line">${escapeHtml(enforceDashRule(note))}</div>`).join('')}
    <div class="line">Every observation in this report is stored with its timestamp, surface, method and the raw provider response, under run ${escapeHtml(
      model.manifest.runId,
    )}. Harness version ${escapeHtml(model.manifest.harnessVersion)}.</div>
    <div class="line">Facings reports what each surface rendered at a point in time. It does not control any surface, and it does not claim a ranking or a revenue effect.</div>
  </footer>
</div>
</body>
</html>`
}

function presenceTile(presence: Presence): string {
  const label = ENGINE_LABELS[presence.engine] ?? presence.engine
  const stateText: Record<Presence['state'], string> = {
    rendering: 'rendering',
    ingested: 'ingested, no card',
    eligible: 'eligible',
    absent: 'absent',
    not_observable: 'not observable',
  }
  return `<div class="tile">
    <div class="engine">${escapeHtml(label)}</div>
    <div class="state state-${presence.state}">${escapeHtml(stateText[presence.state])}</div>
    <div class="rates">${
      presence.state === 'not_observable'
        ? escapeHtml(truncate(enforceDashRule(presence.blocker ?? ''), 60))
        : `card rate ${(presence.cardRate * 100).toFixed(0)}%, correct ${(presence.accuracyRate * 100).toFixed(0)}%`
    }</div>
  </div>`
}

const MARKS: Record<GridCell['state'], string> = {
  correct: '&#10003;',
  wrong: '&#10007;',
  absent: '&#9633;',
  not_observable: 'n/o',
  error: 'err',
}

/**
 * A cell says one thing. Correct cells carry the price the surface quoted,
 * which is the fact a merchant checks first; wrong cells carry what is wrong
 * with them. The product title is not repeated down a column, because reading
 * the same title twenty times tells the reader nothing the row label did not.
 */
function renderCell(cell: GridCell): string {
  const mark = MARKS[cell.state]
  // A wrong cell carries the fault, not the number: appending the price
  // pushes the label out of the cell, and the reader loses the one word that
  // tells them what to fix. The number is in the drawer and in the audit log.
  const detail =
    cell.state === 'correct'
      ? (cell.price ?? '')
      : cell.state === 'wrong'
        ? (cell.issue ?? '')
        : cell.issue
          ? truncate(cell.issue, 18)
          : ''

  const title = [cell.title, cell.price, cell.issue].filter(Boolean).join(', ')
  return `<td><div class="cell ${cell.state}"${title ? ` title="${escapeHtml(enforceDashRule(title))}"` : ''}>
    <span class="mark">${mark}</span>${detail ? `<span class="name">${escapeHtml(enforceDashRule(detail))}</span>` : ''}
  </div></td>`
}
