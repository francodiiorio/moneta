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
import { BACKUP_FORMAT } from './v1'
import {
  legacyCategoryV4Schema,
  legacyExpenseV4Schema,
  legacyInstallmentPlanV4Schema,
  legacyInvestmentLotV4Schema,
  legacyRecurringPlanV4Schema,
} from './legacy'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v5.ts + migrations/v4_to_v5.ts instead. See
 * docs/DATA_MODEL.md "Versionado del backup".
 */
export const backupV4Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(4),
  exportedAt: z.string().datetime(),
  app: z.object({ name: z.string(), version: z.string() }),
  checksum: z.string(),
  data: z.object({
    categories: z.array(legacyCategoryV4Schema),
    expenses: z.array(legacyExpenseV4Schema),
    recurringPlans: z.array(legacyRecurringPlanV4Schema),
    installmentPlans: z.array(legacyInstallmentPlanV4Schema),
    budgets: z.array(budgetSchema),
    exchangeRates: z.array(exchangeRateSchema),
    settings: settingsSchema.optional(),
    savingsHoldings: z.array(savingsHoldingSchema),
    investmentAssets: z.array(investmentAssetSchema),
    investmentHoldings: z.array(investmentHoldingSchema),
    assetPrices: z.array(assetPriceSchema),
    investmentLots: z.array(legacyInvestmentLotV4Schema),
  }),
})

export type BackupV4 = z.infer<typeof backupV4Schema>
export type BackupDataV4 = BackupV4['data']
