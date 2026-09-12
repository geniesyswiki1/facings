/**
 * Pinned protocol versions.
 *
 * SPEC 8 names protocol churn as a live risk and sets the response: "protocol
 * adapters are data-driven and versioned; a spec change is a config release,
 * not a rebuild". So every version string, spec URL and schema URL lives here
 * as data. Moving to a new UCP or ACP version is an edit to this file plus a
 * fixture update, never a change to a builder.
 *
 * Each entry records when it was last checked against the published spec,
 * because a pinned version that nobody has re-read is a stale claim.
 */

export interface SpecVersion {
  /** The version string the protocol itself uses. */
  version: string
  /** Canonical specification URL. */
  spec: string
  /** ISO date this pin was last verified against the published specification. */
  verifiedOn: string
  /**
   * True when every field below was read from the canonical specification.
   * False means part of the shape is inferred and must be confirmed before a
   * merchant is told their store is compliant. Surfaced in validation output.
   */
  canonical: boolean
  note?: string
}

/**
 * Universal Commerce Protocol. Discovery manifest served at /.well-known/ucp.
 * Structure confirmed: a `ucp` object carrying version, services, capabilities
 * and payment_handlers, alongside a `signing_keys` array of JWK public keys.
 */
export const UCP: SpecVersion = {
  version: '2026-04-08',
  spec: 'https://ucp.dev/2026-04-08/specification/overview/',
  verifiedOn: '2026-09-12',
  canonical: true,
}

/**
 * Agentic Commerce Protocol product feed, maintained by OpenAI and Stripe.
 * Required and recommended field sets confirmed; the feed is published as
 * gzipped JSON Lines or CSV and may refresh up to every 15 minutes.
 */
export const ACP: SpecVersion = {
  version: '2026-01',
  spec: 'https://www.agenticcommerce.dev/',
  verifiedOn: '2026-09-12',
  canonical: false,
  note: 'field set verified against a community mirror of the specification. Confirm against the canonical OpenAI and Stripe repository before a merchant is told their feed is compliant.',
}

/** Google Merchant Center supplementary feed, RSS 2.0 with the g: namespace. */
export const GMC: SpecVersion = {
  version: 'rss-2.0',
  spec: 'https://support.google.com/merchants/answer/7052112',
  verifiedOn: '2026-09-12',
  canonical: true,
}

/** Microsoft Merchant Center feed for Copilot, same RSS shape as Google. */
export const MMC: SpecVersion = {
  version: 'rss-2.0',
  spec: 'https://help.ads.microsoft.com/apex/index/3/en/51084',
  verifiedOn: '2026-09-12',
  canonical: true,
}

export const SPEC_VERSIONS = { UCP, ACP, GMC, MMC } as const

/**
 * UCP capability declarations Facings publishes on a merchant's behalf.
 *
 * Facings serves the discovery layer only. SPEC 1 is explicit that this is not
 * a checkout: agents discover and redirect, and the merchant's own checkout
 * converts. So no payment handler is ever declared here, and the capability set
 * stays read-only. Adding a checkout capability would be a product decision,
 * not a configuration one.
 *
 * The identifiers below are config precisely because they may move. Anything
 * whose `canonical` flag is false is reported by the validator as needing
 * confirmation rather than being presented to a merchant as compliant.
 */
export interface CapabilityPin {
  /** Capability name, namespaced. */
  name: string
  version: string
  spec: string
  schema: string
  canonical: boolean
}

export const UCP_CAPABILITIES: CapabilityPin[] = [
  {
    name: 'dev.ucp.shopping.catalog',
    version: UCP.version,
    spec: `https://ucp.dev/${UCP.version}/specification/shopping/catalog/`,
    schema: `https://ucp.dev/${UCP.version}/schemas/shopping/catalog.json`,
    canonical: false,
  },
  {
    name: 'dev.ucp.shopping.product',
    version: UCP.version,
    spec: `https://ucp.dev/${UCP.version}/specification/shopping/product/`,
    schema: `https://ucp.dev/${UCP.version}/schemas/shopping/product.json`,
    canonical: false,
  },
]

/**
 * A capability in the `dev.ucp.*` namespace must carry a spec from
 * https://ucp.dev/. This rule is from the specification itself, so it is
 * enforced rather than trusted. SPEC 4.4 style: the check travels with the
 * artefact.
 */
export function namespaceAuthority(capabilityName: string): string | undefined {
  if (capabilityName.startsWith('dev.ucp.')) return 'https://ucp.dev/'
  return undefined
}
