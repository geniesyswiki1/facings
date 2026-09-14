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
   Checkout.com, Stripe, anything. Showing Up stays deliberately **provider
   agnostic** here. Never narrow this to Stripe, and never describe Showing Up
   as needing a merchant to be on Stripe.

   **Do not say "everyone outside Stripe is unserved". Corrected 13 September
   2026.** That was the founding claim and it is false. Adyen announced **Adyen
   Agentic** on 16 June 2026, whose first layer, **Agentic Feed**, distributes
   real-time catalogue, pricing and availability data across conversational
   commerce environments. That is the presence layer, from the largest of the
   four providers the claim named.

   Presence is therefore not the wedge any more, from any direction: Adyen
   ships it for its merchants, Shopify ships it for its merchants, and Adobe,
   Criteo and Feedonomics sell it. **Correctness and the record are the wedge**,
   because nothing in Agentic Feed checks what an assistant said back against
   the live catalogue, dated and method-stamped. Sell presence as the way in
   and the record as the reason to stay.

   Open and unverified: whether Adyen Agentic reaches the two to fifty million
   GMV bracket, on what terms, and whether it requires Adyen for payments. It
   is announced for enterprise. Check before relying on the mid-market gap.
   SPEC 1 carries the full correction.

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

**Packaged is not launched.** From 13 September 2026 the launch order is UK
(Q4 2026), then US (Q1 2027), then DACH deferred to Q3 2027 at the earliest.
The two blockers on DACH are not EU regulatory requirements, which are cheap:
German cold B2B email is unlawful under UWG section 7(2) no. 2 with no B2B
exemption, and the German query templates render category labels rather than
product types, producing questions no shopper types. The UK and the US pair
because they share the English product-type vocabulary that the query library
and the benchmark are built on.

Deferred is not deleted. Keep DE, AT and CH in the market table with their
currencies, tax regimes and tests. Do not remove market support to reflect a
launch date. SPEC 6.1 carries the reasoning.

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

Shopify is in scope in **all five markets**, on a narrow accuracy-only tier.
`offeringFor(platform)` in the connectors package is the check: it takes no
market, because the answer does not vary by one.

Corrected 13 September 2026, and the corrected version matters. Shopify's
Spring 2026 Edition ships **Search Intelligence** (top AI queries in a
merchant's category and which they rank for) and an agentic dashboard with full
channel attribution. So it is false to say Shopify "does not observe what the
surfaces say back": it observes presence and attributes orders, in the
merchant's own admin.

What Shopify still does not do, per its own wording:

- check whether the price or availability an assistant **stated** matches the
  live catalogue, as opposed to whether the product appeared at all;
- publish any retention period, history or audit trail.

Surface coverage **used to be** the third item and is not any more. On
2 September 2026 Anthropic launched Claude Commerce Agents. That leaves
Perplexity alone, which is **2.6%** of LLM referral traffic to online stores
(Alhena, July 2026, 310 retail brands, 189.76m visitors) inside a channel
measured at roughly **0.24%** of retail visits. Two and a half percent of a
quarter of a percent is not a commercial argument.

### Claude Commerce Agents, read rather than assumed

Both repositories were read on 14 September 2026. This is the strongest
external evidence the product has, so use the specifics rather than the
headline:

- **`anthropics/commerce-agents`**, Apache-2.0, published 2 September 2026. A
  shopping agent and a merchant agent over three runtimes, four vertical demos,
  a Claude Code plugin. The README says it plainly: "This is a reference
  implementation; it is not maintained and does not accept contributions."
- **`Shopify/claude-for-commerce-examples`**: "a storefront shopping agent over
  UCP and Sign in with Shop, and a merchant agent over the Admin API".

Three things in there matter more than the launch did.

**Neither repository verifies anything.** No check that a stated price or
availability matches the live catalogue, no accuracy checking, and no audit
log, observation history or dated record of what an agent told a shopper.
Anthropic's guardrails "constrain prices and products to actual catalog data"
at generation time, and Shopify's agent reads live UCP endpoints, which is
presence done properly. Nobody records what was said. The gap is now verified
against source code instead of inferred from a press release.

**Neither takes payment, in almost our words.** Anthropic's README: "Nothing
places an order, charges a card, or changes a live listing". Shopify's:
"checkout, shipping, and payment all happen on Shopify's own pages". That is
independent support for the two standing protocol decisions below, so treat
`enable_checkout: false` and the absent payment handler as validated rather
than merely chosen.

**Anthropic ships no catalogue interface at all.** Deployments implement
`StorefrontBackend` against their own systems. That is exactly the work the
connectors package does, and it is why a blueprint does not remove the
merchant-side problem.

Partner list, which is wider than earlier notes recorded: Shopify, Priceline,
Accenture, Mastercard, Visa, Intuit, Klaviyo, **Wix**, Zomato, Fetch, Square.
Wix is one of our own target platforms, so its presence there is a fact to
check before pitching a Wix merchant on presence.

One earlier claim is softened. The note used to say Shopify's implementation
was public "inside 48 hours". The repository exists and is real; the 48-hour
timing could not be confirmed from it, so do not repeat the interval.

So the pitch is **two** things, not three, and they are held in
`SHOPIFY_SELLABLE`. `sellableToShopify()` returns false for `presence`,
`visibility` and now `uncovered-surfaces`, so a screen cannot quietly widen the
offer back into what Shopify already gives them in the admin they open every
morning. Never pitch a Shopify merchant on visibility, AI channel reporting, or
surface coverage.

`SHOPIFY_COVERED_ENGINES` includes `claude` for this reason. Claiming Shopify
does not reach Claude would be found out by any merchant who already uses it.

We never generate presence artefacts for a Shopify store, and the `deliver`
command enforces that: it prints the two sellable things instead. Verified
against allbirds.com rather than asserted.

The wedge is two features wide against an incumbent already inside the
merchant's admin, down from three on 2 September 2026. Search Intelligence already knows which queries to ask and
already holds the catalogue to compare against, so Shopify adding correctness
is a plausible release rather than a remote risk. Re-verify the gap before
building on it; do not treat a build date set months out as evidence it still
exists.

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
