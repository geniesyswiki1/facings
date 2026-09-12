import { escapeHtml } from '@facings/shared'
import { policyGaps, catalogueHasSizes, type Policy } from '@facings/protocols'
import type { StoreContext } from '../context.js'
import { layout } from './layout.js'

/**
 * The policy editor. SPEC 3.1, job 1: policies generated from a guided form
 * and published as structured data.
 *
 * Guided means the form states what each answer lets an agent do, because the
 * merchant is not filling in a compliance form for its own sake: a returns
 * window is here so an agent can answer "can I send it back", and saying so
 * next to the field is what gets it filled in accurately.
 */
export function policiesScreen(context: StoreContext, options: { writable: boolean; saved?: boolean; error?: string }): string {
  const { record } = context
  const policy = record.policy
  const gaps = policyGaps(policy, { needsSizing: catalogueHasSizes(record.products) })
  const blockers = gaps.filter((gap) => gap.severity === 'blocker')
  const recommended = gaps.filter((gap) => gap.severity === 'recommended')

  const deliveryRows = [...(policy?.delivery ?? []), emptyDelivery()]

  const body = `
    <h1>Policies</h1>
    <p class="lead">
      These are published as structured data alongside the product feed. Each one answers a question a shopper asks an
      agent, and an unanswered question is a reason to recommend somebody else.
    </p>

    ${options.saved ? '<div class="ok-notice">Saved. The feeds and the manifest now carry these values.</div>' : ''}
    ${options.error ? `<div class="notice">${escapeHtml(options.error)}</div>` : ''}
    ${
      options.writable
        ? ''
        : `<div class="notice">
            This deployment has no storage connected, so edits cannot be saved. Connect Netlify Blobs or the Supabase
            project to persist a policy. The form below shows what is published today.
          </div>`
    }

    ${
      blockers.length
        ? `<div class="notice">
            ${blockers.length} unanswered ${blockers.length === 1 ? 'question is' : 'questions are'} blocking eligibility:
            <ul class="reasons">${blockers.map((gap) => `<li>${escapeHtml(gap.consequence)}</li>`).join('')}</ul>
          </div>`
        : ''
    }

    <form method="post" action="/api/policy/${escapeHtml(record.store.id)}">
      <fieldset>
        <legend>Returns</legend>
        <div class="row">
          <label>
            <span>Window in days. An agent states this when a shopper asks about sending it back.</span>
            <input name="returns.windowDays" type="number" min="0" max="365" required value="${escapeHtml(
              String(policy?.returns.windowDays ?? 30),
            )}">
          </label>
          <label>
            <span>Who pays return postage</span>
            <select name="returns.returnShippingPaidBy">
              ${option('merchant', 'The merchant', policy?.returns.returnShippingPaidBy)}
              ${option('customer', 'The customer', policy?.returns.returnShippingPaidBy)}
            </select>
          </label>
        </div>
        <label>
          <span>Returns policy page</span>
          <input name="returns.url" type="url" required value="${escapeHtml(policy?.returns.url ?? '')}" placeholder="https://">
        </label>
      </fieldset>

      <fieldset>
        <legend>Delivery promise by country</legend>
        ${deliveryRows
          .map(
            (promise, index) => `<div class="row">
          <label>
            <span>Country</span>
            <input name="delivery.${index}.country" maxlength="2" value="${escapeHtml(promise.country)}" placeholder="DE">
          </label>
          <label>
            <span>Fastest, days</span>
            <input name="delivery.${index}.minDays" type="number" min="0" max="90" value="${escapeHtml(String(promise.minDays))}">
          </label>
          <label>
            <span>Slowest, days</span>
            <input name="delivery.${index}.maxDays" type="number" min="0" max="90" value="${escapeHtml(String(promise.maxDays))}">
          </label>
          <label>
            <span>Cost, 0 for free</span>
            <input name="delivery.${index}.cost" type="number" min="0" step="0.01" value="${escapeHtml(String(promise.cost))}">
          </label>
          <label>
            <span>Currency</span>
            <input name="delivery.${index}.currency" maxlength="3" value="${escapeHtml(promise.currency)}" placeholder="EUR">
          </label>
        </div>`,
          )
          .join('')}
      </fieldset>

      <fieldset>
        <legend>VAT in this market</legend>
        <div class="row">
          <label>
            <span>Do displayed prices include VAT? EU consumer law expects yes.</span>
            <select name="vat.pricesIncludeVat">
              ${option('true', 'Yes, prices include VAT', String(policy?.vat.pricesIncludeVat ?? ''))}
              ${option('false', 'No, VAT is added at checkout', String(policy?.vat.pricesIncludeVat ?? ''))}
            </select>
          </label>
          <label>
            <span>Standard rate, percent</span>
            <input name="vat.ratePct" type="number" min="0" max="100" step="0.1" value="${escapeHtml(
              String(policy?.vat.ratePct ?? ''),
            )}">
          </label>
          <label>
            <span>VAT registration, optional</span>
            <input name="vat.registrationNumber" value="${escapeHtml(policy?.vat.registrationNumber ?? '')}">
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Warranty</legend>
        <div class="row">
          <label>
            <span>Months</span>
            <input name="warranty.months" type="number" min="0" max="600" value="${escapeHtml(
              String(policy?.warranty?.months ?? ''),
            )}">
          </label>
          <label>
            <span>What it covers, one sentence</span>
            <input name="warranty.summary" maxlength="300" value="${escapeHtml(policy?.warranty?.summary ?? '')}">
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Published pages</legend>
        <div class="row">
          <label>
            <span>Privacy policy</span>
            <input name="privacyPolicyUrl" type="url" required value="${escapeHtml(policy?.privacyPolicyUrl ?? '')}" placeholder="https://">
          </label>
          <label>
            <span>Terms</span>
            <input name="termsUrl" type="url" required value="${escapeHtml(policy?.termsUrl ?? '')}" placeholder="https://">
          </label>
        </div>
      </fieldset>

      <button type="submit"${options.writable ? '' : ' disabled'}>Publish policies</button>
    </form>

    ${
      recommended.length
        ? `<h2>Worth answering</h2>
           <ul class="reasons">${recommended.map((gap) => `<li class="warn">${escapeHtml(gap.consequence)}</li>`).join('')}</ul>`
        : ''
    }
  `

  return layout(
    {
      title: `Policies, ${record.store.domain}`,
      storeId: record.store.id,
      active: 'policies',
      meta: [
        `<strong>${escapeHtml(record.store.domain)}</strong>`,
        policy ? `updated ${escapeHtml(policy.updatedAt.slice(0, 10))}` : 'never published',
      ],
    },
    body,
  )
}

function option(value: string, label: string, current: string | undefined): string {
  return `<option value="${escapeHtml(value)}"${String(current) === value ? ' selected' : ''}>${escapeHtml(label)}</option>`
}

function emptyDelivery(): Policy['delivery'][number] {
  return { country: '', minDays: 0, maxDays: 0, cost: 0, currency: '' }
}
