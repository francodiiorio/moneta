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
  statementPaymentSchema,
  transferSchema,
} from '@/domain/entities'
import { BACKUP_FORMAT } from './v1'

/**
 * Never edit this schema once it has shipped in a released version —
 * a published backup format is a compatibility contract. To change the
 * shape, add v11.ts + migrations/v10_to_v11.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v10 (Etapa 8, Fase 5): pagos de resúmenes de tarjeta
 * (`statementPayments`). Ninguna entidad existente cambia respecto de la v9.
 */
export const backupV10Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(10),
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
    statementPayments: z.array(statementPaymentSchema),
  }),
})

export type BackupV10 = z.infer<typeof backupV10Schema>
export type BackupDataV10 = BackupV10['data']
