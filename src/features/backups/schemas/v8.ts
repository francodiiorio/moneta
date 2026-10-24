import { z } from 'zod'
import {
  accountAdjustmentSchema,
  accountSchema,
  assetPriceSchema,
  budgetSchema,
  cardStatementSchema,
  categorySchema,
  creditCardSchema,
  exchangeRateSchema,
  expenseSchema,
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

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v9.ts + migrations/v8_to_v9.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v8 (Etapa 8, Fase 4): tarjetas de crédito (`creditCards`), fechas
 * corregidas de sus resúmenes (`cardStatements`), y `Expense.cardId` +
 * `statementPeriod`.
 */
export const backupV8Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(8),
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
    investmentLots: z.array(investmentLotSchema),
    accounts: z.array(accountSchema),
    incomes: z.array(incomeSchema),
    accountAdjustments: z.array(accountAdjustmentSchema),
    transfers: z.array(transferSchema),
    creditCards: z.array(creditCardSchema),
    cardStatements: z.array(cardStatementSchema),
  }),
})

export type BackupV8 = z.infer<typeof backupV8Schema>
export type BackupDataV8 = BackupV8['data']
