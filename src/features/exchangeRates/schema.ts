import { z } from 'zod'
import { CURRENCIES } from '@/domain/money'

export const EXCHANGE_RATE_CURRENCIES = Object.keys(CURRENCIES)

/**
 * Parses a locale-loose decimal string (accepts "1200", "1200.50",
 * "1.200,50" or "1,200.50") into a plain float. The decimal separator is
 * assumed to be whichever of "," or "." appears last; any earlier
 * occurrence is a thousands separator and gets stripped — mirrors
 * domain/money/money.ts:parseAmount's algorithm, but returns a bare
 * ratio (not Money) since an exchange rate isn't a monetary amount.
 * A naive `replace(',', '.')` breaks on "1.200,00" (the placeholder
 * this form itself suggests): it only swaps the first comma, leaving
 * the thousands dot in place and producing "1.200.00" -> NaN.
 */
function parseRateNumber(value: string): number {
  const cleaned = value.trim().replace(/[^\d.,-]/g, '')
  const decimalIndex = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'))
  if (decimalIndex === -1) return Number(cleaned)

  const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '')
  const fractionPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '')
  return Number(`${integerPart || '0'}.${fractionPart || '0'}`)
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
  })
  .refine((v) => v.from !== v.to, { message: 'Elegí dos monedas distintas', path: ['to'] })
export type ExchangeRateFormValues = z.infer<typeof exchangeRateFormSchema>

export function rateValueToNumber(value: string): number {
  return parseRateNumber(value)
}
