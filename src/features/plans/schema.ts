import { z } from 'zod'
import { recurrenceFrequencySchema } from '@/domain/entities'
import { CURRENCY_CODES } from '@/domain/money'

export const PLAN_CURRENCIES = CURRENCY_CODES

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

export const recurringPlanFormSchema = z.object({
  /** A gasto fijo or an ingreso fijo (a salary). */
  kind: z.enum(['expense', 'income']),
  description: z.string().min(1, 'La descripción es obligatoria').max(120),
  categoryId: z.string().min(1, 'Elegí una categoría'),
  currency: z.string().min(3).max(8),
  amount: amountString,
  freq: recurrenceFrequencySchema,
  interval: positiveIntString,
  dayOfMonth: z.string().optional(),
  startDate: z.string().min(1, 'Elegí una fecha de inicio'),
  endDate: z.string().optional(),
  maxOccurrences: z.string().optional(),
  /** '' = sin tarjeta; 'card:<id>' = tarjeta. */
  paymentMethod: z.string().refine((v) => v === '' || /^card:.+$/.test(v), { message: 'Medio de pago inválido' }),
}).refine((v) => v.kind !== 'income' || v.paymentMethod === '', {
  path: ['paymentMethod'],
  message: 'Un ingreso fijo no va con tarjeta',
})
export type RecurringPlanFormValues = z.infer<typeof recurringPlanFormSchema>

export const installmentPlanFormSchema = z
  .object({
    description: z.string().min(1, 'La descripción es obligatoria').max(120),
    categoryId: z.string().min(1, 'Elegí una categoría'),
    currency: z.string().min(3).max(8),
    totalAmount: amountString,
    count: positiveIntString,
    /** Without a card: the first cuota's due date — or, already under way,
     *  the due date of `currentCuota`. */
    firstDueDate: z.string().min(1, 'Elegí la fecha de la cuota'),
    purchaseDate: z.string().min(1, 'Elegí la fecha de compra'),
    /** '' = no card. With one, the first cuota's date is the purchase date
     *  and each cuota goes into its statement. */
    cardId: z.string(),
    /** A purchase already being paid when loaded. */
    alreadyPaying: z.boolean(),
    /** With a card, the cuota in the statement open today (the bank's
     *  number); without one, the next cuota to pay. */
    currentCuota: z.string(),
    /** With a card whose opening balance covers today's statement: that
     *  cuota is already inside it, so tracking starts at the next one. */
    currentCuotaInOpening: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (!values.alreadyPaying) return
    const n = Number(values.currentCuota)
    if (!/^\d+$/.test(values.currentCuota.trim()) || n < 1 || n > Number(values.count)) {
      ctx.addIssue({ code: 'custom', path: ['currentCuota'], message: `Una cuota entre 1 y ${values.count || 'la cantidad'}` })
    }
  })
export type InstallmentPlanFormValues = z.infer<typeof installmentPlanFormSchema>

/** Deliberately narrower than installmentPlanFormSchema — editing a plan
 *  never touches totalAmount/count/dates/currency, see
 *  installmentPlans.repo.ts:updateInstallmentPlan for why. */
export const installmentPlanEditFormSchema = z.object({
  description: z.string().min(1, 'La descripción es obligatoria').max(120),
  categoryId: z.string().min(1, 'Elegí una categoría'),
})
export type InstallmentPlanEditFormValues = z.infer<typeof installmentPlanEditFormSchema>

/** The recurring form's single payment-method value: '' (no card) or
 *  'card:<id>'. A debit account a plan named before Etapa 10 reads as ''
 *  — saving the plan from the form drops it. */
export function encodePaymentMethod(method: { cardId?: string | undefined }): string {
  return method.cardId ? `card:${method.cardId}` : ''
}

export function parsePaymentMethod(value: string): { cardId?: string } {
  const [type, id] = value.split(/:(.*)/s)
  return type === 'card' && id ? { cardId: id } : {}
}
