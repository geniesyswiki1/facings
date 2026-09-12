import { describe, expect, it } from 'vitest'
import { validateAcpItem, validateUcpManifest, UCP } from '@facings/protocols'
import { MemoryRepository, demoRecord, handleAcpFeed, handleUcp } from '@facings/web'

/**
 * The Phase 1 acceptance check, from SPEC 11:
 *
 *   "a WooCommerce store on Adyen in Germany passes Google's UCP manifest
 *    validation and has a live ACP feed endpoint"
 *
 * Written as a test so it runs on every commit rather than once by hand.
 *
 * One honest limit: this asserts the manifest conforms to the rules the
 * published specification states, which is what Facings can check itself.
 * Running it through Google's own validator is a manual step before a merchant
 * is told they are compliant, and it is on the Phase 1 handover list.
 */

/** response.json() is typed unknown, and these tests assert on its shape. */
async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T
}

const ORIGIN = 'https://facings.netlify.app'
const repository = () => MemoryRepository.fromSeed([demoRecord()])
const request = (path: string) => new Request(`${ORIGIN}${path}`)

describe('Phase 1 check: a WooCommerce store on Adyen in Germany', () => {
  it('is the store the check describes', async () => {
    const record = await repository().get('nordlicht')
    expect(record?.store.platform).toBe('woocommerce')
    expect(record?.store.psp).toBe('adyen')
    expect(record?.store.market).toBe('DE')
    expect(record?.store.language).toBe('de')
  })

  it('serves a UCP manifest that passes validation', async () => {
    const response = await handleUcp(request('/.well-known/ucp?store=nordlicht'), repository())
    expect(response.status).toBe(200)

    const manifest = await json(response)
    const validation = validateUcpManifest(manifest)

    expect(
      validation.issues.filter((issue) => issue.severity === 'error'),
      'the manifest must carry no validation error',
    ).toEqual([])
    expect(validation.valid).toBe(true)
    expect(manifest.ucp.version).toBe(UCP.version)
  })

  it('serves the manifest unauthenticated, as an agent crawler fetches it', async () => {
    // No credential is presented anywhere in this test. If serving it ever
    // starts requiring one, the discovery layer stops working and this fails.
    const response = await handleUcp(request('/.well-known/ucp?store=nordlicht'), repository())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('has a live ACP feed endpoint whose every item validates', async () => {
    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl'), repository())
    expect(response.status).toBe(200)

    const items = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(validateAcpItem(item), `item ${item.id} must validate`).toEqual([])
    }
  })

  it('publishes the feed endpoint the manifest points at', async () => {
    // A manifest that advertises a feed URL nothing serves is the failure mode
    // that matters here, so the two are checked against each other.
    const manifest = await json(await handleUcp(request('/.well-known/ucp?store=nordlicht'), repository()))
    const advertised: string = manifest.ucp.services.catalog[0].endpoint

    expect(advertised.startsWith(ORIGIN)).toBe(true)
    const feed = await handleAcpFeed(new Request(advertised), repository())
    expect(feed.status).toBe(200)
    expect(Number(feed.headers.get('x-facings-item-count'))).toBeGreaterThan(0)
  })

  it('prices the feed in the market currency, VAT inclusive per the policy', async () => {
    const record = await repository().get('nordlicht')
    expect(record?.policy?.vat.pricesIncludeVat).toBe(true)

    const response = await handleAcpFeed(request('/feeds/acp/nordlicht.jsonl'), repository())
    const items = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    for (const item of items) expect(item.price).toMatch(/^\d+\.\d{2} EUR$/)
  })

  it('serves the German delivery promise an agent needs to answer a delivery question', async () => {
    const record = await repository().get('nordlicht')
    const germany = record?.policy?.delivery.find((promise) => promise.country === 'DE')
    expect(germany).toBeDefined()
    expect(germany?.maxDays).toBeLessThanOrEqual(5)
  })
})
