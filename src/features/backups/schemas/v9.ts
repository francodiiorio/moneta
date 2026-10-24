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
  investmentAssetSchema,
  investmentHoldingSchema,
  installmentPlanSchema,
  investmentLotSchema,
  savingsHoldingSchema,
  recurringPlanSchema,
  settingsSchema,
  transferSchema,
} from '@/domain/entities'
import { BACKUP_FORMAT } from './v1'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v10.ts + migrations/v9_to_v10.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v9 (Etapa 8, Fase 4b): medio de pago en planes — `RecurringPlan.template`
 * gana `accountId`/`cardId` y `InstallmentPlan` gana `cardId`. Nada más
 * cambia respecto de la v8.
 */
export const backupV9Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(9),
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

export type BackupV9 = z.infer<typeof backupV9Schema>
export type BackupDataV9 = BackupV9['data']
