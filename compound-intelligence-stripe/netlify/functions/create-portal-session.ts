import type { Config } from '@netlify/functions'
import { stripe } from '../../src/stripe.js'
import { store } from '../../src/entitlement.js'

/**
 * Returns a Customer Portal URL.
 *
 * The portal is Stripe-hosted and handles upgrades, downgrades, cancellation,
 * card updates and invoice history. Building that UI is weeks of work for a
 * worse result; configure it once in the Dashboard and redirect to it.
 */

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } })
  }

  let userId: unknown
  try {
    ;({ userId } = (await req.json()) as { userId?: unknown })
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    return Response.json({ error: 'userId is required.' }, { status: 400 })
  }

  // In production, take the user from the verified session rather than the
  // request body - otherwise anyone can open anyone else's billing portal.
  const entitlement = await store.get(userId)
  if (!entitlement) {
    return Response.json({ error: 'No subscription found for this account.' }, { status: 404 })
  }

  const siteUrl = process.env.SITE_URL
  if (!siteUrl) {
    return Response.json({ error: 'SITE_URL is not configured.' }, { status: 500 })
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: entitlement.stripeCustomerId,
      return_url: `${siteUrl}/account`,
    })
    return Response.json({ url: session.url })
  } catch (error) {
    console.error('create-portal-session failed', error)
    return Response.json({ error: 'Could not open the billing portal.' }, { status: 502 })
  }
}

export const config: Config = {
  path: '/api/portal',
}
