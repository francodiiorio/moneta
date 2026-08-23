import { z } from 'zod'

const amountString = z
  .string()
  .min(1, 'Ingresá un monto')
  .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' })
  .refine((v) => !v.trim().startsWith('-'), { message: 'El monto debe ser mayor a cero' })
  .refine((v) => /[1-9]/.test(v), { message: 'El monto debe ser mayor a cero' })

export const expenseIncomeFormSchema = z.object({
  date: z.string().min(1, 'Ingresá una fecha'),
  description: z.string().min(1, 'La descripción es obligatoria').max(120),
  accountId: z.string().min(1, 'Elegí una cuenta'),
  categoryId: z.string().min(1, 'Elegí una categoría'),
  amount: amountString,
})
export type ExpenseIncomeFormValues = z.infer<typeof expenseIncomeFormSchema>

export const transferFormSchema = z
  .object({
    date: z.string().min(1, 'Ingresá una fecha'),
    description: z.string().min(1, 'La descripción es obligatoria').max(120),
    fromAccountId: z.string().min(1, 'Elegí una cuenta de origen'),
    toAccountId: z.string().min(1, 'Elegí una cuenta de destino'),
    amount: amountString,
    toAmount: amountString.optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'Elegí dos cuentas distintas',
    path: ['toAccountId'],
  })
export type TransferFormValues = z.infer<typeof transferFormSchema>

export const newCategoryFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
})
export type NewCategoryFormValues = z.infer<typeof newCategoryFormSchema>
