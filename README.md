# Showing Up

Show up, and show up correctly, when AI agents shop.

This repository is at **Phase 1** of [SPEC.md](SPEC.md).

**Phase 0**, the audit harness, is the validation instrument rather than the product. It
answers one question before anything else gets built, the make-or-break in SPEC 8:

> Can these surfaces be observed compliantly and repeatably?

It takes a store URL and 20 SKUs, observes six AI shopping surfaces, diffs what each one
rendered against the live catalogue, and writes a one-page report plus a dated audit log.
The number that matters is reproducibility per surface. A surface below 0.8 agreement is
reported as **not observable** rather than approximated, and produces no findings at all.

**Phase 1**, presence, is now built: the protocol layer in `packages/protocols` and the web
app in `apps/web` that hosts the endpoints and the screens. See [Presence hosting](#presence-hosting-phase-1)
below. Phase 2 onwards (the daily scheduler, the accuracy grid, fixes, billing) is not
built. See SPEC 11 for the order.

## Install

```bash
npm install
npm run check      # typecheck and 200+ tests
```

Node 20.11 or newer. Chromium comes from Playwright and is only needed for the PDF; without
it the run still writes the HTML report, the CSV log and the JSON record.

## Run an audit

Credentials go in the environment, never in a file in this repo. Copy `.env.example` and
export what you have; the harness runs whatever is configured and lists the rest as not run.

```bash
# a live audit of four API surfaces, three repeats per query
npm run audit -- run \
  --url https://store.example \
  --csv catalogue.csv \
  --market DE \
  --engines api \
  --repeats 3

# every surface, including the two that need a consented panel
npm run audit -- run --url https://store.example --csv catalogue.csv --engines all

# no API credit: replay a recorded fixture end to end
npm run audit -- fixtures --url https://store.example --csv fixtures/demo-catalogue.csv
npm run audit -- run --url https://store.example --csv fixtures/demo-catalogue.csv \
  --engines all --fixtures fixtures/demo-observations.json
```

`npm run audit -- --help` lists every option. The installed binary is `showing-up-audit`.

### Catalogue input

One of, in precedence order:

| Flag | Source |
| --- | --- |
| `--csv <path>` | manual CSV. Needs `sku`, `title`, `price`, `url`. Optional: `currency`, `availability`, `image link`, `brand`, `gtin`, `mpn`, `margin`. Any other column is kept as a product attribute |
| `--feed <path>` / `--feed-url <url>` | Google Merchant Center XML. Most merchants above the £2m GMV line already publish one |
| `--woo-key` with `--woo-secret` | WooCommerce REST, read scope, ordered by popularity so the 20 SKUs are the bestsellers |

`fixtures/demo-catalogue.csv` is a 20-SKU example on an invalid domain, so it is safe to run
anywhere and exercises the platform-detection failure path. The fixture it pairs with is
generated rather than committed, so it cannot drift from the generator: run the `fixtures`
command above first.

### Output

Each run writes `runs/<run id>/`:

| File | What it is |
| --- | --- |
| `report.pdf`, `report.html` | the one-page report: presence, the grid, three findings, the method and reproducibility table |
| `audit-log.csv` | one row per card per observation, with the method, the timestamp, the evidence hash and the catalogue state at that moment |
| `findings.csv`, `findings.json` | every finding with its expected and observed values, severity, cause and revenue at risk |
| `observations.json` | every attempt, including the failed ones |
| `reproducibility.json` | the Phase 0 verdict per surface |
| `catalogue-snapshot.json` | the catalogue as it was when the run started |
| `manifest.json` | the run: store, surfaces, repeats, counts, harness version |
| `raw/` | the provider's raw response for every attempt, hashed and referenced from the log |

`runs/` is gitignored. Nothing in a run is committed.

## The surfaces, and how each one is observed

SPEC 4.4 is the rule. Every stored observation carries the method it was made by.

| Surface | Method | Needs |
| --- | --- | --- |
| ChatGPT | OpenAI Responses API with web search | `OPENAI_API_KEY` |
| Gemini | Gemini API with Search grounding | `GEMINI_API_KEY` |
| Perplexity | Perplexity API, text and citations | `PERPLEXITY_API_KEY` |
| Claude | Anthropic API with web search | `ANTHROPIC_API_KEY` |
| Google AI Mode | consented panel session | a capture file |
| Copilot | consented panel session | a capture file |

Google AI Mode and Copilot have no product-search API, so the harness does not touch them
over the network at all. It generates the session sheet and a capture template, a consented
panel member runs the queries in their own browser, and the harness reads what they
recorded:

```bash
npm run audit -- panel --url https://store.example --csv catalogue.csv --out panel
# a panel member fills in a copy of each template, drops it in panel/ without ".template"
npm run audit -- run --url https://store.example --csv catalogue.csv --engines all --panel-dir panel
```

A capture with no operator or consent reference is rejected. A query with no capture is
recorded as not observed, never as an empty rendering, and never filled in from an API
surface: what Gemini's API returned is not evidence about what Google AI Mode rendered.
The consent sheet itself lives in Drive under Showing Up / Legal, not in this repository.

## What the harness will not do

These are constraints, not preferences. The audit log is sold as a compliance artefact, so
anything it cannot defend it does not say.

- It never scrapes a consumer surface outside a consented session.
- It never reports a finding from a surface that failed the reproducibility floor.
- It never invents a value an engine did not state. A card with no price stated and a card
  with a wrong price are different findings.
- Causes are deterministic unless a model produced them, and those are labelled inferred.
  The model pass (`--infer-cause`) may only rewrite a cause. It cannot create, remove or
  re-grade a finding.
- A run that replayed fixtures is stamped as such in the manifest and on the report itself.
- It promises no ranking and no revenue effect. It reports what each surface rendered at a
  point in time.

## Presence hosting, Phase 1

Showing Up hosts the artefacts each surface reads, and the merchant points at them from their
own domain. Everything is public and unauthenticated, because agent crawlers fetch it
without credentials.

| Endpoint | What it is |
| --- | --- |
| `/.well-known/ucp` | the UCP discovery manifest, protocol `2026-04-08`. Resolved by the Host header, so a merchant domain pointed here gets its own manifest |
| `/feeds/acp/<store>.jsonl` | the ACP product feed. Also `.csv`, and either with `.gz` |
| `/feeds/gmc/<store>.xml` | Google Merchant Center supplementary feed, matched on item id |
| `/feeds/mmc/<store>.xml` | Microsoft Merchant Center feed, read by Copilot |
| `/api/presence/<store>` | eligibility per surface as JSON, for monitoring and the agency roll-up |

Screens: `/` lists stores, `/presence/<store>` shows eligibility and the endpoints,
`/products/<store>` shows which SKUs are published and why the rest are not, and
`/policies/<store>` is the guided policy editor.

```bash
npm run web:build     # bundle the deployable functions into apps/web/dist
```

Two decisions in the protocol layer are deliberate and asserted by tests:

- **`enable_checkout` is always false**, and the manifest declares **no payment handler**.
  SPEC 1: Showing Up is not a checkout. Agents discover and redirect, and the merchant's own
  checkout converts.
- **A discontinued product is excluded from the feed** rather than published as
  `out_of_stock`. Out of stock tells an agent the product is coming back, and SPEC 3.1
  counts recommending a discontinued item as a critical finding, so publishing one would
  have Showing Up creating the defect it sells the detection of.

Protocol versions and capability identifiers are pinned as data in
`packages/protocols/src/versions.ts`, per the SPEC 8 response to protocol churn. A pin
whose `canonical` flag is false has not been confirmed against the published
specification, and the manifest validator reports it as a warning rather than passing it
silently. The ACP field set and the UCP capability identifiers are in that state today.

## Layout

Follows SPEC 4.2, with only what Phases 0 and 1 need.

```
/packages/shared       types, brand tokens, the copy rules, money and hashing
/packages/connectors   platform detection, WooCommerce, Adobe Commerce, CSV, feed import
/packages/benchmark    the query library: intents, categories, per market templates
/packages/observe      engine adapters, the consented panel, normaliser, evidence store,
                       reproducibility scoring, the run loop
/packages/diff         identity matching, deterministic rules, severity, presence, headlines,
                       the labelled cause-inference pass
/packages/protocols    UCP manifest, ACP feed, Merchant Center feeds, policy schema,
                       eligibility scoring, pinned spec versions
/apps/web              hosted endpoints and the Presence, Products and Policies screens
/tools/audit-cli       the CLI, the report renderer and the audit log export
/fixtures              a demo catalogue and a recorded fixture for offline runs
```

Phase 3 adds `/packages/fixes`.

### A deviation from SPEC 4.1 worth knowing about

The spec names Next.js 15 for the web app. `apps/web` is built on Netlify Functions with
server-rendered HTML instead, because the deployment path available today ships a
directory rather than running a framework build, and a Next.js app that cannot be deployed
serves nobody. Every protocol decision lives in `packages/protocols`, so the web layer is a
thin shell over it: moving to Next.js is a rewrite of the shell, not of the logic, and the
natural moment is when the repository is connected to Netlify's own builds.

## Tests

```bash
npm test               # everything
npm run typecheck
```

The end-to-end test runs the whole harness on a recorded fixture and asserts the checks
SPEC 11 Phase 0 asks for: the seeded defects are detected, the unstable surface is reported
as not observable and raises no findings, every evidence hash verifies against the bytes on
disk, and the PDF is one page.

`apps/web/test/phase1-check.test.ts` is the SPEC 11 Phase 1 check written as a test: a
WooCommerce store on Adyen in Germany serves a UCP manifest that passes validation and a
live ACP feed endpoint whose every item validates, with the manifest and the feed checked
against each other. One honest limit: it validates against the rules the published
specification states, which is what Showing Up can check itself. Running the manifest through
Google's own validator is a manual step before any merchant is told they are compliant.
