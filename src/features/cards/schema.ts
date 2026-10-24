import { z } from 'zod'

const dayString = z
  .string()
  .min(1, 'Ingresá un día')
  .refine((v) => /^\d{1,2}$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 31, { message: 'Un día entre 1 y 31' })

export const cardFormSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(60),
  closingDay: dayString,
  dueDay: dayString,
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
