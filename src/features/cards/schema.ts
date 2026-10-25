import { z } from 'zod'

const dayString = z
  .string()
  .min(1, 'Ingresá un día')
  .refine((v) => /^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 31, { message: 'Un día entre 1 y 31' })

export const cardFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  closingDay: dayString,
  dueDay: dayString,
  /** Purchases on the closing day go to the next statement. */
  closingDayToNext: z.boolean(),
  notes: z.string().max(200),
})
export type CardFormValues = z.infer<typeof cardFormSchema>

export const statementDatesFormSchema = z
  .object({
    closeDate: z.string().min(1, 'Ingresá la fecha de cierre'),
    dueDate: z.string().min(1, 'Ingresá la fecha de vencimiento'),
  })
  .refine((v) => !v.closeDate || !v.dueDate || v.dueDate >= v.closeDate, {
    path: ['dueDate'],
    message: 'El vencimiento no puede ser anterior al cierre',
  })
export type StatementDatesFormValues = z.infer<typeof statementDatesFormSchema>

export const paymentFormSchema = z.object({
  date: z.string().min(1, 'Ingresá la fecha del pago'),
  lines: z.array(
    z.object({
      currency: z.string(),
      accountId: z.string().min(1, 'Elegí una cuenta'),
      /** Only asked for when the account is in another currency. */
      debitedAmount: z.string(),
    }),
  ),
})
export type PaymentFormValues = z.infer<typeof paymentFormSchema>

export interface ReconcileFormValues {
  /** One per currency asked; a blank bank total isn't compared. */
  lines: { currency: string; bankTotal: string }[]
  categoryId: string
  description: string
}
