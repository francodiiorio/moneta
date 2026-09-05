import { z } from 'zod'
import { CURRENCY_CODES } from '@/domain/money'
import { investmentAssetTypeSchema } from '@/domain/entities'

export const NETWORTH_CURRENCIES = CURRENCY_CODES

export const savingsFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  currency: z.string().min(1, 'Elegí una moneda'),
  amount: z
    .string()
    .min(1, 'Ingresá un monto')
    .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' }),
  location: z.string().max(60).optional(),
  notes: z.string().max(280).optional(),
})

export type SavingsFormValues = z.infer<typeof savingsFormSchema>

export const investmentAssetFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  symbol: z.string().max(20).optional(),
  type: investmentAssetTypeSchema,
  currency: z.string().min(1, 'Elegí una moneda'),
  // Only meaningful when type === 'crypto' — CoinGecko is the only
  // automatic price provider wired up (Etapa 6C). autoPrice off means
  // priceMode: 'manual' regardless of what's in externalId.
  autoPrice: z.boolean(),
  externalId: z.string().max(80).optional(),
})

export type InvestmentAssetFormValues = z.infer<typeof investmentAssetFormSchema>

export const investmentLotFormSchema = z.object({
  assetId: z.string().min(1, 'Elegí un activo'),
  quantity: z
    .string()
    .min(1, 'Ingresá una cantidad')
    .refine((v) => !v.trim().startsWith('-'), { message: 'La cantidad no puede ser negativa' })
    .refine((v) => /[1-9]/.test(v), { message: 'La cantidad debe ser mayor a cero' }),
  costPerUnit: z
    .string()
    .optional()
    .refine((v) => !v || !v.trim().startsWith('-'), { message: 'El costo no puede ser negativo' })
    .refine((v) => !v || /\d/.test(v), { message: 'Ingresá un costo válido' }),
  date: z.string().min(1, 'Ingresá una fecha'),
})

export type InvestmentLotFormValues = z.infer<typeof investmentLotFormSchema>

export const investmentPriceFormSchema = z.object({
  price: z
    .string()
    .min(1, 'Ingresá un precio')
    .refine((v) => !v.trim().startsWith('-'), { message: 'El precio debe ser mayor a cero' })
    .refine((v) => /[1-9]/.test(v), { message: 'El precio debe ser mayor a cero' }),
  date: z.string().min(1, 'Ingresá una fecha'),
})

export type InvestmentPriceFormValues = z.infer<typeof investmentPriceFormSchema>

/** Sentinel for "no particular reference" in the profile Select — Radix
 *  Select disallows an empty-string item value, and `undefined` isn't
 *  representable as a controlled Select value either. */
export const NO_PROFILE = 'none'

/**
 * Parses a locale-loose decimal string (accepts "1200", "1200.50",
 * "1.200,50" or "1,200.50") into a plain float. The decimal separator is
 * assumed to be whichever of "," or "." appears last; any earlier
 * occurrence is a thousands separator and gets stripped — mirrors
 * domain/money/money.ts:parseAmount's algorithm, but returns a bare
 * ratio (not Money) since an exchange rate isn't a monetary amount.
 */
function parseRateNumber(value: string): number {
  const cleaned = value.trim().replace(/[^\d.,-]/g, '')
  const decimalIndex = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'))
  if (decimalIndex === -1) return Number(cleaned)

  const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '')
  const fractionPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '')
  return Number(`${integerPart || '0'}.${fractionPart || '0'}`)
}

export function rateValueToNumber(value: string): number {
  return parseRateNumber(value)
}

export const exchangeRateFormSchema = z
  .object({
    date: z.string().min(1, 'Ingresá una fecha'),
    from: z.string().min(1, 'Elegí una moneda de origen'),
    to: z.string().min(1, 'Elegí una moneda de destino'),
    rate: z
      .string()
      .min(1, 'Ingresá una tasa')
      .refine((v) => Number.isFinite(parseRateNumber(v)) && parseRateNumber(v) > 0, {
        message: 'La tasa debe ser un número mayor a cero',
      }),
    profile: z.string(),
  })
  .refine((v) => v.from !== v.to, { message: 'Elegí dos monedas distintas', path: ['to'] })

export type ExchangeRateFormValues = z.infer<typeof exchangeRateFormSchema>
