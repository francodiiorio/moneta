import { z } from 'zod'

/**
 * Frozen copies of domain entity schemas that `schemas/v1.ts`,
 * `schemas/v2.ts` and `schemas/v3.ts` depend on but that no longer exist
 * (or no longer have this shape) in `@/domain/entities` — Account,
 * Posting, Transaction, the old kind-bearing Category, and the old
 * accountId-bearing InstallmentPlan/transactionId-bearing InvestmentLot,
 * all removed or reshaped by the "Simplificación: se elimina Cuentas,
 * Ingresos y Transferencias" rewrite (see docs/DECISIONS.md).
 *
 * A published backup schema is a compatibility contract that must keep
 * validating old files forever (see CLAUDE.md "Persistencia") — it can
 * never depend on the *current* domain module, since the domain is free
 * to change shape (as it just did, drastically) while old files must
 * still parse exactly as they did when they were written. This file is
 * therefore edited only to ADD a schema a future backup version needs
 * frozen — never to change one already used by a shipped backup version.
 */

const dateStamp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const isoInstant = z.string().datetime()
const currencyCode = z.string().min(3).max(8)
const minorAmount = z.number().int()
const id = z.string().min(1)

export const legacyAccountTypeSchema = z.enum(['cash', 'bank', 'card', 'investment', 'loan', 'other'])

export const legacyAccountSchema = z.object({
  id,
  name: z.string().min(1),
  type: legacyAccountTypeSchema,
  currency: currencyCode,
  openingBalance: minorAmount,
  isArchived: z.boolean(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyAccount = z.infer<typeof legacyAccountSchema>

export const legacyCategoryKindSchema = z.enum(['income', 'expense'])

export const legacyCategorySchema = z.object({
  id,
  name: z.string().min(1),
  kind: legacyCategoryKindSchema,
  parentId: id.optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  isArchived: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyCategory = z.infer<typeof legacyCategorySchema>

export const legacyTransactionKindSchema = z.enum(['income', 'expense', 'transfer', 'adjustment', 'investment'])
export const legacyTransactionStatusSchema = z.enum(['confirmed', 'projected'])

export const legacyTransactionFxSchema = z.object({
  rate: z.number().positive(),
  from: currencyCode,
  to: currencyCode,
})

export const legacyTransactionSchema = z.object({
  id,
  date: dateStamp,
  kind: legacyTransactionKindSchema,
  description: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: legacyTransactionStatusSchema,
  fx: legacyTransactionFxSchema.optional(),
  sourcePlanId: id.optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyTransaction = z.infer<typeof legacyTransactionSchema>

export const legacyPostingTargetSchema = z.enum(['account', 'category'])

export const legacyPostingSchema = z
  .object({
    id,
    transactionId: id,
    target: legacyPostingTargetSchema,
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
export type LegacyPosting = z.infer<typeof legacyPostingSchema>

const recurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'yearly'])

const legacyRecurrenceRuleSchema = z.object({
  freq: recurrenceFrequencySchema,
  interval: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  startDate: dateStamp,
  endDate: dateStamp.optional(),
  maxOccurrences: z.number().int().positive().optional(),
})

export const legacyTransactionTemplateSchema = z.object({
  description: z.string().min(1),
  kind: legacyTransactionKindSchema,
  accountId: id,
  categoryId: id.optional(),
  toAccountId: id.optional(),
  amount: minorAmount,
  currency: currencyCode,
})
export type LegacyTransactionTemplate = z.infer<typeof legacyTransactionTemplateSchema>

export const legacyRecurringPlanSchema = z.object({
  id,
  template: legacyTransactionTemplateSchema,
  rule: legacyRecurrenceRuleSchema,
  lastMaterializedDate: dateStamp.optional(),
  isPaused: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyRecurringPlan = z.infer<typeof legacyRecurringPlanSchema>

export const legacyInstallmentPlanSchema = z.object({
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
export type LegacyInstallmentPlan = z.infer<typeof legacyInstallmentPlanSchema>

const quantityScaled = z.number().int().nonnegative()

/** As it existed while `schemas/v3.ts` was the latest version — includes
 *  the since-reverted `transactionId` (cuenta de origen), optional
 *  already, so this is unchanged from what a real v3 backup could have
 *  contained. */
export const legacyInvestmentLotSchema = z.object({
  id,
  assetId: id,
  quantity: quantityScaled,
  costPerUnit: minorAmount.optional(),
  currency: currencyCode,
  date: dateStamp,
  notes: z.string().optional(),
  transactionId: id.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyInvestmentLot = z.infer<typeof legacyInvestmentLotSchema>

/** `Category` as `schemas/v4.ts` shipped it: no `kind` — the Etapa 7
 *  simplification had removed income categories altogether. Frozen when
 *  Etapa 8 brought `kind` back as a required field (see ADR "Se
 *  reintroducen Cuentas, Ingresos y Transferencias"), so a real v4 file
 *  keeps validating exactly as it did. */
export const legacyCategoryV4Schema = z.object({
  id,
  name: z.string().min(1),
  parentId: id.optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number(),
  isArchived: z.boolean(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyCategoryV4 = z.infer<typeof legacyCategoryV4Schema>

/** `Expense` as `schemas/v4.ts` shipped it: no `accountId` (Etapa 8 added
 *  it as optional). Frozen so a stray `accountId` in a v4 file is still
 *  stripped, exactly as before, instead of now being validated. */
export const legacyExpenseV4Schema = z.object({
  id,
  date: dateStamp,
  amount: minorAmount.positive(),
  currency: currencyCode,
  categoryId: id,
  description: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: legacyTransactionStatusSchema,
  sourcePlanId: id.optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyExpenseV4 = z.infer<typeof legacyExpenseV4Schema>

/** `InvestmentLot` as `schemas/v4.ts`, `v5.ts` and `v6.ts` shipped it: no
 *  source account (Etapa 8, Fase 3 added `sourceAccountId`/`sourceAmount`/
 *  `sourceCurrency` plus a refine tying them together). Frozen so those
 *  versions keep validating — and stripping unknown keys — exactly as
 *  before. */
export const legacyInvestmentLotV4Schema = z.object({
  id,
  assetId: id,
  quantity: quantityScaled,
  costPerUnit: minorAmount.optional(),
  currency: currencyCode,
  date: dateStamp,
  notes: z.string().optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
})
export type LegacyInvestmentLotV4 = z.infer<typeof legacyInvestmentLotV4Schema>

/** `Expense` as `schemas/v5.ts`, `v6.ts` and `v7.ts` shipped it: with the
 *  optional `accountId` (Etapa 8, Fase 1) but before the credit-card fields
 *  and their refines (Fase 4). Frozen so those versions keep validating
 *  exactly as before. */
export const legacyExpenseV5Schema = legacyExpenseV4Schema.extend({
  accountId: id.optional(),
})
export type LegacyExpenseV5 = z.infer<typeof legacyExpenseV5Schema>
