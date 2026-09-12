import type { Config } from '@netlify/functions'
import { getRepository, handleUcp } from '../../src/index.js'

/**
 * The UCP discovery manifest. Public and unauthenticated by specification:
 * agent crawlers must be able to fetch it without credentials.
 */
export default async (request: Request): Promise<Response> => {
  return handleUcp(request, await getRepository())
}

export const config: Config = {
  path: '/.well-known/ucp',
}
