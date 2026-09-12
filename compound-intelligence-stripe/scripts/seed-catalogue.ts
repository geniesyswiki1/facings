/**
 * Creates the Products and Prices in the catalogue, idempotently.
 *
 * Run against a sandbox first:
 *   STRIPE_SECRET_KEY=rk_test_... npm run seed
 *
 * Prices are immutable in Stripe. When an amount changes, this creates a new
 * Price, moves the lookup key onto it, and deactivates the old one; existing
 * subscribers stay on the price they signed up at, which is the behaviour you
 * want, and new checkouts resolve to the new one.
 */

import { stripe, isTestMode } from '../src/stripe.js'
import { PLANS, CURRENCY, TAX_CODE, type Plan, type PlanPrice } from '../src/catalogue.js'

async function upsertProduct(plan: Plan): Promise<string> {
  const found = await stripe().products.search({
    query: `metadata['plan_id']:'${plan.id}'`,
    limit: 1,
  })

  const existing = found.data[0]
  if (existing) {
    await stripe().products.update(existing.id, {
      name: plan.name,
      description: plan.description,
      // Managed Payments refuses to sell a product without an eligible tax code.
      tax_code: TAX_CODE,
      metadata: { plan_id: plan.id, monthly_allowance: String(plan.monthlyAllowance) },
    })
    console.log(`  product ${plan.name} - updated (${existing.id})`)
    return existing.id
  }

  const created = await stripe().products.create({
    name: plan.name,
    description: plan.description,
    tax_code: TAX_CODE,
    metadata: { plan_id: plan.id, monthly_allowance: String(plan.monthlyAllowance) },
  })
  console.log(`  product ${plan.name} - created (${created.id})`)
  return created.id
}

async function upsertPrice(productId: string, price: PlanPrice): Promise<void> {
  const found = await stripe().prices.list({ lookup_keys: [price.lookupKey], active: true, limit: 1 })
  const existing = found.data[0]

  const matches =
    existing &&
    existing.unit_amount === price.unitAmount &&
    existing.currency === CURRENCY &&
    existing.recurring?.interval === price.interval &&
    existing.product === productId

  if (matches) {
    console.log(`    price ${price.lookupKey} - unchanged`)
    return
  }

  await stripe().prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: price.unitAmount,
    recurring: { interval: price.interval },
    lookup_key: price.lookupKey,
    // Moves the lookup key off the old price so it resolves here from now on.
    transfer_lookup_key: true,
  })

  if (existing) {
    await stripe().prices.update(existing.id, { active: false })
    console.log(`    price ${price.lookupKey} - replaced (old ${existing.id} deactivated)`)
  } else {
    console.log(`    price ${price.lookupKey} - created`)
  }
}

async function main(): Promise<void> {
  if (!isTestMode()) {
    console.warn('\n  ⚠  STRIPE_SECRET_KEY is a LIVE key. This will change your real catalogue.')
    console.warn('     Ctrl-C now unless that is what you intend. Continuing in 5s…\n')
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }

  console.log(`Seeding catalogue (${isTestMode() ? 'sandbox' : 'LIVE'})\n`)

  for (const plan of PLANS) {
    const productId = await upsertProduct(plan)
    for (const price of plan.prices) {
      await upsertPrice(productId, price)
    }
  }

  console.log('\nDone.')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
