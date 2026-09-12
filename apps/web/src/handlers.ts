import {
  buildMerchantFeed,
  gzip,
  toCsv,
  toJsonl,
  type MerchantCenterKind,
} from '@facings/protocols'
import type { StoreRepository } from './repository.js'
import { buildContext, originOf, SURFACES } from './context.js'
import { homeScreen } from './render/home.js'
import { presenceScreen } from './render/presence.js'
import { productsScreen } from './render/products.js'
import { policiesScreen } from './render/policies.js'
import { html } from './render/layout.js'
import { parsePolicyForm } from './policy-form.js'

/**
 * Request handlers, kept out of the Netlify function files so they can be
 * exercised directly in the test suite. A function file is a three line
 * wrapper; everything below runs the same way in a test as in production.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/**
 * The UCP discovery manifest.
 *
 * Resolved by the Host header first, because the merchant points their own
 * domain at this endpoint and an agent fetching nordlicht-audio.de/.well-known/ucp
 * must get that store. The ?store= parameter is the fallback for reading a
 * manifest from the Facings domain itself.
 */
export async function handleUcp(request: Request, repository: StoreRepository): Promise<Response> {
  const url = new URL(request.url)
  const requested = url.searchParams.get('store')
  const host = request.headers.get('x-forwarded-host') ?? url.host

  const record = requested ? await repository.get(requested) : await repository.getByDomain(host)
  if (!record) {
    return new Response(
      JSON.stringify({
        error: 'no store is served at this host',
        detail: `point the domain at Facings, or fetch /.well-known/ucp?store=<id>. Host seen: ${host}`,
      }),
      { status: 404, headers: JSON_HEADERS },
    )
  }

  const context = buildContext(record, originOf(request))

  // An invalid manifest is still served, with the reason in a header rather
  // than as a silent pass. Hiding it would leave the merchant believing they
  // are published when no agent can read them.
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    'cache-control': 'public, max-age=300',
  }
  if (!context.validation.valid) {
    headers['x-facings-manifest-valid'] = 'false'
  }

  return new Response(JSON.stringify(context.manifest, null, 2), { status: 200, headers })
}

/** The ACP product feed, as JSON Lines or CSV, gzipped when asked for. */
export async function handleAcpFeed(request: Request, repository: StoreRepository): Promise<Response> {
  const url = new URL(request.url)
  const file = url.pathname.split('/').pop() ?? ''
  const { storeId, format, gzipped } = parseFeedPath(file)

  const record = await repository.get(storeId)
  if (!record) return notFound(`no store ${storeId}`)

  const context = buildContext(record, originOf(request))
  const body = format === 'csv' ? toCsv(context.feed.items) : toJsonl(context.feed.items)

  const headers: Record<string, string> = {
    'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/jsonl; charset=utf-8',
    'cache-control': 'public, max-age=300',
    // The count is on the response so a merchant can see at a glance whether
    // the feed they are serving matches the catalogue they think they have.
    'x-facings-item-count': String(context.feed.items.length),
    'x-facings-excluded-count': String(context.feed.exclusions.length),
  }

  if (gzipped) {
    headers['content-encoding'] = 'gzip'
    return new Response(new Uint8Array(gzip(body)), { status: 200, headers })
  }

  return new Response(body, { status: 200, headers })
}

/** Google and Microsoft Merchant Center feeds share one builder. */
export async function handleMerchantFeed(
  request: Request,
  repository: StoreRepository,
  kind: MerchantCenterKind,
): Promise<Response> {
  const url = new URL(request.url)
  const file = url.pathname.split('/').pop() ?? ''
  const { storeId } = parseFeedPath(file)

  const record = await repository.get(storeId)
  if (!record) return notFound(`no store ${storeId}`)

  const context = buildContext(record, originOf(request))
  const xml = buildMerchantFeed(record.products, {
    kind,
    title: record.store.domain,
    link: record.store.url,
    ...(record.policy ? { policy: record.policy } : {}),
  })

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-facings-item-count': String(context.record.products.length),
    },
  })
}

/** Presence as JSON, for the agency roll-up and for monitoring. */
export async function handlePresenceApi(request: Request, repository: StoreRepository): Promise<Response> {
  const storeId = new URL(request.url).pathname.split('/').pop() ?? ''
  const record = await repository.get(storeId)
  if (!record) return notFound(`no store ${storeId}`)

  const context = buildContext(record, originOf(request))
  return new Response(
    JSON.stringify(
      {
        store: context.record.store,
        checkedAt: new Date().toISOString(),
        manifestValid: context.validation.valid,
        manifestIssues: context.validation.issues,
        feed: { items: context.feed.items.length, excluded: context.feed.exclusions },
        eligibility: context.eligibility,
        endpoints: context.endpoints,
        surfaces: SURFACES,
      },
      null,
      2,
    ),
    { status: 200, headers: JSON_HEADERS },
  )
}

/** The screens. */
export async function handlePage(request: Request, repository: StoreRepository): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const origin = originOf(request)

  if (segments.length === 0) {
    const records = await repository.list()
    return html(homeScreen(records.map((record) => buildContext(record, origin))))
  }

  const [screen, storeId] = segments
  if (!storeId) return html(`<h1>Not found</h1>`, 404)

  const record = await repository.get(storeId)
  if (!record) return html(`<h1>No store ${escapeText(storeId)}</h1>`, 404)

  const context = buildContext(record, origin)

  switch (screen) {
    case 'presence':
      return html(presenceScreen(context))
    case 'products':
      return html(productsScreen(context))
    case 'policies': {
      const options: { writable: boolean; saved?: boolean; error?: string } = {
        writable: repository.writable,
      }
      if (url.searchParams.get('saved') === '1') options.saved = true
      const error = url.searchParams.get('error')
      if (error) options.error = error
      return html(policiesScreen(context, options))
    }
    default:
      return html(`<h1>Not found</h1>`, 404)
  }
}

/** The policy editor POST. */
export async function handlePolicyPost(request: Request, repository: StoreRepository): Promise<Response> {
  const storeId = new URL(request.url).pathname.split('/').pop() ?? ''
  const record = await repository.get(storeId)
  if (!record) return notFound(`no store ${storeId}`)

  const form = new URLSearchParams(await request.text())
  const { policy, error } = parsePolicyForm(form, record.store.market, record.store.language)

  if (!policy) {
    return redirect(`/policies/${storeId}?error=${encodeURIComponent(error ?? 'the policy did not validate')}`)
  }

  if (!repository.writable) {
    return redirect(
      `/policies/${storeId}?error=${encodeURIComponent(
        'this deployment has no storage connected, so the policy was validated but not saved',
      )}`,
    )
  }

  try {
    await repository.savePolicy(storeId, policy)
  } catch (caught) {
    return redirect(
      `/policies/${storeId}?error=${encodeURIComponent(caught instanceof Error ? caught.message : String(caught))}`,
    )
  }

  return redirect(`/policies/${storeId}?saved=1`)
}

/** "nordlicht.jsonl.gz" gives the store, the format and whether to compress. */
export function parseFeedPath(file: string): { storeId: string; format: 'jsonl' | 'csv'; gzipped: boolean } {
  const gzipped = file.endsWith('.gz')
  const withoutGz = gzipped ? file.slice(0, -3) : file
  const format = withoutGz.endsWith('.csv') ? 'csv' : 'jsonl'
  const storeId = withoutGz.replace(/\.(jsonl|csv|xml)$/, '')
  return { storeId, format, gzipped }
}

function notFound(detail: string): Response {
  return new Response(JSON.stringify({ error: 'not found', detail }), { status: 404, headers: JSON_HEADERS })
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}

function escapeText(value: string): string {
  return value.replace(/[<>&"]/g, '')
}
