import { createHash, generateKeyPairSync } from 'node:crypto'
import type { Store } from '@showing-up/shared'
import { UCP, UCP_CAPABILITIES, type CapabilityPin, namespaceAuthority } from './versions.js'
import type { Policy } from './policy-schema.js'
import { policyGaps } from './policy-schema.js'

/**
 * The UCP discovery manifest, served at /.well-known/ucp. SPEC 3.1, job 1.
 *
 * This is the single integration surface a merchant has to expose, and it is
 * fetched unauthenticated by agent crawlers, so it carries no secret and needs
 * no credential to read. Showing Up hosts it and the merchant points at it from
 * their own domain.
 *
 * Showing Up declares discovery capabilities only. No payment handler is ever
 * declared: SPEC 1 says this is not a checkout, agents discover and redirect,
 * and the merchant's own checkout converts. An empty payment_handlers map is
 * the accurate statement of that, and is deliberate rather than unfinished.
 */

export interface SigningKey {
  kid: string
  kty: string
  crv: string
  x: string
  y: string
  use: string
  alg: string
}

export interface UcpServiceBinding {
  /** Transport the service is reachable over. */
  transport: 'https'
  /** Absolute URL of the endpoint. */
  endpoint: string
  /** Content type served. */
  contentType?: string
}

export interface UcpCapabilityDeclaration {
  version: string
  spec: string
  schema: string
  extends?: string
}

export interface UcpManifest {
  ucp: {
    version: string
    services: Record<string, UcpServiceBinding[]>
    capabilities: Record<string, UcpCapabilityDeclaration[]>
    payment_handlers: Record<string, unknown[]>
    supported_versions?: Record<string, string>
  }
  signing_keys: SigningKey[]
}

export interface BuildManifestInput {
  store: Store
  /** Absolute URL of the hosted ACP product feed. */
  acpFeedUrl: string
  /** Absolute URL of the hosted catalogue endpoint, when one is published. */
  catalogueUrl?: string
  signingKeys: SigningKey[]
  policy?: Policy
  /** Override the default capability pins, for a version migration. */
  capabilities?: CapabilityPin[]
}

export function buildUcpManifest(input: BuildManifestInput): UcpManifest {
  const pins = input.capabilities ?? UCP_CAPABILITIES

  const capabilities: Record<string, UcpCapabilityDeclaration[]> = {}
  for (const pin of pins) {
    const declaration: UcpCapabilityDeclaration = {
      version: pin.version,
      spec: pin.spec,
      schema: pin.schema,
    }
    capabilities[pin.name] = [declaration]
  }

  const services: Record<string, UcpServiceBinding[]> = {
    catalog: [
      {
        transport: 'https',
        endpoint: input.acpFeedUrl,
        contentType: 'application/jsonl',
      },
    ],
  }
  if (input.catalogueUrl) {
    services.product = [{ transport: 'https', endpoint: input.catalogueUrl, contentType: 'application/json' }]
  }

  return {
    ucp: {
      version: UCP.version,
      services,
      capabilities,
      // Deliberately empty. See the note at the top of this file.
      payment_handlers: {},
    },
    signing_keys: input.signingKeys,
  }
}

export interface ManifestIssue {
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface ManifestValidation {
  valid: boolean
  issues: ManifestIssue[]
}

/**
 * Validates a manifest against the rules the specification states.
 *
 * Enforced rather than trusted, because the merchant-facing claim is that
 * their manifest passes validation. A capability in the dev.ucp namespace must
 * carry a spec from ucp.dev, and a pin Showing Up has not confirmed against the
 * published specification is reported as a warning rather than passed
 * silently.
 */
export function validateUcpManifest(manifest: UcpManifest, pins: CapabilityPin[] = UCP_CAPABILITIES): ManifestValidation {
  const issues: ManifestIssue[] = []

  if (manifest.ucp?.version !== UCP.version) {
    issues.push({
      field: 'ucp.version',
      message: `expected the pinned protocol version ${UCP.version}, found ${String(manifest.ucp?.version)}`,
      severity: 'error',
    })
  }

  const capabilityNames = Object.keys(manifest.ucp?.capabilities ?? {})
  if (capabilityNames.length === 0) {
    issues.push({
      field: 'ucp.capabilities',
      message: 'a manifest declaring no capability tells an agent nothing it can act on',
      severity: 'error',
    })
  }

  for (const name of capabilityNames) {
    const declarations = manifest.ucp.capabilities[name] ?? []
    if (declarations.length === 0) {
      issues.push({ field: `ucp.capabilities.${name}`, message: 'declared with no version', severity: 'error' })
      continue
    }

    const authority = namespaceAuthority(name)
    for (const declaration of declarations) {
      for (const key of ['version', 'spec', 'schema'] as const) {
        if (!declaration[key]) {
          issues.push({ field: `ucp.capabilities.${name}.${key}`, message: 'is required', severity: 'error' })
        }
      }
      if (authority && declaration.spec && !declaration.spec.startsWith(authority)) {
        issues.push({
          field: `ucp.capabilities.${name}.spec`,
          message: `a ${name.split('.').slice(0, 2).join('.')} capability must carry a spec from ${authority}`,
          severity: 'error',
        })
      }
    }

    const pin = pins.find((candidate) => candidate.name === name)
    if (pin && !pin.canonical) {
      issues.push({
        field: `ucp.capabilities.${name}`,
        message:
          'this capability identifier is pinned from a community mirror and has not been confirmed against the published specification. Confirm it before telling a merchant their manifest is compliant',
        severity: 'warning',
      })
    }
  }

  if (manifest.ucp?.payment_handlers === undefined) {
    issues.push({
      field: 'ucp.payment_handlers',
      message: 'must be present. Showing Up declares an empty map because it is not a checkout',
      severity: 'error',
    })
  } else if (Object.keys(manifest.ucp.payment_handlers).length > 0) {
    issues.push({
      field: 'ucp.payment_handlers',
      message: 'Showing Up must not declare a payment handler. SPEC 1: agents discover and redirect, the merchant checkout converts',
      severity: 'error',
    })
  }

  if (!Array.isArray(manifest.signing_keys) || manifest.signing_keys.length === 0) {
    issues.push({
      field: 'signing_keys',
      message: 'at least one public key is required for HTTP message signature verification',
      severity: 'error',
    })
  } else {
    for (const [index, key] of manifest.signing_keys.entries()) {
      for (const field of ['kid', 'kty', 'crv', 'x', 'y', 'use', 'alg'] as const) {
        if (!key[field]) {
          issues.push({ field: `signing_keys[${index}].${field}`, message: 'is required', severity: 'error' })
        }
      }
      if ('d' in key) {
        issues.push({
          field: `signing_keys[${index}]`,
          message: 'a private key component reached the public manifest',
          severity: 'error',
        })
      }
    }
  }

  const services = Object.keys(manifest.ucp?.services ?? {})
  if (services.length === 0) {
    issues.push({ field: 'ucp.services', message: 'no service endpoint is published', severity: 'error' })
  }
  for (const name of services) {
    for (const binding of manifest.ucp.services[name] ?? []) {
      if (!binding.endpoint?.startsWith('https://')) {
        issues.push({
          field: `ucp.services.${name}.endpoint`,
          message: 'must be an absolute https URL that an agent crawler can fetch unauthenticated',
          severity: 'error',
        })
      }
    }
  }

  return { valid: issues.every((issue) => issue.severity !== 'error'), issues }
}

export interface KeyPair {
  publicJwk: SigningKey
  /** Kept server side and never published. */
  privateJwk: SigningKey & { d: string }
}

/**
 * Generates an ES256 key pair for HTTP message signatures.
 *
 * P-256 because that is what ES256 means, and the manifest declares alg so an
 * agent knows how to verify. The private half never leaves the server: the
 * validator above fails a manifest that contains one.
 */
export function generateSigningKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pub = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string }
  const priv = privateKey.export({ format: 'jwk' }) as { d: string }

  // RFC 7638 style thumbprint, so the same key always gets the same id.
  const thumbprint = createHash('sha256')
    .update(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y }))
    .digest('base64url')

  const publicJwk: SigningKey = {
    kid: thumbprint,
    kty: pub.kty,
    crv: pub.crv,
    x: pub.x,
    y: pub.y,
    use: 'sig',
    alg: 'ES256',
  }

  return { publicJwk, privateJwk: { ...publicJwk, d: priv.d } }
}

/**
 * Whether the store is ready for its manifest to be published at all. A
 * manifest that validates but describes a store with no policy data still
 * leaves an agent unable to answer the questions that decide a sale, so the
 * presence score treats the two separately.
 */
export function manifestReadiness(input: { policy?: Policy }): { ready: boolean; blockers: string[] } {
  const blockers = policyGaps(input.policy)
    .filter((gap) => gap.severity === 'blocker')
    .map((gap) => gap.consequence)
  return { ready: blockers.length === 0, blockers }
}
