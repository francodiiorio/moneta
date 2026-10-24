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
  recurringPlanSchema,
  savingsHoldingSchema,
  settingsSchema,
} from '@/domain/entities'
import { BACKUP_FORMAT } from './v1'
import { legacyExpenseV5Schema, legacyInvestmentLotV4Schema } from './legacy'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v6.ts + migrations/v5_to_v6.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v5 (Etapa 8, Fase 1): Cuentas, Ingresos y Ajustes de saldo vuelven
 * como registros planos; `Category.kind` vuelve; `Expense.accountId`
 * opcional (débito).
 */
export const backupV5Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(5),
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
    investmentLots: z.array(legacyInvestmentLotV4Schema),
    accounts: z.array(accountSchema),
    incomes: z.array(incomeSchema),
    accountAdjustments: z.array(accountAdjustmentSchema),
  }),
})

export type BackupV5 = z.infer<typeof backupV5Schema>
export type BackupDataV5 = BackupV5['data']
