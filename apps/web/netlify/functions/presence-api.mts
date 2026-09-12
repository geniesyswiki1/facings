import type { Config } from '@netlify/functions'
import { getRepository, handlePresenceApi } from '../../src/index.js'

/** Presence as JSON, for the agency roll-up and for monitoring. */
export default async (request: Request): Promise<Response> => {
  return handlePresenceApi(request, await getRepository())
}

export const config: Config = {
  path: '/api/presence/:storeId',
}
