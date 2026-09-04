import { negate, type Money } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'
import type { LedgerEntryDraft } from './types'

interface BaseParams {
  date: DateStamp
  description: string
  notes?: string
  tags?: string[]
  /** Defaults to 'confirmed'. A materialized recurring/installment
   *  occurrence in the future passes 'projected' instead — see
   *  domain/recurrence and domain/installments. */
  status?: LedgerEntryDraft['status']
  sourcePlanId?: string
  occurrenceIndex?: number
}

export function buildExpense(
  params: BaseParams & { accountId: string; categoryId: string; amount: Money },
): LedgerEntryDraft {
  const { accountId, categoryId, amount, ...base } = params
  return {
    ...base,
    kind: 'expense',
    status: base.status ?? 'confirmed',
    postings: [
      { target: 'account', accountId, amount: negate(amount).amount, currency: amount.currency },
      { target: 'category', categoryId, amount: amount.amount, currency: amount.currency },
    ],
  }
}

export function buildIncome(
  params: BaseParams & { accountId: string; categoryId: string; amount: Money },
): LedgerEntryDraft {
  const { accountId, categoryId, amount, ...base } = params
  return {
    ...base,
    kind: 'income',
    status: base.status ?? 'confirmed',
    postings: [
      { target: 'account', accountId, amount: amount.amount, currency: amount.currency },
      { target: 'category', categoryId, amount: negate(amount).amount, currency: amount.currency },
    ],
  }
}

/** Compra de una inversión pagada desde una cuenta: sale la plata de la
 *  cuenta, entra a la categoría-contrapartida fija "Compra de
 *  inversiones" — misma forma que buildExpense, pero kind: 'investment'
 *  la deja afuera de Gasto por categoría y Presupuestos sin ningún caso
 *  especial (los dos filtran por Transaction.kind, nunca por el kind de
 *  la categoría). Ver ADR "Una compra de inversión no es un gasto" en
 *  docs/DECISIONS.md. */
export function buildInvestmentPurchase(
  params: BaseParams & { accountId: string; categoryId: string; amount: Money },
): LedgerEntryDraft {
  const { accountId, categoryId, amount, ...base } = params
  return {
    ...base,
    kind: 'investment',
    status: base.status ?? 'confirmed',
    postings: [
      { target: 'account', accountId, amount: negate(amount).amount, currency: amount.currency },
      { target: 'category', categoryId, amount: amount.amount, currency: amount.currency },
    ],
  }
}

/** Same-currency transfer between two accounts. */
export function buildTransfer(
  params: BaseParams & { fromAccountId: string; toAccountId: string; amount: Money },
): LedgerEntryDraft {
  const { fromAccountId, toAccountId, amount, ...base } = params
  return {
    ...base,
    kind: 'transfer',
    status: base.status ?? 'confirmed',
    postings: [
      {
        target: 'account',
        accountId: fromAccountId,
        amount: negate(amount).amount,
        currency: amount.currency,
      },
      {
        target: 'account',
        accountId: toAccountId,
        amount: amount.amount,
        currency: amount.currency,
      },
    ],
  }
}

/** Cross-currency transfer: `fromAmount` leaves `fromAccountId`,
 *  `toAmount` (already converted) arrives at `toAccountId`. `rate` is
 *  the fromAmount.currency -> toAmount.currency factor that produced
 *  `toAmount`, recorded so the invariant check can verify it and so the
 *  transaction stays self-explanatory in history. */
export function buildFxTransfer(
  params: BaseParams & {
    fromAccountId: string
    toAccountId: string
    fromAmount: Money
    toAmount: Money
    rate: number
  },
): LedgerEntryDraft {
  const { fromAccountId, toAccountId, fromAmount, toAmount, rate, ...base } = params
  return {
    ...base,
    kind: 'transfer',
    status: base.status ?? 'confirmed',
    fx: { rate, from: fromAmount.currency, to: toAmount.currency },
    postings: [
      {
        target: 'account',
        accountId: fromAccountId,
        amount: negate(fromAmount).amount,
        currency: fromAmount.currency,
      },
      {
        target: 'account',
        accountId: toAccountId,
        amount: toAmount.amount,
        currency: toAmount.currency,
      },
    ],
  }
}
