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
 * shape, add v12.ts + migrations/v11_to_v12.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v11 (Etapa 9, Fase 3): la forma de la v10 más campos opcionales (un plan
 * recurrente de ingreso, `RecurringPlan.kind`; el origen de un ingreso
 * generado, `Income.sourcePlanId`/`occurrenceIndex`). Cambia lo que significa
 * la fecha de una cuota con tarjeta (salvo la primera): el último día que
 * toma su resumen, no el día de la compra corrido N meses. La migración desde
 * la v10 re-fecha las cuotas de ese archivo.
 */
export const backupV11Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(11),
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

export type BackupV11 = z.infer<typeof backupV11Schema>
export type BackupDataV11 = BackupV11['data']
