/**
 * Entitlement: what the app checks before letting someone generate.
 *
 * Stripe is the source of truth for *billing*. It is not the source of truth
 * for *access* - an app that calls Stripe on every request is slow and breaks
 * when Stripe is unreachable. Webhooks project billing state into this store,
 * and the app reads only this.
 */

export type EntitlementStatus =
  /** Paid and current. */
  | 'active'
  /** In a trial that has not yet converted. */
  | 'trialing'
  /** Payment failed; Stripe is retrying. Keep access during the grace window. */
  | 'past_due'
  /** Ended, by cancellation or by exhausted retries. No access. */
  | 'inactive'

export interface Entitlement {
  /** Your user identifier, carried through Checkout as client_reference_id. */
  readonly userId: string
  readonly stripeCustomerId: string
  readonly stripeSubscriptionId: string | null
  readonly planId: string | null
  readonly status: EntitlementStatus
  readonly monthlyAllowance: number
  /** Epoch ms when the paid period ends. Access is denied after this if inactive. */
  readonly currentPeriodEnd: number | null
  /** Set when the customer has asked to cancel but the period has not yet ended. */
  readonly cancelAtPeriodEnd: boolean
  /** Guards against applying an older webhook after a newer one. */
  readonly updatedAt: number
}

export interface EntitlementStore {
  get(userId: string): Promise<Entitlement | null>
  findByCustomerId(stripeCustomerId: string): Promise<Entitlement | null>
  put(entitlement: Entitlement): Promise<void>
}

/**
 * Development store. Serverless functions do not share memory between
 * invocations, so this survives nothing - it exists so the integration runs
 * end to end locally before a real store is wired in.
 *
 * Replace with your database. The contract above is all that is required.
 */
export class InMemoryEntitlementStore implements EntitlementStore {
  readonly #byUser = new Map<string, Entitlement>()

  async get(userId: string): Promise<Entitlement | null> {
    return this.#byUser.get(userId) ?? null
  }

  async findByCustomerId(stripeCustomerId: string): Promise<Entitlement | null> {
    for (const entitlement of this.#byUser.values()) {
      if (entitlement.stripeCustomerId === stripeCustomerId) return entitlement
    }
    return null
  }

  async put(entitlement: Entitlement): Promise<void> {
    this.#byUser.set(entitlement.userId, entitlement)
  }
}

/** Swap this for the real store when one exists. */
export const store: EntitlementStore = new InMemoryEntitlementStore()

/** Whether this entitlement currently permits use of the paid features. */
export function hasAccess(entitlement: Entitlement | null): boolean {
  if (!entitlement) return false
  if (entitlement.status === 'active' || entitlement.status === 'trialing') return true
  // Stripe is still retrying: keep access until the period actually ends, so a
  // temporary card failure does not lock a paying customer out mid-month.
  if (entitlement.status === 'past_due') {
    return entitlement.currentPeriodEnd !== null && entitlement.currentPeriodEnd > Date.now()
  }
  return false
}
