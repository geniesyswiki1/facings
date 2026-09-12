import type { Config } from '@netlify/functions'
import { getRepository, handleAcpFeed } from '../../src/index.js'

/** The ACP product feed: /feeds/acp/<store>.jsonl, .csv, either with .gz. */
export default async (request: Request): Promise<Response> => {
  return handleAcpFeed(request, await getRepository())
}

export const config: Config = {
  path: '/feeds/acp/:file',
}
