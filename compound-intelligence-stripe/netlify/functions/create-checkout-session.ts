import type { Config } from '@netlify/functions'
import { stripe, INTEGRATION_IDENTIFIER } from '../../src/stripe.js'
import { ALL_LOOKUP_KEYS, planByLookupKey } from '../../src/catalogue.js'

/**
 * Creates a Checkout Session for a subscription and returns its URL.
 *
 * This has to run server-side: it uses the secret key. The browser and the
 * mobile apps call it, then redirect to the URL it returns.
 */

interface CheckoutRequest {
  /** One of the catalogue lookup keys, e.g. "ci_pro_monthly". */
  lookupKey?: unknown
  /** Your user's id. Comes back on the webhook as client_reference_id. */
  userId?: unknown
  /** Prefills Checkout so the customer does not retype it. */
  email?: unknown
}

const TRIAL_DAYS = 7

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }

  let body: CheckoutRequest
  try {
    body = (await req.json()) as CheckoutRequest
  } catch {
    return badRequest('Body must be JSON.')
  }

  const { lookupKey, userId, email } = body

  if (typeof lookupKey !== 'string' || !ALL_LOOKUP_KEYS.includes(lookupKey)) {
    return badRequest(`lookupKey must be one of: ${ALL_LOOKUP_KEYS.join(', ')}`)
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    return badRequest('userId is required so the subscription can be tied to an account.')
  }
  if (email !== undefined && typeof email !== 'string') {
    return badRequest('email must be a string when provided.')
  }

  const plan = planByLookupKey(lookupKey)
  if (!plan) return badRequest('Unknown plan.')

  const siteUrl = process.env.SITE_URL
  if (!siteUrl) {
    return Response.json(
      { error: 'SITE_URL is not configured.' },
      { status: 500 },
    )
  }

  try {
    const client = stripe()

    // Resolve the Price by its lookup key rather than hardcoding a price id, so
    // changing a price is a catalogue operation and not a code deploy.
    const prices = await client.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    })
    const price = prices.data[0]
    if (!price) {
      return Response.json(
        { error: `No active price found for "${lookupKey}". Run the seed script first.` },
        { status: 500 },
      )
    }

    const session = await client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],

      // Stripe acts as merchant of record: it calculates, collects, files and
      // remits indirect tax in 80+ countries, and takes on fraud, disputes and
      // transaction-level support. Only new subscriptions started through a
      // Managed Payments session are covered; existing ones cannot be migrated.
      managed_payments: { enabled: true },

      // Managed Payments controls several parameters and rejects them if sent:
      // automatic_tax, tax_id_collection, subscription_data.default_tax_rates,
      // payment_method_types, payment_method_options,
      // payment_method_configuration, adaptive_pricing, customer_update[name],
      // customer_update[address], shipping_address_collection, shipping_options,
      // invoice_creation, subscription_data.invoice_settings, and the Connect
      // fields. None are set here, deliberately. Dynamic payment methods and
      // Adaptive Pricing are always on, so wallets are covered without asking.

      client_reference_id: userId,
      ...(email ? { customer_email: email } : {}),

      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { user_id: userId, plan_id: plan.id },
      },
      metadata: { user_id: userId, plan_id: plan.id },

      allow_promotion_codes: true,
      integration_identifier: INTEGRATION_IDENTIFIER,

      success_url: `${siteUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing`,
    })

    if (!session.url) {
      return Response.json({ error: 'Stripe returned a session without a URL.' }, { status: 502 })
    }

    return Response.json({ url: session.url, sessionId: session.id })
  } catch (error) {
    // Never return the raw Stripe error: it can carry account detail.
    console.error('create-checkout-session failed', error)
    return Response.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
}

export const config: Config = {
  path: '/api/checkout',
}
