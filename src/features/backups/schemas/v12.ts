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
 * shape, add v13.ts + migrations/v12_to_v13.ts instead. See
 * docs/DATA_MODEL.md "Formato de backup".
 *
 * v12 (Etapa 10, sin cuentas): la forma de la v11 con la cuenta opcional
 * donde era obligatoria — un ingreso (`Income.accountId`), un pago de
 * resumen (`accountId`/`debitedAmount`/`debitedCurrency`, los tres o
 * ninguno) y un ingreso fijo (`template.accountId`). Las cuentas,
 * transferencias y ajustes de antes siguen viajando: la app deja de
 * usarlos, no los borra. Un archivo v11 ya es una v12 válida.
 */
export const backupV12Schema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(12),
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

export type BackupV12 = z.infer<typeof backupV12Schema>
export type BackupDataV12 = BackupV12['data']
