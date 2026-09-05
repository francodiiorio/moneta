import { z } from 'zod'
import { CURRENCY_CODES } from '@/domain/money'

export const EXPENSE_CURRENCIES = CURRENCY_CODES

const amountString = z
  .string()
  .min(1, 'Ingresá un monto')
  .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' })
  .refine((v) => !v.trim().startsWith('-'), { message: 'El monto debe ser mayor a cero' })
  .refine((v) => /[1-9]/.test(v), { message: 'El monto debe ser mayor a cero' })

export const expenseFormSchema = z.object({
  date: z.string().min(1, 'Ingresá una fecha'),
  description: z.string().min(1, 'La descripción es obligatoria').max(120),
  categoryId: z.string().min(1, 'Elegí una categoría'),
  currency: z.string().min(3).max(8),
  amount: amountString,
})
export type ExpenseFormValues = z.infer<typeof expenseFormSchema>

export const newCategoryFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
})
export type NewCategoryFormValues = z.infer<typeof newCategoryFormSchema>
