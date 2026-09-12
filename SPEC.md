# Facings: Full Build and Launch Spec

The agent channel manager for merchants who are not on Shopify. Presence on every AI shopping surface, SKU-level accuracy monitoring, and a compliance-grade record of how your products were represented. Europe first.

Version 1.0, 12 September 2026. Owner: Taiwo Ojo. Read with the validation memo (facings-validation-memo.md): this spec describes what to build if the 14-day validation clears; section 11 describes the audit harness that is built regardless, because it is the validation instrument.

---

## 0. How to use this document with Claude Code

Two modes.

**Validation mode (this week).** Build only section 11, Phase 0: the audit harness that takes a store URL and 20 SKUs and produces the one-page accuracy report across ChatGPT, Gemini, Copilot and Perplexity. It is a CLI plus a rendered PDF, not a product. Its purpose is to test make-or-break analysis M1 (can the surfaces be observed compliantly) and to put a real result in front of ten merchants.

**Build mode (after a PIVOT or GO verdict).** Paste this file as SPEC.md and open Claude Code with:

> Read SPEC.md end to end. Build Facings in the phase order in section 11, starting from the audit harness already in the repo. Every engine observation must use an official API where one exists and a consented browser panel where it does not; never scrape a consumer surface without consent, and record the observation method on every stored result. Where the spec is silent, choose the option that keeps the audit log defensible. After each phase, run the checks listed and stop to report. Never commit secrets.

Definition of done for the MVP (end of Phase 3): a merchant on WooCommerce with Adyen in Germany connects their store in ten minutes, gets a presence score and a UCP manifest plus ACP feed hosted by Facings, sees a daily accuracy report on their top 50 queries across four engines with each misrepresentation tied to the SKU and the fix, applies the fixes with one click where the platform allows, and can export a dated audit log. Billing live through Stripe Managed Payments, self-serve.

---

## 1. Product summary

**What it is:** a SaaS layer between a merchant's catalogue and the AI shopping surfaces. It does three jobs: makes the store present on ChatGPT, Gemini and Google AI Mode, Copilot, Perplexity and Claude through the protocols and feeds each one reads; observes how each engine actually represents the store's products against live catalogue data; and turns the gaps into fixes and a dated record.

**Who it is for:** merchants with £2m to £50m GMV on WooCommerce, Adobe Commerce, PrestaShop, BigCommerce, Wix and custom stacks, in the UK and Europe first, and the agencies that run their e-commerce. The buyer is the head of e-commerce or digital; the user is the merchandiser or the agency account manager.

**Why we win:** Shopify solves this for Shopify merchants only, and its default-on was US-first. Stripe's Agentic Commerce Suite solves protocol plumbing for Stripe merchants only; Adyen, Mollie, Worldpay and Checkout.com merchants are on their own. Feed tools syndicate data but do not observe the result. The US visibility startups are small, enterprise-priced and US-centric. Nobody owns non-Shopify, self-serve, Europe-first, with accuracy and compliance built in.

**What it is not:** not a checkout. In-chat checkout stalled in March 2026; agents discover and redirect, and the merchant's own checkout converts. Not a PIM. Not a brand-level GEO tool.

**Business model:** subscription per store per month in three tiers plus an agency tier, sold self-serve through platform app marketplaces and through agencies. A free audit is the top of the funnel.

---

## 2. Brand

### 2.1 Name and domain

Name: **Facings**. A retail term: the number of product units visible on the shelf face. The product card is the new shelf, and Facings is about how many of yours are on it and whether they are right. It is a word merchandisers already use, it is neutral about which engine wins, and it does not contain "AI".

Domain preference order: facings.ai, facings.io, getfacings.com. Fallback name: **Cardstand** (cardstand.io). Check the UK IPO and EUIPO registers in classes 9, 35 and 42 before registering; "Facings" is a common trade word and may already be registered in class 35.

Handles: @facings on X and LinkedIn (LinkedIn is the channel that matters for this buyer).

### 2.2 Positioning

One line, used everywhere: **"Show up, and show up correctly, when AI agents shop."**

Supporting line: "For stores that aren't on Shopify. Presence on every AI shopping surface, a daily check of how each one represents your products, and the record to prove it."

We are the merchandiser's instrument panel for a shelf they cannot walk.

### 2.3 Voice

- Plain, commercial, measured. The reader runs a P&L.
- Sentence case. No exclamation marks. No "revolutionary", "seamless", "unlock", "supercharge".
- Numbers first: "Your flagship is absent from ChatGPT for 14 of your top 20 queries. A £149 accessory takes its place in 9 of them."
- Engine names used exactly and neutrally. Never "beat the algorithm".
- Never promise rankings or revenue. Say "present", "represented correctly", "eligible".
- Hyphens only. Never em dashes or en dashes anywhere, including generated reports and commit messages.

### 2.4 Visual identity

The subject is the shelf, rendered as a grid of product cards, and the tick or cross that says whether each card is right.

**Palette (exactly these six):**

| Token | Hex | Use |
| --- | --- | --- |
| `--shelf` | `#F5F4F0` | page background, warm grey like a shelf edge |
| `--ink` | `#1B1D22` | all text |
| `--rule` | `#D3D1CA` | borders, dividers, empty card outlines |
| `--muted` | `#676A72` | secondary text |
| `--present` | `#1A6FD1` | the one accent: buttons, links, correct cards |
| `--wrong` | `#C0392B` | misrepresented or missing cards only |

No gradients, no shadows, no illustrations. Product images appear only inside cards drawn from the merchant's own catalogue.

**Type:** two families. **Instrument Sans** (Google Fonts), weights 500 and 700, for headlines and the report headers; **IBM Plex Sans** 400 and 500 for interface, tables and long copy. No monospace outside code samples in docs.

**Logo:** the word "facings" in Instrument Sans 700, lowercase, `--ink`, preceded by a 3x2 grid of six tiny rounded rectangles in `--rule` with the top-left one filled in `--present`. SVG at /public/logo.svg; favicon is the six-card grid.

**Layout:** the core screen is a grid. Rows are the merchant's top queries, columns are the engines, cells are the card that engine rendered for that query, or an empty outline. Clicking a cell shows what the engine said, what the catalogue says, and the diff. Everything else in the product is a sidebar to that grid.

**The one memorable moment:** the free audit result. A merchant pastes a URL, picks 20 SKUs, and gets the grid back with their bestsellers marked absent or wrong in `--wrong`. Nothing else animates.

### 2.5 Things the brand never does

- Never uses an engine's logo or implies partnership with one.
- Never publishes a merchant's audit without consent; the public benchmark (section 6) uses aggregated, anonymised data.
- Never claims a share of agent-driven revenue that was not measured.
- Never scrapes a consumer surface without a consented session.

---

## 3. Product specification

### 3.1 The three jobs

**Job 1, Presence.**

- Catalogue connectors: WooCommerce (REST), Adobe Commerce (GraphQL), PrestaShop (webservice), BigCommerce (API), Wix (Stores API, connector already in hand), Shopware, plus generic feed ingestion (Google Merchant Center XML or CSV) for everything else.
- Outputs, hosted by Facings and pointed at from the merchant's domain: the ACP product feed endpoint in the current spec version; the UCP manifest at /.well-known/ucp with the capability profile and a Merchant Center supplementary feed marking eligible products; Microsoft Merchant Center feed for Copilot; a Perplexity-readable and Claude-readable catalogue with structured policies. Payment provider agnostic: where the merchant is on Stripe, Facings hands off to Stripe's suite; where not, Facings serves the discovery layer and the merchant's own checkout takes the redirect.
- Machine-readable policies: returns window, delivery promise by country, VAT-inclusive pricing by market, warranty, sizing. Generated from a guided form and published as structured data.
- Presence score per engine: eligible, ingested, rendering. With the specific blocker when not.

**Job 2, Accuracy.**

- Query set: the merchant's top 50 commercial queries, seeded from their search console, their category tree and the benchmark library, editable.
- Daily observation across ChatGPT, Gemini and Google AI Mode, Copilot, Perplexity and Claude using the observation methods in 4.4. For each query and engine: card presence, position, product identity, price, variant, availability, rating, image, competitor adjacency, and the landing URL.
- Diff against the live catalogue: wrong price, wrong variant, discontinued item recommended, bestseller absent, competitor substituted, broken image, stale availability.
- Alerts by severity, with the SKU and the probable cause (missing attribute, stale feed, price mismatch between feed and page, no policy data).
- The audit log: every observation stored with timestamp, engine, method, raw response reference and the catalogue state at that moment. Exportable as PDF and CSV. Retained 24 months. This is the compliance artefact for the FTC policy statement and for EU consumer law questions about representations made through agents.

**Job 3, Action.**

- Fix suggestions ranked by revenue at risk (query volume proxy times product margin if provided).
- One-click fixes where the connector allows writes: attribute enrichment (materials, dimensions, compatibility, use cases), natural-language title variants, structured FAQ, policy publication, feed refresh. Every write is previewed and logged.
- Agent landing: pre-filled cart links and a lightweight landing template so the redirect from an engine converts on the merchant's own checkout.
- Attribution: tag agent-referred sessions (referrers, UTM conventions per engine, the Facings landing links) and report agent-attributed sessions, orders and revenue.

### 3.2 Screens

1. **Audit (free).** URL, platform detection, pick or paste 20 SKUs, choose market and language, run. Result grid, presence scores, three headline findings, "Monitor this daily" call to action.
2. **Grid.** Queries by engines. Filters by severity, product, engine. Cell detail drawer.
3. **Products.** Catalogue view with per-SKU presence and accuracy, attribute completeness, fix queue.
4. **Presence.** Per-engine status, hosted endpoints, policy editor, feed health.
5. **Fixes.** Queue, preview, apply, history.
6. **Attribution.** Agent-referred traffic and orders over time, by engine.
7. **Audit log.** Search, filter, export.
8. **Settings.** Markets and languages, connectors, team, billing, agency workspace switcher.

### 3.3 Markets and languages (v1)

UK and Germany first (English and German), then France, Netherlands, Spain, Italy. Each market has its own query set, currency, VAT display and policy fields. The engines render differently per market; the benchmark library records what each engine does in each market so the accuracy diff knows what "absent" means there.

### 3.4 Agency workspace

Multi-store workspace with client switcher, roll-up reporting, white-label PDF reports, and a partner margin. Agencies are a primary channel (section 6).

### 3.5 What v1 deliberately excludes

Checkout of any kind. Brand-level GEO content generation (blog posts, Reddit seeding). Amazon Rufus and Walmart Sparky (marketplace-internal assistants need a different approach; Phase 2). Shopify merchants (they have Shopify; Phase 2 only as an accuracy-only tier if demand appears).

---

## 4. Technical architecture

### 4.1 Stack

Next.js 15 on Netlify for the web app and marketing site; a separate worker service (Node on a container host such as Fly.io or Railway) for connectors, feed generation and the observation harness because those jobs are long-running; Postgres on Supabase (EU region) with Storage for raw observation artefacts; Upstash Redis for queues and rate limits; Anthropic API for diffing and fix generation; Stripe Managed Payments for billing (merchant of record, EU VAT); Resend for email; Plausible and PostHog; Sentry.

### 4.2 Repo structure

```
/apps/web            Next.js: marketing, audit, app screens
/apps/worker         Node service: connectors, feeds, observation jobs, diff, fixes
/packages/connectors woocommerce, adobe, prestashop, bigcommerce, wix, shopware, feed-import
/packages/protocols  acp-feed, ucp-manifest, mmc-feed, policy-schema (spec versions pinned, updatable as data)
/packages/observe    engine adapters (4.4), consented-panel client, normaliser, evidence store
/packages/diff       catalogue-vs-observation diff rules, severity model, cause inference prompts
/packages/fixes      attribute enrichment prompts, title variants, FAQ, policy publisher, connector writers
/packages/benchmark  query library per market and category, aggregated anonymised results
/packages/shared     UI, types, auth, billing
/tools/audit-cli     the Phase 0 harness: URL + SKUs in, PDF out
```

### 4.3 Data model (core tables)

`stores(id, org_id, platform, domain, market, language, psp, connector_status)`, `products(store_id, sku, title, price, currency, availability, attributes json, url, image, updated_at)`, `queries(store_id, text, market, source, volume_proxy)`, `observations(id, store_id, query_id, engine, method, observed_at, raw_ref, cards json)`, `findings(id, observation_id, sku, type, severity, expected json, observed json, cause, status)`, `fixes(id, store_id, sku, type, preview json, applied_at, applied_by, result)`, `presence(store_id, engine, status, blocker, checked_at)`, `attribution(store_id, date, engine, sessions, orders, revenue)`, `audit_exports(id, store_id, range, file_ref, created_at)`, `orgs`, `users`, `subscriptions`.

### 4.4 Observation methods (the make-or-break)

Each engine gets an adapter that records its method on every observation:

- **OpenAI:** the Responses API with web search and shopping-capable models where available, plus a consented panel of real ChatGPT sessions run by Facings staff and opted-in merchants for the consumer shopping surface. Card structure is captured from the rendered response.
- **Google:** the Gemini API with Google Search grounding for Gemini; a consented browser panel for AI Mode, since it has no product-search API; Merchant Center diagnostics for eligibility.
- **Microsoft Copilot:** consented browser panel; Microsoft Merchant Center diagnostics for eligibility.
- **Perplexity:** the Perplexity API for text and citations, panel for card rendering.
- **Claude:** the Anthropic API with web search for how products are named and characterised.

Rules: never scrape a consumer surface outside a consented session; respect each provider's terms and rate limits; store the raw response reference and the method; mark any observation from a panel as "observed by a human-initiated session". If the panel cannot reach 80% reproducibility for a surface, that surface is reported as "not observable" rather than approximated. Phase 0 exists to measure this before anything else is built.

### 4.5 Diff and cause inference

Deterministic first: price and availability comparisons, SKU identity matching via GTIN, MPN and normalised title, image URL checks. Model second: classify residual mismatches (competitor substituted, wrong variant described, hallucinated spec) and infer probable cause from the product's attribute completeness, feed freshness and policy presence. Every model-derived finding is labelled "inferred cause" in the UI and log.

### 4.6 Fix engine

Prompts generate attribute values only from the merchant's own product page, images and existing data; never invented specifications. Every proposed value carries its source. Writes go through the connector with a preview and a rollback record. Merchants can restrict fixes to suggestions only.

### 4.7 Privacy, security, terms

EU data residency. No merchant catalogue data used to train anything. Observation artefacts retained 24 months for the audit log, catalogue snapshots retained with them. SOC 2 readiness planned in year one because agencies and mid-market buyers ask. Terms make clear that Facings reports what engines rendered at a point in time and does not control engine behaviour.

---

## 5. Pricing

| Tier | Price per store per month | Includes |
| --- | --- | --- |
| Audit | Free | one-off 20-SKU audit across four engines, presence scores, three findings |
| Starter | £49 | presence hosting, weekly accuracy check on 20 queries, one market, suggestions only |
| Growth | £149 | daily accuracy on 50 queries, two markets, one-click fixes, attribution, audit log export |
| Scale | £499 | daily on 200 queries, all markets, API access, priority observation, SSO, 24-month log |
| Agency | £999 plus £99 per client store | workspace, white-label reports, roll-up, partner margin 30% on resold tiers |

Rules: monthly and annual (two months free). Stripe Managed Payments as merchant of record for EU VAT. No usage overage in v1; tier limits are soft with a nudge. Free audit requires a work email; that list is the pipeline.

Open risk on the agency tier. Managed Payments requires that we sell directly to the customer rather than through a platform or marketplace, and it does not support Connect. The 30% partner margin on resold tiers has to be settled against that before Phase 3: either the agency buys the stores itself and we invoice the agency directly, or the margin is paid out separately rather than routed through the sale. If resale needs Connect, that revenue cannot sit on Managed Payments and needs its own rail. Each tier is a digital SaaS subscription and needs an eligible tax code on its product; the business-use SaaS code is the expected one for a merchant-facing tool.

Unit economics: observation cost per store per day at Growth is roughly £0.30 to £0.80 (API calls plus panel time amortised); gross margin above 80% at scale. £10m ARR at a £200 blended rate is about 4,200 stores, or 1,500 direct plus 200 agencies averaging 12 stores.

---

## 6. Go-to-market

### 6.1 Beachhead

UK and Germany, non-Shopify merchants above £2m GMV on WooCommerce and Adobe Commerce, and the agencies that serve them. Two markets, two platforms, one buyer persona, for the first two quarters.

### 6.2 Pull channels (target 85% of pipeline)

1. **The benchmark.** A monthly published report, "How AI agents render [category] retailers in [market]", built from the benchmark library with anonymised aggregates: card presence rates, misrepresentation rates, which engines render which categories. It is the writing must, on a fixed cadence, and it is the thing journalists and LinkedIn share. First edition: UK electronics and fashion, October 2026.
2. **The free audit.** Every benchmark, post and talk ends at the audit. The audit result is the sales conversation.
3. **Trade associations.** IMRG (UK) and bevh (Germany): a member webinar each quarter, a benchmark cut for their members, and a listing. This is the second marketing must.
4. **Platform marketplaces.** Listings on the WooCommerce marketplace, Adobe Commerce Marketplace, Wix App Market and PrestaShop Addons, each with the free audit as the install action.
5. **Agencies.** Twenty named UK and German e-commerce agencies on WooCommerce and Adobe, approached with a co-branded audit of three of their clients. The agency tier and margin close them.

### 6.3 Push (15%)

Outbound to the merchants surfaced by the benchmark itself: the ones whose products are absent or wrong get a one-page audit by email with the finding. Measured, capped, and stopped if reply rates fall under 5%.

### 6.4 Progressive offerings ladder

Free audit, then £49 Starter, then £149 Growth, then £499 Scale, then the agency workspace, then a services engagement through Alluvium for catalogue remediation and PIM work, which is where the consulting arm earns from the same motion.

### 6.5 First ten customers

To be named in the validation sprint (memo action 3). The list is drawn from Alluvium's client and partner network, IMRG and bevh member directories, and the merchants that appear in the first benchmark run.

---

## 7. Metrics

Balanced scorecard, SMART for the first two quarters:

- **Financial:** £50k MRR by end of Q1 2027; blended £200 per store; gross margin above 75%.
- **Customer:** free-audit-to-paid conversion above 6%; monthly logo churn under 2.5%; NPS above 40 from Growth and Scale.
- **Internal:** observation reproducibility above 80% per surface, measured weekly; median time from finding to applied fix under 48 hours for Growth stores.
- **Organisational:** benchmark published on the first Tuesday of every month without a miss; two association sessions per quarter delivered.
- **Operational:** connector uptime 99.5%; daily observation completion above 97% of scheduled runs; audit-log export under 60 seconds.

Quarterly re-scoring of these KPIs is scheduled alongside the validation re-score cadence.

---

## 8. Risks and responses

| Risk | Response in the next 90 days |
| --- | --- |
| Surfaces cannot be observed compliantly (M1) | Phase 0 measures it first; surfaces below 80% reproducibility are reported as not observable, and the product's claims shrink to match |
| Google or OpenAI ship merchant-side accuracy reporting free | Stay multi-engine and PSP-agnostic; own the cross-engine log and the European market data; sell the compliance artefact, which a single engine will not produce about itself |
| Protocol churn (UCP has moved several times) | Protocol adapters are data-driven and versioned; a spec change is a config release, not a rebuild |
| Agent traffic is still immaterial for European merchants (M2) | Price the Starter tier low enough to be bought as insurance; lead with presence and the benchmark until traffic arrives |
| Wildcard, Alhena or a feed tool moves down-market into Europe | Move first with the associations and the marketplaces; agencies are sticky once white-label reports are in client decks |
| Panel cost scales with stores | Deduplicate queries across stores in the same category and market; the benchmark library turns observation into a shared asset |

---

## 9. Team and cost to MVP

One full-stack engineer on the app and connectors, one engineer on the observation harness and diff, one part-time merchandiser or e-commerce consultant from Alluvium to own the query library, benchmark and fixes content, a part-time designer for the grid and reports, Taiwo on GTM. Roughly 12 weeks to the Phase 3 MVP. Cost to MVP in the low six figures including panel costs and API spend; the validation sprint in section 11 Phase 0 costs under £5,000.

---

## 10. Brand assets and connectors

Netlify hosts the web app and marketing site. Figma holds the logo, the grid component and the report templates; Google Drive holds the benchmark data room and the audit PDFs; Slack channels #facings-audits (every free audit result posts here for the founding team to read), #facings-pipeline and #facings-benchmark; Jira project FAC; Zoho CRM for the first-ten list, agencies and association contacts; n8n for the audit-to-CRM sync and the weekly reproducibility report. Higgsfield for a 30-second LinkedIn explainer built from the grid animation. Gmail label and filter for hello@facings.ai.

---

## 11. Build order for Claude Code

**Phase 0: audit harness (validation instrument, 1 week).** /tools/audit-cli: take a store URL, detect platform, ingest 20 SKUs (connector or manual CSV), build 20 queries, run the observation adapters in 4.4 (API methods first, panel instructions generated for the human-run sessions), normalise cards, diff against catalogue, render a one-page PDF with the grid and three findings, and log reproducibility per surface. Check: run on five real merchants; report reproducibility per engine; this number decides whether Phase 1 starts.

**Phase 1: presence (3 weeks).** Connectors for WooCommerce and Adobe Commerce, generic feed import, ACP feed and UCP manifest hosting, Merchant Center supplementary feed, policy schema and editor, presence scores. Check: a WooCommerce store on Adyen in Germany passes Google's UCP manifest validation and has a live ACP feed endpoint.

**Phase 2: accuracy (4 weeks).** Query library, daily observation scheduler, evidence store, deterministic and model diff, findings with severity and cause, alerts, the Grid and Products screens, audit log with export. Check: a seeded misrepresentation (price changed on the page but not the feed) is detected within one daily cycle and appears in the exported log with method and raw reference.

**Phase 3: action, billing, agency (4 weeks).** Fix engine with preview and rollback, agent landing links, attribution, Stripe Managed Payments tiers, agency workspace and white-label PDF, marketplace listing builds for WooCommerce and Wix. Check: the MVP definition of done in section 0.

**Phase 4: benchmark and scale (ongoing).** Benchmark library and monthly report generator, PrestaShop, BigCommerce and Shopware connectors, France and Netherlands markets, API access, SSO.

---

## 12. Operator runbook delta (Taiwo)

Everything in the Reinstate operator runbook applies for Stripe Managed Payments (a Stripe account for Facings, with the four subscription products and annual variants, each carrying an eligible digital-goods tax code), Supabase (EU region), Resend, Upstash, Sentry and Plausible. New or different:

1. **API accounts for observation:** OpenAI (Responses API), Google AI Studio (Gemini), Perplexity API, Anthropic (existing). Read each provider's terms on automated use before Phase 0 and keep the consented-panel policy in Drive Facings / Legal.
2. **Panel:** three to five people (staff and opted-in merchants) who run the human-initiated sessions in Phase 0; a one-page consent and instruction sheet.
3. **Google Merchant Center and Microsoft Merchant Center** test accounts for eligibility diagnostics.
4. **Associations:** IMRG and bevh membership enquiries this month; a speaking slot request for Q1 2027.
5. **Legal:** terms that state Facings reports point-in-time renderings and controls no engine; a short opinion on presenting the audit log as a compliance record in the UK and Germany.
6. **Trade mark check** on "Facings" in classes 9, 35 and 42 before the domain purchase.
7. **First-ten list** in Zoho by 19 September, from the validation memo's action 3.

---

## 13. Phase 2 (after the 90-day review)

- Shopify accuracy-only tier if Shopify merchants ask for the cross-engine log.
- Amazon Rufus and Walmart Sparky observation for merchants who also sell on marketplaces.
- Agent order handling: identifying agent-originated orders, returns rules, dispute evidence.
- Category benchmarks sold to brands and analysts as a data product.
- US market entry via the agency channel once Europe has 500 stores.
