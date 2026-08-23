import { z } from 'zod'
import {
  accountSchema,
  assetPriceSchema,
  budgetSchema,
  categorySchema,
  exchangeRateSchema,
  installmentPlanSchema,
  investmentAssetSchema,
  investmentHoldingSchema,
  postingSchema,
  recurringPlanSchema,
  savingsHoldingSchema,
  settingsSchema,
  transactionSchema,
} from '@/domain/entities'
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
    accounts: z.array(accountSchema),
    categories: z.array(categorySchema),
    transactions: z.array(transactionSchema),
    postings: z.array(postingSchema),
    recurringPlans: z.array(recurringPlanSchema),
    installmentPlans: z.array(installmentPlanSchema),
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
