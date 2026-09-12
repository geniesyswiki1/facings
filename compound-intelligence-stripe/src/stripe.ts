import Stripe from 'stripe'

/**
 * The API version this integration is written against. Pinning it means a
 * Stripe-side upgrade can never change behaviour under us; bumping it is a
 * deliberate change with its own review. See `upgrade-stripe` for the process.
 */
export const API_VERSION = '2026-08-26.dahlia'

/**
 * Tags Checkout Sessions so flows can be compared in the Dashboard. The
 * convention is a label plus a suffix of eight random letters, fixed per
 * deployment rather than generated per session.
 */
export const INTEGRATION_IDENTIFIER = 'ci-subscribe-qkzrwmtv'

let client: Stripe | undefined

/**
 * The secret lives only in the environment. Read it lazily so that importing
 * this module in a context without credentials (a test, a build step) does not
 * throw, and so a missing key fails loudly at the call site instead of silently
 * producing an unauthenticated client.
 */
export function stripe(): Stripe {
  if (client) return client

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it in Netlify under Site configuration > ' +
        'Environment variables. Use a restricted key (rk_) scoped to Checkout ' +
        'Sessions, Customers, Subscriptions and Invoices.',
    )
  }

  if (key.startsWith('pk_')) {
    throw new Error(
      'STRIPE_SECRET_KEY holds a publishable key (pk_). Publishable keys are for ' +
        'client-side code and cannot create sessions. Use a restricted key (rk_).',
    )
  }

  client = new Stripe(key, { apiVersion: API_VERSION })
  return client
}

/** True when the configured key targets a sandbox or test mode rather than live. */
export function isTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? '').includes('_test_')
}
