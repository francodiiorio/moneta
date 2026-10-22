import { z } from 'zod'
import {
  accountAdjustmentSchema,
  accountSchema,
  assetPriceSchema,
  budgetSchema,
  categorySchema,
  exchangeRateSchema,
  expenseSchema,
  incomeSchema,
  installmentPlanSchema,
  investmentAssetSchema,
  investmentHoldingSchema,
  recurringPlanSchema,
  savingsHoldingSchema,
  settingsSchema,
  transferSchema,
} from '@/domain/entities'
import { BACKUP_FORMAT } from './v1'
import { legacyInvestmentLotV4Schema } from './legacy'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v7.ts + migrations/v6_to_v7.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v6 (Etapa 8, Fase 2): suma `transfers` — transferencias entre cuentas.
 * Ninguna entidad existente cambia de forma respecto de la v5.
 */
export const backupV6Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(6),
  exportedAt: z.string().datetime(),
  app: z.object({ name: z.string(), version: z.string() }),
  checksum: z.string(),
  data: z.object({
    categories: z.array(categorySchema),
    expenses: z.array(expenseSchema),
    recurringPlans: z.array(recurringPlanSchema),
    installmentPlans: z.array(installmentPlanSchema),
    budgets: z.array(budgetSchema),
    exchangeRates: z.array(exchangeRateSchema),
    settings: settingsSchema.optional(),
    savingsHoldings: z.array(savingsHoldingSchema),
    investmentAssets: z.array(investmentAssetSchema),
    investmentHoldings: z.array(investmentHoldingSchema),
    assetPrices: z.array(assetPriceSchema),
    investmentLots: z.array(legacyInvestmentLotV4Schema),
    accounts: z.array(accountSchema),
    incomes: z.array(incomeSchema),
    accountAdjustments: z.array(accountAdjustmentSchema),
    transfers: z.array(transferSchema),
  }),
})

export type BackupV6 = z.infer<typeof backupV6Schema>
export type BackupDataV6 = BackupV6['data']
