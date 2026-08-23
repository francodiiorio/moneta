import { z } from 'zod'
import { accountTypeSchema } from '@/domain/entities'

export const ACCOUNT_CURRENCIES = ['ARS', 'USD'] as const

export const accountFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  type: accountTypeSchema,
  currency: z.enum(ACCOUNT_CURRENCIES),
  openingBalance: z
    .string()
    .min(1, 'Ingresá un monto')
    .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' }),
})

export type AccountFormValues = z.infer<typeof accountFormSchema>
