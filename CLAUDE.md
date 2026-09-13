# Showing Up: working notes for Claude

Read [SPEC.md](SPEC.md) for the product. This file holds the standing decisions
and the constraints that are easy to break by accident.

## Payments and billing

**Every app we build takes its own revenue through Stripe managed payments.**
Not Lemon Squeezy, not Paddle, not Gumroad. Stripe is the merchant of record,
which is what covers EU VAT registration and remittance. This applies to
Showing Up and to every future product, so default to it without asking.

Two different things both involve payment providers, and conflating them undoes
the whole product thesis. Keep them apart:

1. **Our billing rail.** How Showing Up charges merchants for a subscription.
   Stripe managed payments. Always.
2. **A merchant's own payment provider.** Adyen, Mollie, Worldpay,
   Checkout.com, Stripe, anything. Showing Up is deliberately **provider
   agnostic** here, and that is the wedge: Stripe's own Agentic Commerce Suite
   serves Stripe merchants only, so everyone else is unserved. Never narrow
   this to Stripe, and never describe Showing Up as needing a merchant to be on
   Stripe. SPEC 1 and SPEC 3.1 job 1 carry the positioning.

## Copy rules that are enforced, not aspirational

From SPEC 2.3, and a test in `packages/shared/test/repo-copy-rules.test.ts`
fails the build on the first two:

- Hyphens only. Never an em dash or an en dash, anywhere: source, docs,
  generated reports, commit messages. Write them as `\uXXXX` escapes when code
  has to name the characters.
- No exclamation marks, and none of "revolutionary", "seamless", "unlock",
  "supercharge".
- Numbers first in any merchant-facing sentence. Engine names used exactly and
  neutrally. Never promise a ranking or a revenue effect.

Six colours and two type families only, per SPEC 2.4. The palette lives in
`packages/shared/src/brand.ts` and a test asserts the report uses nothing else.

## Markets

v1 packages three regions and five markets: US, UK, and DACH (DE, AT, CH).
`packages/shared/src/markets.ts` is the single source of truth for what each
market implies, and nothing downstream may restate it:

- **DACH is not one market.** One language, three currencies, two legal
  regimes. Austria is EU at 20%, Switzerland is outside it at 8.1%.
- **Switzerland and the US have no statutory returns window.** Whatever the
  merchant publishes is the whole of the shopper protection there. Austria,
  Germany and the UK are 14 days and a shorter published window is a blocker.
- **US sales tax is never shown as a rate.** It depends on the destination and
  on seller nexus, so the US policy branch asks which states the merchant
  collects in. The tax schema is a discriminated union for this reason, not a
  boolean with an exception.

Copy is authored in British English and localised on the way out:
`localiseSpelling` handles en-US, and German comes from the message catalogue
in `packages/shared/src/messages.ts`. Code identifiers stay British.

Shopify merchants are in scope on the **accuracy-only** tier: we never sell
them presence hosting, because Shopify already publishes them. `offeringFor()`
in the connectors package is the check.

## Observation constraints

These are why the audit log can be sold as evidence. They are not preferences
and should not be traded away for coverage:

- Every stored observation records the method it was made by.
- Never touch a consumer surface outside a consented panel session. Google AI
  Mode and Copilot have no product-search API, so their adapter makes no
  network call at all.
- A surface below 0.8 reproducibility is reported as not observable. It raises
  no findings, and is never approximated from another surface.
- Never invent a value an engine did not state. No price stated and a wrong
  price are different findings.
- Model output may only rewrite a finding's cause, and is labelled inferred. It
  cannot create, remove or re-grade a finding.

## Where the build is

Phase 0 and Phase 1. See SPEC 11 for the order and the check that closes each
phase.

- **Phase 0**, the audit harness: `/tools/audit-cli`, plus `observe`, `diff`,
  `benchmark`.
- **Phase 1**, presence: `/packages/protocols` (UCP manifest, ACP feed,
  Merchant Center feeds, policy schema, eligibility) and `/apps/web`, which
  hosts the endpoints and the Presence, Products and Policies screens.

Phase 2 onwards is not built.

```bash
npm run check     # typecheck and the full suite
npm run audit -- --help
npm run web:build # bundle the deployable functions
```

### Two standing decisions in the protocol layer

- **enable_checkout is always false** in the ACP feed, and the UCP manifest
  declares **no payment handler**. SPEC 1: Showing Up is not a checkout. Both are
  asserted by tests, so changing either is a product decision rather than a
  configuration one.
- **A discontinued product is excluded from the feed**, never mapped onto
  out_of_stock. Out of stock tells an agent the product is coming back, and
  SPEC 3.1 counts recommending a discontinued item as a critical finding.

Protocol versions and capability identifiers are pinned as data in
`packages/protocols/src/versions.ts`. A pin whose `canonical` flag is false has
not been confirmed against the published specification, and the validator
reports it as a warning rather than passing it silently.

## Claims we do not make

Verified 13 September 2026 against primary sources. Do not reintroduce these:

- **Not** "the FTC requires accurate AI product representation". The 1 July 2026
  policy statement is proposed, not final, and addresses AI providers who
  configure systems toward undisclosed objectives, not merchants misdescribed
  by a third-party assistant.
- **Not** "the EU AI Act requires accurate product information". Article 50 is
  transparency only: disclose that a system is AI, mark generated output. No
  product-accuracy obligation exists in it.
- **Not** any published rate for how often assistants state a wrong price or
  recommend a discontinued product. No such measurement exists anywhere. The
  benchmark is how we produce the first one, so citing a made-up figure would
  destroy the asset before it is built.
- **Not** the Salesforce "$262bn, 20% of retail" figure as agentic commerce
  sizing. Salesforce never defines "AI-influenced" and the number bundles
  on-site recommendation engines with third-party agent referral.

The audit log is sold as **evidence**, not as a regulatory requirement. Never
claim a legal obligation we cannot cite to a published, in-force instrument.

Never commit secrets. Credentials come from the environment; `.env.example`
lists the names.
