import { escapeHtml, formatMoney } from '@showing-up/shared'
import type { StoreContext } from '../context.js'
import { layout } from './layout.js'

/**
 * The Products screen. SPEC 3.2, screen 3.
 *
 * Per SKU feed status and attribute completeness. Phase 1 shows whether each
 * product is publishable and why not; the accuracy column arrives with the
 * daily observation in Phase 2.
 */
export function productsScreen(context: StoreContext): string {
  const { record, feed } = context
  const excluded = new Map(feed.exclusions.map((exclusion) => [exclusion.sku, exclusion]))
  const inFeed = new Set(feed.items.map((item) => item.id))

  const body = `
    <h1>Products</h1>
    <p class="lead">
      ${feed.items.length} of ${record.products.length} products are published to the feeds. A product that is not
      published cannot be rendered by any surface, so this is the first place to look when a bestseller is absent.
    </p>

    <table>
      <thead>
        <tr>
          <th style="width:18%">SKU</th>
          <th>Product</th>
          <th style="width:12%">Price</th>
          <th style="width:12%">Stock</th>
          <th style="width:12%">In feed</th>
          <th style="width:26%">Why not</th>
        </tr>
      </thead>
      <tbody>
        ${record.products
          .map((product) => {
            const exclusion = excluded.get(product.sku)
            const published = inFeed.has(product.sku)
            return `<tr>
              <td class="mono">${escapeHtml(product.sku)}</td>
              <td><a href="${escapeHtml(product.url)}">${escapeHtml(product.title)}</a></td>
              <td>${escapeHtml(formatMoney(product.price, product.currency))}</td>
              <td class="${product.availability === 'in_stock' ? '' : 'muted'}">${escapeHtml(
                product.availability.replace('_', ' '),
              )}</td>
              <td class="${published ? 'yes' : 'no'}">${published ? 'yes' : 'no'}</td>
              <td class="muted">${exclusion ? escapeHtml(exclusion.reason) : ''}</td>
            </tr>`
          })
          .join('')}
      </tbody>
    </table>
  `

  return layout(
    {
      title: `Products, ${record.store.domain}`,
      storeId: record.store.id,
      active: 'products',
      meta: [`<strong>${escapeHtml(record.store.domain)}</strong>`, `${record.products.length} SKUs`],
    },
    body,
  )
}
