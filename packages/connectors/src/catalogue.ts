import { z } from 'zod'
import type { Availability, Product } from '@facings/shared'

/** Shared normalisation for every ingest path, so a CSV row and a WooCommerce
 * product reach the diff engine in the same shape. */

export const AVAILABILITY_MAP: Record<string, Availability> = {
  instock: 'in_stock',
  in_stock: 'in_stock',
  'in stock': 'in_stock',
  available: 'in_stock',
  outofstock: 'out_of_stock',
  out_of_stock: 'out_of_stock',
  'out of stock': 'out_of_stock',
  onbackorder: 'preorder',
  backorder: 'preorder',
  preorder: 'preorder',
  discontinued: 'discontinued',
}

export function normaliseAvailability(raw: string | undefined | null): Availability {
  if (!raw) return 'unknown'
  return AVAILABILITY_MAP[raw.toString().trim().toLowerCase()] ?? 'unknown'
}

export const productInputSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  availability: z.string().optional(),
  url: z.string().url(),
  image: z.string().optional(),
  brand: z.string().optional(),
  gtin: z.string().optional(),
  mpn: z.string().optional(),
  marginPct: z.number().min(0).max(100).optional(),
  attributes: z.record(z.string()).optional(),
})

export type ProductInput = z.infer<typeof productInputSchema>

export function toProduct(storeId: string, input: ProductInput, updatedAt = new Date().toISOString()): Product {
  return {
    storeId,
    sku: input.sku.trim(),
    title: input.title.trim(),
    price: input.price,
    currency: input.currency.toUpperCase(),
    availability: normaliseAvailability(input.availability),
    url: input.url,
    image: input.image,
    brand: input.brand,
    gtin: input.gtin,
    mpn: input.mpn,
    marginPct: input.marginPct,
    attributes: input.attributes ?? {},
    updatedAt,
  }
}

/**
 * Attribute completeness, 0 to 1. Drives deterministic cause inference: a
 * misrepresented product with a thin attribute set has a likely explanation
 * that does not need a model to guess at. SPEC 4.5.
 */
export const KEY_ATTRIBUTES = [
  'brand',
  'gtin',
  'mpn',
  'material',
  'dimensions',
  'colour',
  'size',
  'compatibility',
  'use_case',
  'description',
] as const

export function attributeCompleteness(product: Product): number {
  let present = 0
  for (const key of KEY_ATTRIBUTES) {
    const direct = (product as unknown as Record<string, unknown>)[key]
    if (typeof direct === 'string' && direct.trim()) {
      present += 1
      continue
    }
    const attr = product.attributes[key] ?? product.attributes[key.replace('_', ' ')]
    if (attr && attr.trim()) present += 1
  }
  return present / KEY_ATTRIBUTES.length
}
