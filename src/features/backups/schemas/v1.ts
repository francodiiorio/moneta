import { z } from 'zod'
import { budgetSchema, exchangeRateSchema, settingsSchema } from '@/domain/entities'
import {
  legacyAccountSchema,
  legacyCategorySchema,
  legacyInstallmentPlanSchema,
  legacyPostingSchema,
  legacyRecurringPlanSchema,
  legacyTransactionSchema,
} from './legacy'

export const BACKUP_FORMAT = 'moneta-backup'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v2.ts + migrations/v1_to_v2.ts instead. See
 * docs/DATA_MODEL.md "Versionado del backup".
 */
export const backupV1Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  app: z.object({ name: z.string(), version: z.string() }),
  checksum: z.string(),
  data: z.object({
    accounts: z.array(legacyAccountSchema),
    categories: z.array(legacyCategorySchema),
    transactions: z.array(legacyTransactionSchema),
    postings: z.array(legacyPostingSchema),
    recurringPlans: z.array(legacyRecurringPlanSchema),
    installmentPlans: z.array(legacyInstallmentPlanSchema),
    budgets: z.array(budgetSchema),
    exchangeRates: z.array(exchangeRateSchema),
    settings: settingsSchema.optional(),
  }),
})

export type BackupV1 = z.infer<typeof backupV1Schema>
export type BackupDataV1 = BackupV1['data']
