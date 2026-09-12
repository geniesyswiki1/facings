import type { Product, Store } from '@facings/shared'
import type { Policy } from '@facings/protocols'

/**
 * Store data access.
 *
 * SPEC 4.1 puts production on Postgres in Supabase, EU region. That needs a
 * provisioned project and credentials, so Phase 1 defines the interface and
 * ships two adapters that need neither: a seeded in-memory one, which is what
 * the protocol endpoints read, and a Netlify Blobs one for edits made in the
 * policy editor. Swapping in Postgres is a third adapter, not a rewrite, which
 * is the reason the interface exists at this stage rather than later.
 */

export interface StoreRecord {
  store: Store
  products: Product[]
  policy?: Policy
  /** Public key ids published in the manifest. Private halves never live here. */
  signingKeyIds: string[]
}

export interface StoreRepository {
  get(storeId: string): Promise<StoreRecord | undefined>
  /** Resolve by the merchant's own domain, for host based manifest serving. */
  getByDomain(domain: string): Promise<StoreRecord | undefined>
  list(): Promise<StoreRecord[]>
  /** Persist a policy edit. Throws when the adapter is read only. */
  savePolicy(storeId: string, policy: Policy): Promise<void>
  /** False when this adapter cannot persist, so the editor can say so. */
  readonly writable: boolean
}

export class MemoryRepository implements StoreRepository {
  readonly writable: boolean

  constructor(
    private records: Map<string, StoreRecord>,
    options: { writable?: boolean } = {},
  ) {
    this.writable = options.writable ?? false
  }

  static fromSeed(records: StoreRecord[], options: { writable?: boolean } = {}): MemoryRepository {
    return new MemoryRepository(new Map(records.map((record) => [record.store.id, record])), options)
  }

  async get(storeId: string): Promise<StoreRecord | undefined> {
    return this.records.get(storeId)
  }

  async getByDomain(domain: string): Promise<StoreRecord | undefined> {
    const wanted = domain.replace(/^www\./, '').toLowerCase()
    for (const record of this.records.values()) {
      if (record.store.domain.replace(/^www\./, '').toLowerCase() === wanted) return record
    }
    return undefined
  }

  async list(): Promise<StoreRecord[]> {
    return [...this.records.values()]
  }

  async savePolicy(storeId: string, policy: Policy): Promise<void> {
    if (!this.writable) {
      throw new Error('this store registry is read only. Connect Netlify Blobs or Postgres to persist a policy edit.')
    }
    const record = this.records.get(storeId)
    if (!record) throw new Error(`no store ${storeId}`)
    this.records.set(storeId, { ...record, policy })
  }
}

/**
 * Netlify Blobs adapter: seeded stores stay read-only, policy edits are
 * layered on top. Imported lazily so the package still loads where Blobs is
 * not available, such as in the test suite and the CLI.
 */
export class BlobPolicyOverlay implements StoreRepository {
  readonly writable = true

  constructor(
    private readonly base: StoreRepository,
    private readonly store: { get(key: string, opts?: { type: 'json' }): Promise<unknown>; setJSON(key: string, value: unknown): Promise<unknown> },
  ) {}

  private async withPolicy(record: StoreRecord | undefined): Promise<StoreRecord | undefined> {
    if (!record) return undefined
    const saved = (await this.store.get(policyKey(record.store.id), { type: 'json' })) as Policy | null
    return saved ? { ...record, policy: saved } : record
  }

  async get(storeId: string): Promise<StoreRecord | undefined> {
    return this.withPolicy(await this.base.get(storeId))
  }

  async getByDomain(domain: string): Promise<StoreRecord | undefined> {
    return this.withPolicy(await this.base.getByDomain(domain))
  }

  async list(): Promise<StoreRecord[]> {
    const records = await this.base.list()
    return Promise.all(records.map(async (record) => (await this.withPolicy(record)) as StoreRecord))
  }

  async savePolicy(storeId: string, policy: Policy): Promise<void> {
    await this.store.setJSON(policyKey(storeId), policy)
  }
}

function policyKey(storeId: string): string {
  return `policy/${storeId}.json`
}
