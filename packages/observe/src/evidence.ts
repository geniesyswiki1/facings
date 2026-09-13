import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { EngineId, RawRef } from '@showing-up/shared'
import { sha256 } from '@showing-up/shared'

/**
 * The evidence store.
 *
 * Every observation keeps the provider's raw response on disk, hashed, and the
 * observation row holds only a pointer. This is what makes the audit log a
 * record rather than an assertion: a merchant, or a regulator reading the
 * export, can open the exact bytes the finding was derived from and confirm the
 * hash. SPEC 3.1 job 2, SPEC 4.3.
 */
export class EvidenceStore {
  constructor(private readonly rootDir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.rootDir, 'raw'), { recursive: true })
  }

  /**
   * Writes one raw provider response and returns its reference. The filename
   * encodes engine, query and repeat so the directory is readable without the
   * manifest.
   */
  async put(params: {
    engine: EngineId
    queryId: string
    repeat: number
    payload: unknown
  }): Promise<RawRef> {
    const body = JSON.stringify(params.payload, null, 2)
    const name = `${params.engine}__${params.queryId}__r${params.repeat}.json`
    const absolute = join(this.rootDir, 'raw', name)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, body, 'utf8')
    return {
      path: relative(this.rootDir, absolute),
      sha256: sha256(body),
      bytes: Buffer.byteLength(body, 'utf8'),
    }
  }
}
