import { z } from 'zod'
import { CURRENCY_CODES } from '@/domain/money'

export const EXPENSE_CURRENCIES = CURRENCY_CODES

export const amountString = z
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
  /** '' or absent = no account (credit card, or unspecified). */
  accountId: z.string().optional(),
})
export type ExpenseFormValues = z.infer<typeof expenseFormSchema>

export const incomeFormSchema = expenseFormSchema.extend({
  accountId: z.string().min(1, 'Elegí la cuenta donde entró'),
})
export type IncomeFormValues = z.infer<typeof incomeFormSchema>

export const movementKindSchema = z.enum(['expense', 'income'])
export type MovementKind = z.infer<typeof movementKindSchema>

/** The Movimientos dialog's own shape: one form for both kinds, so
 *  switching Gasto/Ingreso keeps what was already typed. An ingreso
 *  always needs an account; a gasto never does. */
export const movementFormSchema = expenseFormSchema
  .extend({ kind: movementKindSchema, accountId: z.string() })
  .superRefine((values, ctx) => {
    if (values.kind === 'income' && !values.accountId) {
      ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Elegí la cuenta donde entró' })
    }
  })
export type MovementFormValues = z.infer<typeof movementFormSchema>

// Amounts are only checked for "some positive number" here: which
// currency each one is in (and so how it parses) depends on the chosen
// accounts — see service.ts:saveTransferFromForm. `toAmount` is only asked
// for when the two accounts have different currencies.
const optionalAmountString = z.string()

export const transferFormSchema = z
  .object({
    date: z.string().min(1, 'Ingresá una fecha'),
    description: z.string().max(120),
    fromAccountId: z.string().min(1, 'Elegí la cuenta de origen'),
    toAccountId: z.string().min(1, 'Elegí la cuenta de destino'),
    fromAmount: amountString,
    toAmount: optionalAmountString,
  })
  .refine((v) => !v.fromAccountId || v.fromAccountId !== v.toAccountId, {
    path: ['toAccountId'],
    message: 'Elegí una cuenta distinta a la de origen',
  })
export type TransferFormValues = z.infer<typeof transferFormSchema>

export const newCategoryFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
})
export type NewCategoryFormValues = z.infer<typeof newCategoryFormSchema>
