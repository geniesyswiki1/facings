import type { Config } from '@netlify/functions'
import { getRepository, handleMerchantFeed } from '../../src/index.js'

/** Google Merchant Center supplementary feed, matched on item id. */
export default async (request: Request): Promise<Response> => {
  return handleMerchantFeed(request, await getRepository(), 'google')
}

export const config: Config = {
  path: '/feeds/gmc/:file',
}
