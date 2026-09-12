import { describe, expect, it } from 'vitest'
import { fetchAdobeProducts } from '@facings/connectors'

const item = {
  sku: 'NLA-AM10',
  name: 'Nordlicht AM10 Regallautsprecher',
  url_key: 'am10-regallautsprecher',
  stock_status: 'IN_STOCK',
  price_range: { minimum_price: { final_price: { value: 749, currency: 'EUR' } } },
  image: { url: 'https://cdn.nordlicht-audio.de/am10.jpg' },
  short_description: { html: '<p>Ein <b>Paar</b> Regallautsprecher.</p>' },
  categories: [{ name: 'Lautsprecher' }, { name: 'Elektronik' }],
}

function reply(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

describe('fetchAdobeProducts', () => {
  it('maps a storefront product onto the shared catalogue shape', async () => {
    const result = await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/' },
      { fetchImpl: reply({ data: { products: { items: [item], total_count: 1 } } }) },
    )
    expect(result.products[0]).toMatchObject({
      sku: 'NLA-AM10',
      title: 'Nordlicht AM10 Regallautsprecher',
      price: 749,
      currency: 'EUR',
      availability: 'in_stock',
      url: 'https://nordlicht-audio.de/am10-regallautsprecher.html',
    })
    expect(result.products[0]?.attributes.description).toBe('Ein Paar Regallautsprecher.')
    expect(result.products[0]?.attributes.category).toBe('Lautsprecher, Elektronik')
  })

  it('posts GraphQL to the storefront endpoint', async () => {
    let seenUrl = ''
    let body: any
    await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/' },
      {
        fetchImpl: (async (url: string, init: RequestInit) => {
          seenUrl = String(url)
          body = JSON.parse(String(init.body))
          return new Response(JSON.stringify({ data: { products: { items: [] } } }), { status: 200 })
        }) as unknown as typeof fetch,
      },
    )
    expect(seenUrl).toBe('https://nordlicht-audio.de/graphql')
    expect(body.query).toContain('products(filter:')
    expect(body.variables.pageSize).toBe(20)
  })

  it('sends the integration token and store code when supplied', async () => {
    let headers: Record<string, string> = {}
    await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/', accessToken: 'tok', storeCode: 'de' },
      {
        fetchImpl: (async (_url: string, init: RequestInit) => {
          headers = init.headers as Record<string, string>
          return new Response(JSON.stringify({ data: { products: { items: [] } } }), { status: 200 })
        }) as unknown as typeof fetch,
      },
    )
    expect(headers.authorization).toBe('Bearer tok')
    expect(headers.store).toBe('de')
  })

  it('says plainly that these are not the bestsellers', async () => {
    // Adobe publishes no sales rank on the storefront API. Presenting catalogue
    // order as a bestseller list would make the whole audit answer the wrong
    // question.
    const result = await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/' },
      { fetchImpl: reply({ data: { products: { items: [item] } } }) },
    )
    expect(result.warnings.some((warning) => warning.includes('not the bestsellers'))).toBe(true)
  })

  it('raises GraphQL errors rather than returning an empty catalogue', async () => {
    await expect(
      fetchAdobeProducts(
        's1',
        { baseUrl: 'https://nordlicht-audio.de/' },
        { fetchImpl: reply({ errors: [{ message: 'Field "canonical_url" not found' }] }) },
      ),
    ).rejects.toThrow(/canonical_url/)
  })

  it('explains an HTTP failure with the endpoint it tried', async () => {
    await expect(
      fetchAdobeProducts('s1', { baseUrl: 'https://nordlicht-audio.de/' }, { fetchImpl: reply({}, 503) }),
    ).rejects.toThrow(/nordlicht-audio.de\/graphql/)
  })

  it('skips an unusable product with a reason instead of losing the run', async () => {
    const broken = { ...item, sku: 'BAD', price_range: undefined }
    const result = await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/' },
      { fetchImpl: reply({ data: { products: { items: [broken, item] } } }) },
    )
    expect(result.products).toHaveLength(1)
    expect(result.warnings.some((warning) => warning.includes('BAD'))).toBe(true)
  })

  it('prefers an absolute canonical URL when the store publishes one', async () => {
    const withCanonical = { ...item, canonical_url: 'https://nordlicht-audio.de/shop/am10' }
    const result = await fetchAdobeProducts(
      's1',
      { baseUrl: 'https://nordlicht-audio.de/' },
      { fetchImpl: reply({ data: { products: { items: [withCanonical] } } }) },
    )
    expect(result.products[0]?.url).toBe('https://nordlicht-audio.de/shop/am10')
  })
})
