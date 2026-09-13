import type { EngineId } from '@showing-up/shared'
import {
  type BuildFeedResult,
  type EligibilityResult,
  type ManifestValidation,
  type UcpManifest,
  buildAcpFeed,
  buildUcpManifest,
  scoreAllEligibility,
  validateUcpManifest,
} from '@showing-up/protocols'
import { MemoryRepository, type StoreRecord, type StoreRepository } from './repository.js'
import { demoRecord, publishedSigningKeys } from './seed.js'

/**
 * Everything the screens and the endpoints need about one store, computed
 * once. The artefacts are derived rather than stored so a catalogue or policy
 * edit is reflected on the next fetch: a feed that lags the catalogue is the
 * exact defect the product exists to find.
 */

export const SURFACES: EngineId[] = ['openai', 'gemini', 'google-ai-mode', 'copilot', 'perplexity', 'claude']

export interface StoreContext {
  record: StoreRecord
  manifest: UcpManifest
  validation: ManifestValidation
  feed: BuildFeedResult
  eligibility: EligibilityResult[]
  endpoints: Endpoints
}

export interface Endpoints {
  ucp: string
  acpJsonl: string
  acpCsv: string
  gmc: string
  mmc: string
}

/** Absolute URLs for the hosted artefacts, from the request's own origin. */
export function endpointsFor(origin: string, storeId: string): Endpoints {
  const base = origin.replace(/\/$/, '')
  return {
    ucp: `${base}/.well-known/ucp?store=${encodeURIComponent(storeId)}`,
    acpJsonl: `${base}/feeds/acp/${encodeURIComponent(storeId)}.jsonl`,
    acpCsv: `${base}/feeds/acp/${encodeURIComponent(storeId)}.csv`,
    gmc: `${base}/feeds/gmc/${encodeURIComponent(storeId)}.xml`,
    mmc: `${base}/feeds/mmc/${encodeURIComponent(storeId)}.xml`,
  }
}

export function buildContext(record: StoreRecord, origin: string): StoreContext {
  const endpoints = endpointsFor(origin, record.store.id)
  const feed = buildAcpFeed(record.products, record.policy ? { policy: record.policy } : {})

  const manifest = buildUcpManifest({
    store: record.store,
    acpFeedUrl: endpoints.acpJsonl,
    signingKeys: publishedSigningKeys(),
    ...(record.policy ? { policy: record.policy } : {}),
  })
  const validation = validateUcpManifest(manifest)

  const eligibility = scoreAllEligibility(
    {
      products: record.products,
      feed,
      manifest: validation,
      ...(record.policy ? { policy: record.policy } : {}),
    },
    SURFACES,
  )

  return { record, manifest, validation, feed, eligibility, endpoints }
}

/**
 * The repository the running app reads.
 *
 * Netlify Blobs is layered on when it is available so a policy edit persists;
 * without it the app still serves every endpoint, and the editor says plainly
 * that it cannot save rather than appearing to.
 */
export async function getRepository(): Promise<StoreRepository> {
  const base = MemoryRepository.fromSeed([demoRecord()])
  try {
    const { getStore } = await import('@netlify/blobs')
    const blobs = getStore('showing-up-policies')
    const { BlobPolicyOverlay } = await import('./repository.js')
    return new BlobPolicyOverlay(base, blobs as never)
  } catch {
    return base
  }
}

/** Request origin, honouring the proxy headers Netlify sets. */
export function originOf(request: Request): string {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const host = forwardedHost ?? url.host
  const protocol = forwardedProto ?? url.protocol.replace(':', '')
  return `${protocol}://${host}`
}
