import type { Config } from '@netlify/functions'
import { getRepository, handlePage } from '../../src/index.js'

/** The screens: the store list, Presence, Products and the policy editor. */
export default async (request: Request): Promise<Response> => {
  return handlePage(request, await getRepository())
}

export const config: Config = {
  path: ['/', '/presence/:storeId', '/products/:storeId', '/policies/:storeId'],
}
