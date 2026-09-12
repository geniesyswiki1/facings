import type { Config } from '@netlify/functions'
import type Stripe from 'stripe'
import { stripe } from '../../src/stripe.js'
import { planByLookupKey, planById } from '../../src/catalogue.js'
import { store, type Entitlement, type EntitlementStatus } from '../../src/entitlement.js'

/**
 * Receives Stripe events and projects them into the entitlement store.
 *
 * This endpoint is what makes the integration correct over time. Checkout tells
 * you a subscription started; only these events tell you a renewal succeeded, a
 * card failed, or someone cancelled. Fulfilment is driven from here and never
 * from the success page, which a customer is not guaranteed to reach.
 */

const HANDLED = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

function mapStatus(status: Stripe.Subscription.Status): EntitlementStatus {
  switch (status) {
    case 'active':
      return 'active'
    case 'trialing':
      return 'trialing'
    case 'past_due':
      return 'past_due'
    default:
      // canceled, unpaid, incomplete, incomplete_expired, paused
      return 'inactive'
  }
}

/**
 * The period end lives on the subscription item in current API versions and on
 * the subscription itself in older ones. Read both so a version bump does not
 * quietly turn this into null and strand customers in a denied state.
 */
function periodEndMs(subscription: Stripe.Subscription): number | null {
  const item = subscription.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined
  const seconds =
    item?.current_period_end ?? (subscription as unknown as { current_period_end?: number }).current_period_end
  return typeof seconds === 'number' ? seconds * 1000 : null
}

function planIdFor(subscription: Stripe.Subscription): string | null {
  const lookupKey = subscription.items.data[0]?.price?.lookup_key
  if (lookupKey) {
    const plan = planByLookupKey(lookupKey)
    if (plan) return plan.id
  }
  const fromMetadata = subscription.metadata?.['plan_id']
  return fromMetadata ?? null
}

function userIdFor(subscription: Stripe.Subscription): string | null {
  return subscription.metadata?.['user_id'] ?? null
}

async function applySubscription(subscription: Stripe.Subscription, eventCreatedMs: number): Promise<void> {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  // Prefer the id we stamped at checkout; fall back to whatever we already hold
  // for this customer, so a subscription created in the Dashboard still lands.
  const existing = await store.findByCustomerId(customerId)
  const userId = userIdFor(subscription) ?? existing?.userId
  if (!userId) {
    console.warn('subscription has no user_id and no known customer; skipping', subscription.id)
    return
  }

  // Events can arrive out of order. Never let an older one overwrite a newer.
  if (existing && existing.updatedAt > eventCreatedMs) return

  const planId = planIdFor(subscription)
  const plan = planId ? planById(planId) : undefined

  const entitlement: Entitlement = {
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    planId,
    status: mapStatus(subscription.status),
    monthlyAllowance: plan?.monthlyAllowance ?? 0,
    currentPeriodEnd: periodEndMs(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    updatedAt: eventCreatedMs,
  }

  await store.put(entitlement)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  }

  const signature = req.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set; refusing to process events')
    return new Response('Not configured', { status: 500 })
  }
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  // Verify against the exact bytes Stripe signed, before parsing anything.
  const payload = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe().webhooks.constructEventAsync(payload, signature, secret)
  } catch (error) {
    console.warn('webhook signature verification failed', error)
    return new Response('Invalid signature', { status: 400 })
  }

  if (!HANDLED.has(event.type)) {
    // Acknowledge so Stripe stops retrying an event we deliberately ignore.
    return new Response('Ignored', { status: 200 })
  }

  const eventCreatedMs = event.created * 1000

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id ?? session.metadata?.['user_id']
        if (!userId || !session.subscription) break

        // The session carries only ids; fetch the subscription for its real state.
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id
        const subscription = await stripe().subscriptions.retrieve(subscriptionId)

        // Stamp the user id so every later event on this subscription resolves.
        if (!subscription.metadata?.['user_id']) {
          await stripe().subscriptions.update(subscriptionId, { metadata: { user_id: userId } })
          subscription.metadata = { ...subscription.metadata, user_id: userId }
        }

        await applySubscription(subscription, eventCreatedMs)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscription(event.data.object, eventCreatedMs)
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null }
        const ref = invoice.subscription
        if (!ref) break
        const subscriptionId = typeof ref === 'string' ? ref : ref.id
        const subscription = await stripe().subscriptions.retrieve(subscriptionId)
        await applySubscription(subscription, eventCreatedMs)
        break
      }
    }
  } catch (error) {
    // A 5xx makes Stripe retry with backoff, which is what we want for a
    // transient failure. Do not swallow it into a 200.
    console.error(`failed handling ${event.type} (${event.id})`, error)
    return new Response('Handler error', { status: 500 })
  }

  return new Response('OK', { status: 200 })
}

export const config: Config = {
  path: '/api/stripe-webhook',
}
