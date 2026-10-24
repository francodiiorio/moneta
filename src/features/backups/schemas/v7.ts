import { z } from 'zod'
import {
  accountAdjustmentSchema,
  accountSchema,
  assetPriceSchema,
  budgetSchema,
  categorySchema,
  exchangeRateSchema,
  incomeSchema,
  installmentPlanSchema,
  investmentAssetSchema,
  investmentHoldingSchema,
  investmentLotSchema,
  recurringPlanSchema,
  savingsHoldingSchema,
  settingsSchema,
  transferSchema,
} from '@/domain/entities'
import { BACKUP_FORMAT } from './v1'
import { legacyExpenseV5Schema } from './legacy'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v8.ts + migrations/v7_to_v8.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v7 (Etapa 8, Fase 3): `InvestmentLot` suma la cuenta de origen opcional
 * (`sourceAccountId` + `sourceAmount` + `sourceCurrency`). Nada más cambia
 * respecto de la v6.
 */
export const backupV7Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(7),
  exportedAt: z.string().datetime(),
  app: z.object({ name: z.string(), version: z.string() }),
  checksum: z.string(),
  data: z.object({
    categories: z.array(categorySchema),
    expenses: z.array(legacyExpenseV5Schema),
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
    accounts: z.array(accountSchema),
    incomes: z.array(incomeSchema),
    accountAdjustments: z.array(accountAdjustmentSchema),
    transfers: z.array(transferSchema),
  }),
})

export type BackupV7 = z.infer<typeof backupV7Schema>
export type BackupDataV7 = BackupV7['data']
