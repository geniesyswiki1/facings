import { ENGINE_LABELS, escapeHtml } from '@facings/shared'
import { ACP, UCP } from '@facings/protocols'
import type { StoreContext } from '../context.js'
import { layout } from './layout.js'

/**
 * The Presence screen. SPEC 3.2, screen 4.
 *
 * Per surface status, the hosted endpoints, the policy editor entry point and
 * feed health. The spec asks for the specific blocker whenever a store is not
 * present, so a "no" here is never a bare no: it always carries what to fix.
 */
export function presenceScreen(context: StoreContext): string {
  const { record, eligibility, validation, feed, endpoints } = context
  const store = record.store

  const eligible = eligibility.filter((entry) => entry.eligible).length
  const errors = validation.issues.filter((issue) => issue.severity === 'error')
  const unconfirmed = validation.issues.filter((issue) => issue.severity === 'warning')

  // A manifest level warning applies to every surface that reads the manifest,
  // so listing it against each one repeats the same sentence several times on
  // one page. It is shown once, in its own section, and the per surface column
  // keeps only what is specific to that surface.
  const manifestWarnings = new Set(unconfirmed.map((issue) => `${issue.field}: ${issue.message}`))

  const body = `
    <h1>${escapeHtml(store.domain)}</h1>
    <p class="lead">
      ${eligible} of ${eligibility.length} surfaces are eligible. Eligible means the store publishes what that surface
      reads. Whether it then renders is what the daily accuracy check answers.
    </p>

    ${
      errors.length
        ? `<div class="notice">The UCP manifest does not validate: ${escapeHtml(
            errors.map((issue) => `${issue.field} ${issue.message}`).join('; '),
          )}</div>`
        : `<div class="ok-notice">The UCP manifest validates against protocol version ${escapeHtml(UCP.version)}.</div>`
    }

    <h2>Surfaces</h2>
    <table>
      <thead><tr><th style="width:18%">Surface</th><th style="width:12%">Eligible</th><th>What is blocking, and what weakens it</th></tr></thead>
      <tbody>
        ${eligibility
          .map(
            (entry) => {
            const warnings = entry.warnings.filter((warning) => !manifestWarnings.has(warning))
            return `<tr>
          <td>${escapeHtml(ENGINE_LABELS[entry.engine] ?? entry.engine)}</td>
          <td class="${entry.eligible ? 'yes' : 'no'}">${entry.eligible ? 'yes' : 'no'}</td>
          <td>
            ${
              entry.blockers.length === 0 && warnings.length === 0
                ? '<span class="muted">nothing outstanding</span>'
                : `<ul class="reasons">
                    ${entry.blockers.map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join('')}
                    ${warnings.map((warning) => `<li class="warn">${escapeHtml(warning)}</li>`).join('')}
                  </ul>`
            }
          </td>
        </tr>`
          },
          )
          .join('')}
      </tbody>
    </table>

    <h2>Hosted endpoints</h2>
    <p class="lead">
      Facings hosts these and the merchant points at them from their own domain. They are public and unauthenticated
      because agent crawlers read them without credentials.
    </p>
    ${endpointRow('UCP manifest', endpoints.ucp, `protocol ${UCP.version}`)}
    ${endpointRow('ACP product feed, JSON Lines', endpoints.acpJsonl, `feed spec ${ACP.version}`)}
    ${endpointRow('ACP product feed, CSV', endpoints.acpCsv, '')}
    ${endpointRow('Google Merchant Center supplementary feed', endpoints.gmc, 'matched on item id')}
    ${endpointRow('Microsoft Merchant Center feed', endpoints.mmc, 'for Copilot')}

    <h2>Feed health</h2>
    <p class="lead">
      ${feed.items.length} of ${record.products.length} products reached the feed.
      ${feed.exclusions.length === 0 ? 'Nothing was excluded.' : 'The rest are listed below with the reason.'}
    </p>
    ${
      feed.exclusions.length
        ? `<table>
            <thead><tr><th style="width:22%">SKU</th><th style="width:14%">Fixable</th><th>Why it is not in the feed</th></tr></thead>
            <tbody>
              ${feed.exclusions
                .map(
                  (exclusion) => `<tr>
                <td class="mono">${escapeHtml(exclusion.sku)}</td>
                <td class="${exclusion.fixable ? 'yes' : 'muted'}">${exclusion.fixable ? 'yes' : 'no'}</td>
                <td>${escapeHtml(exclusion.reason)}</td>
              </tr>`,
                )
                .join('')}
            </tbody>
          </table>`
        : ''
    }

    ${
      unconfirmed.length
        ? `<h2>Pinned, not yet confirmed</h2>
           <p class="lead">
             These apply to every surface that reads the manifest. Confirm them against the published specification
             before telling a merchant their manifest is compliant.
           </p>
           <ul class="reasons">
             ${unconfirmed
               .map(
                 (issue) =>
                   `<li class="warn"><span class="mono">${escapeHtml(
                     issue.field.replace(/^ucp\.capabilities\./, ''),
                   )}</span> ${escapeHtml(issue.message)}</li>`,
               )
               .join('')}
           </ul>`
        : ''
    }
  `

  return layout(
    {
      title: `Presence, ${store.domain}`,
      storeId: store.id,
      active: 'presence',
      meta: [
        `<strong>${escapeHtml(store.domain)}</strong>`,
        `${escapeHtml(store.market)}, ${escapeHtml(store.language)}`,
        `${escapeHtml(store.platform)}${store.psp ? `, ${escapeHtml(store.psp)}` : ''}`,
      ],
    },
    body,
  )
}

function endpointRow(label: string, url: string, note: string): string {
  return `<div class="endpoint">
    <span class="label">${escapeHtml(label)}${note ? ` <span class="muted">${escapeHtml(note)}</span>` : ''}</span>
    <a class="mono" href="${escapeHtml(url)}">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a>
  </div>`
}
