import type { Config } from '@netlify/functions'
import { getRepository, handlePolicyPost } from '../../src/index.js'

/** The policy editor POST. Validates with the same schema the feed reads. */
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }
  return handlePolicyPost(request, await getRepository())
}

export const config: Config = {
  path: '/api/policy/:storeId',
}
