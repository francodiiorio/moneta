import { z } from 'zod'
import { CURRENCIES } from '@/domain/money'

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
