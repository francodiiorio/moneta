import { z } from 'zod'
import { recurrenceFrequencySchema } from '@/domain/entities'

const amountString = z
  .string()
  .min(1, 'Ingresá un monto')
  .refine((v) => /\d/.test(v), { message: 'Ingresá un monto válido' })
  .refine((v) => !v.trim().startsWith('-'), { message: 'El monto debe ser mayor a cero' })
  .refine((v) => /[1-9]/.test(v), { message: 'El monto debe ser mayor a cero' })

const positiveIntString = z
  .string()
  .min(1, 'Obligatorio')
  .refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, { message: 'Tiene que ser un número entero mayor a cero' })

export const recurringPlanKindSchema = z.enum(['expense', 'income', 'transfer'])

export const recurringPlanFormSchema = z
  .object({
    description: z.string().min(1, 'La descripción es obligatoria').max(120),
    kind: recurringPlanKindSchema,
    accountId: z.string().min(1, 'Elegí una cuenta'),
    categoryId: z.string(),
    toAccountId: z.string(),
    amount: amountString,
    freq: recurrenceFrequencySchema,
    interval: positiveIntString,
    dayOfMonth: z.string().optional(),
    startDate: z.string().min(1, 'Elegí una fecha de inicio'),
    endDate: z.string().optional(),
    maxOccurrences: z.string().optional(),
  })
  .refine((v) => v.kind === 'transfer' || !!v.categoryId, {
    message: 'Elegí una categoría',
    path: ['categoryId'],
  })
  .refine((v) => v.kind !== 'transfer' || !!v.toAccountId, {
    message: 'Elegí una cuenta de destino',
    path: ['toAccountId'],
  })
  .refine((v) => v.kind !== 'transfer' || v.accountId !== v.toAccountId, {
    message: 'Elegí dos cuentas distintas',
    path: ['toAccountId'],
  })
export type RecurringPlanFormValues = z.infer<typeof recurringPlanFormSchema>

export const installmentPlanFormSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria').max(120),
  accountId: z.string().min(1, 'Elegí una cuenta'),
  categoryId: z.string().min(1, 'Elegí una categoría'),
  totalAmount: amountString,
  count: positiveIntString,
  firstDueDate: z.string().min(1, 'Elegí la fecha de la primera cuota'),
  purchaseDate: z.string().min(1, 'Elegí la fecha de compra'),
})
export type InstallmentPlanFormValues = z.infer<typeof installmentPlanFormSchema>
