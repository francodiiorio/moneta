import { z } from 'zod'
import {
  assetPriceSchema,
  budgetSchema,
  exchangeRateSchema,
  investmentAssetSchema,
  investmentHoldingSchema,
  savingsHoldingSchema,
  settingsSchema,
} from '@/domain/entities'
import {
  legacyAccountSchema,
  legacyCategorySchema,
  legacyInstallmentPlanSchema,
  legacyPostingSchema,
  legacyRecurringPlanSchema,
  legacyTransactionSchema,
} from './legacy'
import { BACKUP_FORMAT } from './v1'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v3.ts + migrations/v2_to_v3.ts instead. See
 * docs/DATA_MODEL.md "Versionado del backup".
 */
export const backupV2Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(2),
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
    savingsHoldings: z.array(savingsHoldingSchema),
    investmentAssets: z.array(investmentAssetSchema),
    investmentHoldings: z.array(investmentHoldingSchema),
    assetPrices: z.array(assetPriceSchema),
  }),
})

export type BackupV2 = z.infer<typeof backupV2Schema>
export type BackupDataV2 = BackupV2['data']
