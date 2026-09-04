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
  investmentLotSchema,
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
 * shape, add v4.ts + migrations/v3_to_v4.ts instead. See
 * docs/DATA_MODEL.md "Versionado del backup".
 */
export const backupV3Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(3),
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
    investmentLots: z.array(investmentLotSchema),
  }),
})

export type BackupV3 = z.infer<typeof backupV3Schema>
export type BackupDataV3 = BackupV3['data']
