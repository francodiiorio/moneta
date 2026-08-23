import { z } from 'zod'

const dateStamp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const monthStamp = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')
const isoInstant = z.string().datetime()
const currencyCode = z.string().min(3).max(8)
const minorAmount = z.number().int()
const id = z.string().min(1)

export const accountTypeSchema = z.enum(['cash', 'bank', 'card', 'investment', 'loan', 'other'])

export const accountSchema = z.object({
  id,
  name: z.string().min(1),
  type: accountTypeSchema,
  currency: currencyCode,
  openingBalance: minorAmount,
  isArchived: z.boolean(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Account = z.infer<typeof accountSchema>

export const categoryKindSchema = z.enum(['income', 'expense'])

export const categorySchema = z.object({
  id,
  name: z.string().min(1),
  kind: categoryKindSchema,
  parentId: id.optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  isArchived: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Category = z.infer<typeof categorySchema>

export const transactionKindSchema = z.enum(['income', 'expense', 'transfer', 'adjustment'])
export const transactionStatusSchema = z.enum(['confirmed', 'projected'])

export const transactionFxSchema = z.object({
  rate: z.number().positive(),
  from: currencyCode,
  to: currencyCode,
})

export const transactionSchema = z.object({
  id,
  date: dateStamp,
  kind: transactionKindSchema,
  description: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: transactionStatusSchema,
  fx: transactionFxSchema.optional(),
  sourcePlanId: id.optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Transaction = z.infer<typeof transactionSchema>

export const postingTargetSchema = z.enum(['account', 'category'])

export const postingSchema = z
  .object({
    id,
    transactionId: id,
    target: postingTargetSchema,
    accountId: id.optional(),
    categoryId: id.optional(),
    amount: minorAmount,
    currency: currencyCode,
    date: dateStamp,
  })
  .refine((p) => (p.target === 'account' ? !!p.accountId && !p.categoryId : true), {
    message: 'Account postings must set accountId and not categoryId',
  })
  .refine((p) => (p.target === 'category' ? !!p.categoryId && !p.accountId : true), {
    message: 'Category postings must set categoryId and not accountId',
  })
export type Posting = z.infer<typeof postingSchema>

export const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly'])

export const recurrenceRuleSchema = z.object({
  freq: recurrenceFrequencySchema,
  interval: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  startDate: dateStamp,
  endDate: dateStamp.optional(),
  maxOccurrences: z.number().int().positive().optional(),
})
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>

export const transactionTemplateSchema = z.object({
  description: z.string().min(1),
  kind: transactionKindSchema,
  accountId: id,
  categoryId: id.optional(),
  toAccountId: id.optional(),
  amount: minorAmount,
  currency: currencyCode,
})
export type TransactionTemplate = z.infer<typeof transactionTemplateSchema>

export const recurringPlanSchema = z.object({
  id,
  template: transactionTemplateSchema,
  rule: recurrenceRuleSchema,
  lastMaterializedDate: dateStamp.optional(),
  isPaused: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type RecurringPlan = z.infer<typeof recurringPlanSchema>

export const installmentPlanSchema = z.object({
  id,
  description: z.string().min(1),
  accountId: id,
  categoryId: id,
  totalAmount: minorAmount,
  currency: currencyCode,
  count: z.number().int().positive(),
  firstDueDate: dateStamp,
  purchaseDate: dateStamp,
  scheduleCache: z.array(minorAmount),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type InstallmentPlan = z.infer<typeof installmentPlanSchema>

export const budgetPeriodSchema = z.enum(['monthly', 'yearly'])

export const budgetSchema = z.object({
  id,
  categoryId: id,
  currency: currencyCode,
  period: budgetPeriodSchema,
  amount: minorAmount,
  startsOn: monthStamp,
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type Budget = z.infer<typeof budgetSchema>

export const exchangeRateSchema = z.object({
  id,
  date: dateStamp,
  from: currencyCode,
  to: currencyCode,
  rate: z.number().positive(),
})
export type ExchangeRate = z.infer<typeof exchangeRateSchema>

export const themeSchema = z.enum(['light', 'dark', 'system'])

export const settingsSchema = z.object({
  id: z.literal('singleton'),
  baseCurrency: currencyCode,
  locale: z.string(),
  firstDayOfMonth: z.number().int().min(1).max(28),
  theme: themeSchema,
  schemaVersion: z.number().int().nonnegative(),
})
export type Settings = z.infer<typeof settingsSchema>
