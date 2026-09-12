import { createHash, randomUUID } from 'node:crypto'

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Short deterministic id from stable parts. Keeps ids readable in the log. */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256(parts.join('|')).slice(0, 12)}`
}

export function uuid(): string {
  return randomUUID()
}

/**
 * Run id: date plus a short random suffix, so runs sort chronologically in a
 * directory listing and never collide.
 */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  return `${stamp}-${sha256(randomUUID()).slice(0, 6)}`
}
