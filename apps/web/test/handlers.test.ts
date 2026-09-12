import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { findCopyViolations, PALETTE } from '@facings/shared'
import {
  MemoryRepository,
  demoRecord,
  handleAcpFeed,
  handleMerchantFeed,
  handlePage,
  handlePolicyPost,
  handlePresenceApi,
  handleUcp,
  parseFeedPath,
  publishedSigningKeys,
} from '@facings/web'

/** response.json() is typed unknown, and these tests assert on its shape. */
async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T
}

const ORIGIN = 'https://facings.netlify.app'

function repo(options: { writable?: boolean } = {}) {
  return MemoryRepository.fromSeed([demoRecord()], options)
}

function request(path: string, init: RequestInit & { host?: string } = {}): Request {
  const headers = new Headers(init.headers)
  if (init.host) headers.set('x-forwarded-host', init.host)
  return new Request(`${ORIGIN}${path}`, { ...init, headers })
}

describe('the UCP manifest endpoint', () => {
  it('serves a valid manifest resolved by the store parameter', async () => {
    const response = await handleUcp(request('/.well-known/ucp?store=nordlicht'), repo())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const manifest = await json(response)
    expect(manifest.ucp.version).toBe('2026-04-08')
    expect(Object.keys(manifest.ucp.capabilities).length).toBeGreaterThan(0)
    expect(manifest.signing_keys[0].kid).toBe(publishedSigningKeys()[0]?.kid)
  })

  it('resolves the store by the merchant own domain, which is how a crawler arrives', async () => {
    const response = await handleUcp(request('/.well-known/ucp', { host: 'nordlicht-audio.de' }), repo())
    expect(response.status).toBe(200)
    expect((await json(response)).ucp.version).toBe('2026-04-08')
  })

  it('ignores a www prefix on the host', async () => {
    const response = await handleUcp(request('/.well-known/ucp', { host: 'www.nordlicht-audio.de' }), repo())
    expect(response.status).toBe(200)
  })

  it('explains a 404 rather than returning a bare one', async () => {
    const response = await handleUcp(request('/.well-known/ucp', { host: 'someone-else.example' }), repo())
    expect(response.status).toBe(404)
    expect((await json(response)).detail).toContain('someone-else.example')
  })

  it('publishes no private key material', async () => {
    const manifest = await json(await handleUcp(request('/.well-known/ucp?store=nordlicht'), repo()))
    for (const key of manifest.signing_keys) expect('d' in key).toBe(false)
  })

  it('declares no payment handler, because Facings is not a checkout', async () => {
    const manifest = await json(await handleUcp(request('/.well-known/ucp?store=nordlicht'), repo()))
    expect(manifest.ucp.payment_handlers).toEqual({})
  })

  it('points the catalog service at this deployment own feed URL', async () => {
    const manifest = await json(await handleUcp(request('/.well-known/ucp?store=nordlicht'), repo()))
    expect(manifest.ucp.services.catalog[0].endpoint).toBe(`${ORIGIN}/feeds/acp/nordlicht.jsonl`)
  })
})

describe('the ACP feed endpoint', () => {
  it('serves JSON Lines, one parseable object per line', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl'), repo())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/jsonl')

    const lines = (await response.text()).split('\n')
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('reports the item and exclusion counts on the response', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl'), repo())
    expect(Number(response.headers.get('x-facings-item-count'))).toBeGreaterThan(0)
    // The seed deliberately contains a discontinued product and one with no
    // description, so a zero here would mean the exclusion path stopped working.
    expect(Number(response.headers.get('x-facings-excluded-count'))).toBe(2)
  })

  it('serves CSV when asked', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.csv'), repo())
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect((await response.text()).split('\n')[0]).toContain('enable_checkout')
  })

  it('gzips when the path asks for it, as the specification publishes', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl.gz'), repo())
    expect(response.headers.get('content-encoding')).toBe('gzip')
    const body = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')
    expect(() => JSON.parse(body.split('\n')[0] as string)).not.toThrow()
  })

  it('never publishes an item with checkout enabled', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl'), repo())
    const items = (await response.text()).split('\n').map((line) => JSON.parse(line))
    expect(items.every((item) => item.enable_checkout === false)).toBe(true)
  })

  it('404s an unknown store', async () => {
    expect((await handleAcpFeed(request('/feeds/acp/nope.jsonl'), repo())).status).toBe(404)
  })
})

describe('parseFeedPath', () => {
  it('reads the store, format and compression from the filename', () => {
    expect(parseFeedPath('nordlicht.jsonl')).toEqual({ storeId: 'nordlicht', format: 'jsonl', gzipped: false })
    expect(parseFeedPath('nordlicht.csv.gz')).toEqual({ storeId: 'nordlicht', format: 'csv', gzipped: true })
    expect(parseFeedPath('nordlicht.xml')).toEqual({ storeId: 'nordlicht', format: 'jsonl', gzipped: false })
  })
})

describe('the Merchant Center endpoints', () => {
  it('serves parseable XML for Google', async () => {
    const response = await handleMerchantFeed(request('/feeds/gmc/nordlicht.xml'), repo(), 'google')
    expect(response.headers.get('content-type')).toContain('application/xml')
    const xml = await response.text()
    expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"')
    expect(xml).toContain('<g:id>NLA-AM10-WAL</g:id>')
  })

  it('carries shipping on the Microsoft feed only', async () => {
    const microsoft = await (await handleMerchantFeed(request('/feeds/mmc/nordlicht.xml'), repo(), 'microsoft')).text()
    const google = await (await handleMerchantFeed(request('/feeds/gmc/nordlicht.xml'), repo(), 'google')).text()
    expect(microsoft).toContain('<g:shipping>')
    expect(google).not.toContain('<g:shipping>')
  })
})

describe('the presence API', () => {
  it('returns eligibility per surface with the endpoints', async () => {
    const response = await handlePresenceApi(request('/api/presence/nordlicht'), repo())
    const body = await json(response)
    expect(body.eligibility).toHaveLength(6)
    expect(body.manifestValid).toBe(true)
    expect(body.endpoints.ucp).toContain('/.well-known/ucp')
    expect(body.feed.excluded.length).toBe(2)
  })
})

describe('the screens', () => {
  it('renders the store list', async () => {
    const response = await handlePage(request('/'), repo())
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('nordlicht-audio.de')
    expect(body).toContain('facings')
  })

  it('renders Presence with the endpoints and the feed exclusions', async () => {
    const body = await (await handlePage(request('/presence/nordlicht'), repo())).text()
    expect(body).toContain('Hosted endpoints')
    expect(body).toContain('/.well-known/ucp')
    // The discontinued product must be visible as excluded, with the reason.
    expect(body).toContain('NLA-TT2')
    expect(body).toContain('coming back')
  })

  it('shows a manifest level warning once, not against every surface that reads it', async () => {
    const body = await (await handlePage(request('/presence/nordlicht'), repo())).text()
    const occurrences = body.split('pinned from a community mirror').length - 1
    // Two capability pins, each stated once in their own section.
    expect(occurrences).toBe(2)
    expect(body).toContain('Pinned, not yet confirmed')
  })

  it('keeps surface specific warnings on the surface row', async () => {
    const body = await (await handlePage(request('/presence/nordlicht'), repo())).text()
    expect(body).toContain('no Merchant Center account is connected')
  })

  it('renders Products with a published column', async () => {
    const body = await (await handlePage(request('/products/nordlicht'), repo())).text()
    expect(body).toContain('NLA-AM10-WAL')
    expect(body).toContain('In feed')
  })

  it('renders the policy editor prefilled from the published policy', async () => {
    const body = await (await handlePage(request('/policies/nordlicht'), repo())).text()
    expect(body).toContain('value="30"')
    expect(body).toContain('https://nordlicht-audio.de/rueckgabe')
  })

  it('says plainly when the editor cannot save, rather than appearing to', async () => {
    const body = await (await handlePage(request('/policies/nordlicht'), repo({ writable: false }))).text()
    expect(body).toContain('edits cannot be saved')
    expect(body).toContain('<button type="submit" disabled>')
  })

  it('404s an unknown store and an unknown screen', async () => {
    expect((await handlePage(request('/presence/nope'), repo())).status).toBe(404)
    expect((await handlePage(request('/nonsense/nordlicht'), repo())).status).toBe(404)
  })

  it('obeys the copy rules on every screen', async () => {
    for (const path of ['/', '/presence/nordlicht', '/products/nordlicht', '/policies/nordlicht']) {
      const body = await (await handlePage(request(path), repo())).text()
      const text = body.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
      expect(findCopyViolations(text), `copy violation on ${path}`).toEqual([])
    }
  })

  it('uses only the six brand colours', async () => {
    const body = await (await handlePage(request('/presence/nordlicht'), repo())).text()
    const used = new Set((body.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((hex) => hex.toUpperCase()))
    const allowed = new Set(Object.values(PALETTE).map((hex) => hex.toUpperCase()))
    expect([...used].filter((hex) => !allowed.has(hex))).toEqual([])
  })
})

describe('the policy editor POST', () => {
  const form = (overrides: Record<string, string> = {}) =>
    new URLSearchParams({
      'returns.windowDays': '45',
      'returns.returnShippingPaidBy': 'merchant',
      'returns.url': 'https://nordlicht-audio.de/rueckgabe',
      'delivery.0.country': 'DE',
      'delivery.0.minDays': '1',
      'delivery.0.maxDays': '2',
      'delivery.0.cost': '0',
      'delivery.0.currency': 'EUR',
      'delivery.1.country': '',
      'delivery.1.minDays': '0',
      'delivery.1.maxDays': '0',
      'delivery.1.cost': '0',
      'delivery.1.currency': '',
      'vat.pricesIncludeVat': 'true',
      'vat.ratePct': '19',
      privacyPolicyUrl: 'https://nordlicht-audio.de/datenschutz',
      termsUrl: 'https://nordlicht-audio.de/agb',
      ...overrides,
    }).toString()

  function post(body: string) {
    return request('/api/policy/nordlicht', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  it('saves a valid policy and redirects', async () => {
    const repository = repo({ writable: true })
    const response = await handlePolicyPost(post(form()), repository)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/policies/nordlicht?saved=1')

    const record = await repository.get('nordlicht')
    expect(record?.policy?.returns.windowDays).toBe(45)
  })

  it('ignores the blank row the form always renders for adding a country', async () => {
    const repository = repo({ writable: true })
    await handlePolicyPost(post(form()), repository)
    expect((await repository.get('nordlicht'))?.policy?.delivery).toHaveLength(1)
  })

  it('rejects an invalid policy with the field that failed', async () => {
    const response = await handlePolicyPost(post(form({ 'returns.url': 'not-a-url' })), repo({ writable: true }))
    expect(response.status).toBe(303)
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('returns.url')
  })

  it('rejects a policy with no delivery country, since an agent could answer nothing', async () => {
    const response = await handlePolicyPost(post(form({ 'delivery.0.country': '' })), repo({ writable: true }))
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('delivery')
  })

  it('does not pretend to save when there is no storage', async () => {
    const response = await handlePolicyPost(post(form()), repo({ writable: false }))
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('not saved')
  })

  it('404s an unknown store', async () => {
    const response = await handlePolicyPost(
      request('/api/policy/nope', { method: 'POST', body: form() }),
      repo({ writable: true }),
    )
    expect(response.status).toBe(404)
  })
})
