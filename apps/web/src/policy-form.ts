import { policySchema, type Policy } from '@facings/protocols'
import type { Market } from '@facings/shared'

/**
 * Parses the guided policy form back into a validated Policy.
 *
 * Form input is merchant supplied and reaches a published feed, so it is
 * validated by the same schema the feed builder reads rather than trusted
 * because it came from our own form.
 */

export interface ParseResult {
  policy?: Policy
  error?: string
}

export function parsePolicyForm(form: URLSearchParams, market: Market, language: string): ParseResult {
  const deliveryIndexes = new Set<number>()
  for (const key of form.keys()) {
    const match = key.match(/^delivery\.(\d+)\./)
    if (match?.[1]) deliveryIndexes.add(Number.parseInt(match[1], 10))
  }

  const delivery = [...deliveryIndexes]
    .sort((a, b) => a - b)
    .map((index) => ({
      country: (form.get(`delivery.${index}.country`) ?? '').trim().toUpperCase(),
      minDays: num(form.get(`delivery.${index}.minDays`)),
      maxDays: num(form.get(`delivery.${index}.maxDays`)),
      cost: num(form.get(`delivery.${index}.cost`)),
      currency: (form.get(`delivery.${index}.currency`) ?? '').trim().toUpperCase(),
      carrier: form.get(`delivery.${index}.carrier`)?.trim() || undefined,
    }))
    // The form always renders one blank row for adding a country. An empty row
    // is not an error, it is an unused row.
    .filter((promise) => promise.country !== '')

  const warrantyMonths = form.get('warranty.months')
  const warrantySummary = form.get('warranty.summary')?.trim()

  const candidate = {
    market,
    language,
    returns: {
      windowDays: num(form.get('returns.windowDays')),
      returnShippingPaidBy: form.get('returns.returnShippingPaidBy') ?? 'merchant',
      restockingFee: false,
      exclusions: [],
      url: form.get('returns.url') ?? '',
    },
    delivery,
    vat: {
      pricesIncludeVat: form.get('vat.pricesIncludeVat') === 'true',
      ratePct: num(form.get('vat.ratePct')),
      registrationNumber: form.get('vat.registrationNumber')?.trim() || undefined,
    },
    warranty:
      warrantyMonths && warrantySummary
        ? { months: num(warrantyMonths), summary: warrantySummary }
        : undefined,
    privacyPolicyUrl: form.get('privacyPolicyUrl') ?? '',
    termsUrl: form.get('termsUrl') ?? '',
    updatedAt: new Date().toISOString(),
  }

  const parsed = policySchema.safeParse(candidate)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      error: first ? `${first.path.join('.')}: ${first.message}` : 'the policy did not validate',
    }
  }
  return { policy: parsed.data }
}

function num(value: string | null): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
