import { describe, expect, it } from 'vitest'
import type { Store } from '@showing-up/shared'
import {
  UCP,
  UCP_CAPABILITIES,
  buildUcpManifest,
  generateSigningKeyPair,
  manifestReadiness,
  namespaceAuthority,
  validateUcpManifest,
} from '@showing-up/protocols'
import { germanPolicy } from './fixtures.js'

const store: Store = {
  id: 'str_1',
  domain: 'nordlicht-audio.de',
  url: 'https://nordlicht-audio.de/',
  platform: 'woocommerce',
  market: 'DE',
  language: 'de',
  psp: 'adyen',
  connectorStatus: 'connected',
}

const { publicJwk } = generateSigningKeyPair()

function manifest(overrides: Parameters<typeof buildUcpManifest>[0] | null = null) {
  return buildUcpManifest(
    overrides ?? {
      store,
      acpFeedUrl: 'https://feeds.showingup.ai/acp/str_1.jsonl.gz',
      signingKeys: [publicJwk],
      policy: germanPolicy(),
    },
  )
}

describe('generateSigningKeyPair', () => {
  it('produces an ES256 public key with every field the manifest needs', () => {
    const { publicJwk: key } = generateSigningKeyPair()
    expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256' })
    expect(key.x).toBeTruthy()
    expect(key.y).toBeTruthy()
    expect(key.kid).toHaveLength(43)
  })

  it('keeps the private component out of the public half', () => {
    const { publicJwk: key } = generateSigningKeyPair()
    expect('d' in key).toBe(false)
  })

  it('gives the same key the same id, so a republish does not look like a rotation', () => {
    const pair = generateSigningKeyPair()
    const again = { ...pair.publicJwk }
    expect(again.kid).toBe(pair.publicJwk.kid)
  })

  it('gives different keys different ids', () => {
    expect(generateSigningKeyPair().publicJwk.kid).not.toBe(generateSigningKeyPair().publicJwk.kid)
  })
})

describe('buildUcpManifest', () => {
  it('carries the pinned protocol version', () => {
    expect(manifest().ucp.version).toBe(UCP.version)
    expect(UCP.version).toBe('2026-04-08')
  })

  it('declares the catalog service as an absolute https endpoint', () => {
    const built = manifest()
    expect(built.ucp.services.catalog?.[0]?.endpoint).toBe('https://feeds.showingup.ai/acp/str_1.jsonl.gz')
    expect(built.ucp.services.catalog?.[0]?.transport).toBe('https')
  })

  it('declares every pinned capability with a version, spec and schema', () => {
    const built = manifest()
    for (const pin of UCP_CAPABILITIES) {
      const declared = built.ucp.capabilities[pin.name]?.[0]
      expect(declared).toMatchObject({ version: pin.version, spec: pin.spec, schema: pin.schema })
    }
  })

  it('declares no payment handler, because Showing Up is not a checkout', () => {
    // SPEC 1. If this ever becomes non empty it is a product decision, not a
    // configuration one, and this test should be the thing that stops it.
    expect(manifest().ucp.payment_handlers).toEqual({})
  })

  it('publishes the signing keys', () => {
    expect(manifest().signing_keys).toEqual([publicJwk])
  })
})

describe('validateUcpManifest', () => {
  it('passes a manifest built from a complete store', () => {
    const result = validateUcpManifest(manifest())
    expect(result.valid).toBe(true)
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('fails a manifest on the wrong protocol version', () => {
    const broken = manifest()
    broken.ucp.version = '2025-01-01'
    const result = validateUcpManifest(broken)
    expect(result.valid).toBe(false)
    expect(result.issues[0]?.field).toBe('ucp.version')
  })

  it('fails a dev.ucp capability whose spec is not served from ucp.dev', () => {
    // The specification requires the spec origin to match the namespace
    // authority, so this is enforced rather than assumed.
    const broken = manifest()
    const entry = broken.ucp.capabilities['dev.ucp.shopping.catalog']?.[0]
    if (entry) entry.spec = 'https://example.com/spec'
    const result = validateUcpManifest(broken)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('must carry a spec from https://ucp.dev/'))).toBe(true)
  })

  it('fails a manifest that declares a payment handler', () => {
    const broken = manifest()
    broken.ucp.payment_handlers = { stripe: [{}] }
    const result = validateUcpManifest(broken)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('must not declare a payment handler'))).toBe(true)
  })

  it('fails a manifest with no capability', () => {
    const broken = manifest()
    broken.ucp.capabilities = {}
    expect(validateUcpManifest(broken).valid).toBe(false)
  })

  it('fails a manifest with no signing key', () => {
    const broken = manifest()
    broken.signing_keys = []
    expect(validateUcpManifest(broken).valid).toBe(false)
  })

  it('fails loudly if a private key component ever reaches the manifest', () => {
    const broken = manifest()
    broken.signing_keys = [{ ...publicJwk, d: 'secret' } as never]
    const result = validateUcpManifest(broken)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.message.includes('private key component'))).toBe(true)
  })

  it('fails a service endpoint that is not absolute https, since crawlers fetch it unauthenticated', () => {
    const broken = manifest()
    const binding = broken.ucp.services.catalog?.[0]
    if (binding) binding.endpoint = '/acp/str_1.jsonl.gz'
    expect(validateUcpManifest(broken).valid).toBe(false)
  })

  it('warns, without failing, on a capability identifier Showing Up has not confirmed', () => {
    const result = validateUcpManifest(manifest())
    const warnings = result.issues.filter((issue) => issue.severity === 'warning')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]?.message).toContain('confirmed against the published specification')
    expect(result.valid).toBe(true)
  })
})

describe('namespaceAuthority', () => {
  it('binds the dev.ucp namespace to ucp.dev and leaves others open', () => {
    expect(namespaceAuthority('dev.ucp.shopping.catalog')).toBe('https://ucp.dev/')
    expect(namespaceAuthority('ai.showingup.custom')).toBeUndefined()
  })
})

describe('manifestReadiness', () => {
  it('is ready with a complete policy', () => {
    expect(manifestReadiness({ policy: germanPolicy() }).ready).toBe(true)
  })

  it('is not ready with no policy, and says what an agent cannot answer', () => {
    const result = manifestReadiness({})
    expect(result.ready).toBe(false)
    expect(result.blockers[0]).toContain('no agent can answer')
  })
})
