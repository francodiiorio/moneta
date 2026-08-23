import { z } from 'zod'
import { budgetPeriodSchema } from '@/domain/entities'

export const budgetFormSchema = z.object({
  categoryId: z.string().min(1, 'Elegí una categoría'),
  period: budgetPeriodSchema,
  amount: z
    .string()
    .min(1, 'Ingresá un monto')
    .refine((v) => !v.trim().startsWith('-'), { message: 'El monto debe ser mayor a cero' })
    .refine((v) => /[1-9]/.test(v), { message: 'El monto debe ser mayor a cero' }),
  startsOn: z.string().min(1, 'Elegí un mes'),
})
export type BudgetFormValues = z.infer<typeof budgetFormSchema>
