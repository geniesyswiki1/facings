import { readFile } from 'node:fs/promises'
import type { Product } from '@showing-up/shared'
import { productInputSchema, toProduct } from './catalogue.js'

/**
 * Manual CSV ingest: the Phase 0 path for the four platforms without a
 * connector yet, and the fallback whenever a merchant will not hand over API
 * credentials for a free audit. Header names are matched case insensitively.
 */

export interface CsvImportResult {
  products: Product[]
  /** Row-level problems, reported rather than thrown: a bad row must not lose the run. */
  warnings: string[]
}

const HEADER_ALIASES: Record<string, string> = {
  id: 'sku',
  sku: 'sku',
  'product id': 'sku',
  name: 'title',
  title: 'title',
  'product name': 'title',
  price: 'price',
  'sale price': 'price',
  currency: 'currency',
  availability: 'availability',
  stock: 'availability',
  'stock status': 'availability',
  url: 'url',
  link: 'url',
  'product url': 'url',
  image: 'image',
  'image link': 'image',
  'image url': 'image',
  brand: 'brand',
  gtin: 'gtin',
  ean: 'gtin',
  barcode: 'gtin',
  mpn: 'mpn',
  'margin pct': 'marginPct',
  margin: 'marginPct',
}

/** Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',' || char === ';' || char === '\t') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export function importCsvText(storeId: string, text: string, defaultCurrency = 'GBP'): CsvImportResult {
  const rows = parseCsv(text)
  const warnings: string[] = []
  const products: Product[] = []
  const headerRow = rows[0]
  if (!headerRow) return { products, warnings: ['the CSV is empty'] }

  const headers = headerRow.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim())
  const unknown = headerRow.filter((h) => !HEADER_ALIASES[h.trim().toLowerCase()])
  if (unknown.length) warnings.push(`columns kept as attributes: ${unknown.join(', ')}`)

  for (const [index, row] of rows.slice(1).entries()) {
    const record: Record<string, string> = {}
    const attributes: Record<string, string> = {}
    headers.forEach((header, column) => {
      const value = (row[column] ?? '').trim()
      if (!value) return
      if (Object.values(HEADER_ALIASES).includes(header)) record[header] = value
      else attributes[header.toLowerCase().replace(/\s+/g, '_')] = value
    })

    const priceText = (record.price ?? '').replace(/[^\d.,-]/g, '').replace(',', '.')
    const candidate = {
      sku: record.sku,
      title: record.title,
      price: Number.parseFloat(priceText),
      currency: record.currency ?? defaultCurrency,
      availability: record.availability,
      url: record.url,
      image: record.image,
      brand: record.brand,
      gtin: record.gtin,
      mpn: record.mpn,
      marginPct: record.marginPct ? Number.parseFloat(record.marginPct) : undefined,
      attributes,
    }

    const parsed = productInputSchema.safeParse(candidate)
    if (!parsed.success) {
      const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      warnings.push(`row ${index + 2} skipped, ${reason}`)
      continue
    }
    products.push(toProduct(storeId, parsed.data))
  }

  return { products, warnings }
}

export async function importCsvFile(storeId: string, path: string, defaultCurrency?: string): Promise<CsvImportResult> {
  return importCsvText(storeId, await readFile(path, 'utf8'), defaultCurrency)
}
