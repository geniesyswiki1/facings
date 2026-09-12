import type { Config } from '@netlify/functions'
import { getRepository, handleMerchantFeed } from '../../src/index.js'

/** Microsoft Merchant Center feed, read by Copilot. */
export default async (request: Request): Promise<Response> => {
  return handleMerchantFeed(request, await getRepository(), 'microsoft')
}

export const config: Config = {
  path: '/feeds/mmc/:file',
}
