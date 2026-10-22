import { z } from 'zod'
import { accountTypeSchema } from '@/domain/entities'
import { CURRENCY_CODES } from '@/domain/money'
import { todayStamp } from '@/lib/dates'

export const ACCOUNT_CURRENCIES = CURRENCY_CODES

// Unlike a gasto, a balance can be zero or negative (an overdraft), so
// this only requires *some* number — not a positive one.
const signedAmountString = z
  .string()
  .min(1, 'Ingresá un monto')
  .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' })

const notFuture = (v: string) => v <= todayStamp()

export const accountFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  type: accountTypeSchema,
  currency: z.string().min(1, 'Elegí una moneda'),
  openingBalance: signedAmountString,
  openingDate: z.string().min(1, 'Ingresá una fecha').refine(notFuture, 'La fecha no puede ser futura'),
  notes: z.string().max(200),
})
export type AccountFormValues = z.infer<typeof accountFormSchema>

export const adjustBalanceFormSchema = z.object({
  realBalance: signedAmountString,
  date: z.string().min(1, 'Ingresá una fecha').refine(notFuture, 'La fecha no puede ser futura'),
  description: z.string().max(120),
})
export type AdjustBalanceFormValues = z.infer<typeof adjustBalanceFormSchema>
