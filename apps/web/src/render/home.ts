import { ENGINE_LABELS, escapeHtml } from '@facings/shared'
import type { StoreContext } from '../context.js'
import { layout } from './layout.js'

/** Store list. The workspace switcher in SPEC 3.4 grows out of this. */
export function homeScreen(contexts: StoreContext[]): string {
  const body = `
    <h1>Stores</h1>
    <p class="lead">
      Presence hosting is live for these stores. Each one publishes a UCP manifest and a product feed that Facings
      hosts and the merchant points at from their own domain.
    </p>

    <table>
      <thead>
        <tr><th>Store</th><th style="width:14%">Market</th><th style="width:18%">Platform</th><th style="width:34%">Eligible surfaces</th></tr>
      </thead>
      <tbody>
        ${contexts
          .map((context) => {
            const eligible = context.eligibility.filter((entry) => entry.eligible)
            return `<tr>
              <td><a href="/presence/${escapeHtml(context.record.store.id)}">${escapeHtml(context.record.store.domain)}</a></td>
              <td>${escapeHtml(context.record.store.market)}</td>
              <td>${escapeHtml(context.record.store.platform)}${
                context.record.store.psp ? `, ${escapeHtml(context.record.store.psp)}` : ''
              }</td>
              <td class="${eligible.length === context.eligibility.length ? 'yes' : ''}">
                ${eligible.length} of ${context.eligibility.length}
                <span class="muted">${escapeHtml(
                  eligible.map((entry) => ENGINE_LABELS[entry.engine] ?? entry.engine).join(', '),
                )}</span>
              </td>
            </tr>`
          })
          .join('')}
      </tbody>
    </table>
  `

  return layout({ title: 'Stores', active: 'home' }, body)
}
