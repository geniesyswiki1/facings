# Compound Intelligence - Stripe integration

Subscription billing for the AI-native mobile apps and the web presence at
compound-intelligence.netlify.app.

> **This directory does not belong to Facings.** It was scaffolded here because
> it was the repository open at the time. It is self-contained - its own
> `package.json`, `tsconfig.json` and dependencies, outside the root npm
> workspaces and outside the root `tsconfig`/`vitest` globs - so it can be moved
> to its own repository by copying the folder. It follows the standing decision
> in the repository root `CLAUDE.md`: every app takes its own revenue through
> Stripe managed payments, with Stripe as merchant of record.

The architecture and the reasoning behind it are in the
[integration plan](https://claude.ai/code/artifact/8539801c-0900-4c68-86bd-81964ca611d3).

## Before anything else: the store-policy constraint

For digital products, content and subscriptions, an iOS app may link out to a
Stripe-hosted payment page **only in the United States and the EEA**. In every
other region Apple's In-App Purchase is mandatory and this integration cannot be
used for the app subscription.

That is a territory decision, not a technical one, and it has to be made before
step 6 below. Nothing in this code is region-aware yet.

## What is here

| Path | What it does |
| --- | --- |
| `src/catalogue.ts` | The plan tiers. One Stripe Product per tier; monthly and annual Prices on each |
| `src/stripe.ts` | Client factory. Pins the API version, rejects a publishable key used as a secret |
| `src/entitlement.ts` | What the app checks before letting someone generate. Stripe is truth for billing, this is truth for access |
| `netlify/functions/create-checkout-session.ts` | `POST /api/checkout` - starts a subscription |
| `netlify/functions/create-portal-session.ts` | `POST /api/portal` - opens the Customer Portal |
| `netlify/functions/stripe-webhook.ts` | `POST /api/stripe-webhook` - projects billing events into entitlement |
| `scripts/seed-catalogue.ts` | Creates Products and Prices, idempotently |

## Setup

```bash
npm install
cp .env.example .env          # fill in from a sandbox, never a live key
```

Create a sandbox and seed the catalogue:

```bash
stripe sandbox create          # or create one from the Dashboard
npm run seed                   # idempotent; safe to re-run
```

Run the webhook locally. `stripe listen` prints a signing secret - put it in
`.env` as `STRIPE_WEBHOOK_SECRET`:

```bash
npm run listen
netlify dev                    # in another terminal
```

Then drive a real subscription through it:

```bash
curl -X POST localhost:8888/api/checkout \
  -H 'content-type: application/json' \
  -d '{"lookupKey":"ci_pro_monthly","userId":"user_123","email":"you@example.com"}'
```

Open the returned URL, pay with `4242 4242 4242 4242`, and watch the webhook
terminal for `checkout.session.completed` followed by
`customer.subscription.created`.

## Two things that are not done

**Entitlement is in-memory.** `src/entitlement.ts` ships an
`InMemoryEntitlementStore` so the integration runs end to end today. Serverless
functions share no memory between invocations, so it survives nothing. Implement
the `EntitlementStore` interface against your database and swap the exported
`store`. That interface is the only contract the rest of the code depends on.

**The portal trusts the request body.** `create-portal-session.ts` takes
`userId` from the caller. Take it from your verified auth session instead, or
anyone can open anyone else's billing portal. It is marked in the file.

## Decisions worth knowing

- **No `payment_method_types`.** Omitted deliberately so Stripe picks methods
  dynamically. Hardcoding `['card']` removes Apple Pay and Google Pay, which is
  the wrong trade on a mobile-first product.
- **Prices resolved by `lookup_key`,** not hardcoded price ids, so a price
  change is a catalogue operation rather than a code deploy.
- **Stripe is merchant of record.** `managed_payments: { enabled: true }` on
  the Checkout Session. Stripe calculates, collects, files and remits indirect
  tax in 80+ countries, and absorbs fraud, disputes and transaction-level
  support. No tax registrations of our own, and `automatic_tax` must not be
  sent - Managed Payments rejects it along with `payment_method_types`,
  `tax_id_collection`, the shipping parameters, `invoice_creation` and the
  Connect fields. Dynamic payment methods and Adaptive Pricing are always on.
- **Every Product carries a tax code.** `txcd_10105001`, AI as a Service,
  personal use. Managed Payments will not sell a Product without an eligible
  code, and the code decides how the sale is taxed in each jurisdiction.
- **Flat tiers with capped allowances, not metering.** Current Stripe guidance
  routes new usage-based billing to Metronome rather than the Billing Meters
  API. Caps are a pricing decision you can change; a metering pipeline is an
  architecture you maintain. Revisit once there is real usage data to price
  against.
- **Webhook returns 5xx on handler failure,** so Stripe retries with backoff.
  Swallowing errors into a 200 loses the event permanently.
- **Events carry `created`,** and handlers refuse to apply one older than the
  state they already hold. Webhook delivery is not ordered.

## Going live

1. Pass Stripe's Managed Payments eligibility review and accept the Managed
   Payments terms in the Dashboard. Access is not self-serve, and nothing below
   works until it is granted.
2. Create the webhook endpoint in the live Dashboard; use *its* signing secret.
3. Mint a live restricted key. Set both in Netlify environment variables.
4. Run `npm run seed` against live once, to create the real catalogue.
5. Configure the Customer Portal in the Dashboard - it is off until you do.

## What Managed Payments will not cover

Managed Payments is digital products only, and the exclusions are explicit.
These parts of the business need a different route:

| Revenue | Eligible | Route |
| --- | --- | --- |
| App subscriptions | Yes | This integration |
| Client and agency app development | **No** | Standard Stripe Invoicing. "Professional services, such as consulting, marketing, design, development" are excluded by name, and the tax liability stays with us |
| Anything in person | **No** | Terminal, which Managed Payments does not touch. "Live in-person events" are excluded |

A product also has to be fully automated. A service involving human
intervention, such as live one-to-one coaching, does not qualify.

Customers see **Link** as the merchant of record on the checkout page, on
receipts and in post-purchase support, not Compound Intelligence. That is the
trade for Stripe carrying the tax and dispute liability.
