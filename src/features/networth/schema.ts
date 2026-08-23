import { z } from 'zod'
import { CURRENCIES } from '@/domain/money'
import { investmentAssetTypeSchema } from '@/domain/entities'

export const NETWORTH_CURRENCIES = Object.keys(CURRENCIES)

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
})

export type InvestmentAssetFormValues = z.infer<typeof investmentAssetFormSchema>

export const investmentHoldingFormSchema = z.object({
  assetId: z.string().min(1, 'Elegí un activo'),
  quantity: z
    .string()
    .min(1, 'Ingresá una cantidad')
    .refine((v) => !v.trim().startsWith('-'), { message: 'La cantidad no puede ser negativa' })
    .refine((v) => /[1-9]/.test(v), { message: 'La cantidad debe ser mayor a cero' }),
  averageCost: z
    .string()
    .optional()
    .refine((v) => !v || !v.trim().startsWith('-'), { message: 'El costo promedio no puede ser negativo' })
    .refine((v) => !v || /\d/.test(v), { message: 'Ingresá un costo promedio válido' }),
})

export type InvestmentHoldingFormValues = z.infer<typeof investmentHoldingFormSchema>

export const investmentPriceFormSchema = z.object({
  price: z
    .string()
    .min(1, 'Ingresá un precio')
    .refine((v) => !v.trim().startsWith('-'), { message: 'El precio debe ser mayor a cero' })
    .refine((v) => /[1-9]/.test(v), { message: 'El precio debe ser mayor a cero' }),
  date: z.string().min(1, 'Ingresá una fecha'),
})

export type InvestmentPriceFormValues = z.infer<typeof investmentPriceFormSchema>
