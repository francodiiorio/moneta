import type { Account, AccountAdjustment, Expense, Income } from '@/domain/entities'
import { add, money, negate, sub, type Money } from '@/domain/money'
import { formatFullDate, type DateStamp } from '@/lib/dates'

/** Anything that moves an account's balance, already signed: positive
 *  enters the account, negative leaves it. Always in the account's own
 *  currency — `add()` rejects a mismatch instead of mixing currencies. */
export interface AccountMovement {
  accountId: string
  date: DateStamp
  amount: Money
}

export interface AccountMovementSources {
  incomes: readonly Income[]
  expenses: readonly Expense[]
  adjustments: readonly AccountAdjustment[]
}

/** Flattens every record that touches an account into signed movements.
 *  Only `confirmed` expenses with an `accountId` count — a `projected`
 *  one hasn't happened yet (same rule reports/budgets follow), and one
 *  without `accountId` (credit card, or unspecified) never touched an
 *  account. Transfers, investment purchases and card payments join here
 *  in later phases of Etapa 8 (see docs/ROADMAP.md). */
export function toAccountMovements(sources: AccountMovementSources): AccountMovement[] {
  const movements: AccountMovement[] = []
  for (const income of sources.incomes) {
    movements.push({ accountId: income.accountId, date: income.date, amount: money(income.amount, income.currency) })
  }
  for (const expense of sources.expenses) {
    if (expense.accountId === undefined || expense.status !== 'confirmed') continue
    movements.push({
      accountId: expense.accountId,
      date: expense.date,
      amount: negate(money(expense.amount, expense.currency)),
    })
  }
  for (const adjustment of sources.adjustments) {
    movements.push({
      accountId: adjustment.accountId,
      date: adjustment.date,
      amount: money(adjustment.amount, adjustment.currency),
    })
  }
  return movements
}

export type BalanceAccount = Pick<Account, 'id' | 'currency' | 'openingBalance' | 'openingDate'>

/**
 * The account's balance at the end of `date`: opening balance plus every
 * movement dated between `openingDate` and `date`, inclusive.
 * `undefined` when `date` is before `openingDate` — the account didn't
 * exist yet for Moneta, which is not the same as a zero balance (the
 * net worth history must leave it out, not count it as $0).
 *
 * A movement dated before `openingDate` is rejected on every write path
 * (repositories, backup validation) — skipping it here is only a defense
 * for data that somehow got past those, so it can't silently count twice
 * against an opening balance that already includes it.
 */
export function accountBalanceAt(
  account: BalanceAccount,
  movements: readonly AccountMovement[],
  date: DateStamp,
): Money | undefined {
  if (date < account.openingDate) return undefined
  let balance = money(account.openingBalance, account.currency)
  for (const movement of movements) {
    if (movement.accountId !== account.id) continue
    if (movement.date < account.openingDate || movement.date > date) continue
    balance = add(balance, movement.amount)
  }
  return balance
}

/** The signed adjustment that takes `current` to `target` — what "Ajustar
 *  saldo" stores when the user types the balance their bank shows. Zero
 *  means there's nothing to adjust. */
export function adjustmentToReach(current: Money, target: Money): Money {
  return sub(target, current)
}

/** Why a movement (income, debit expense, adjustment) can't be recorded
 *  against `account`, or `undefined` if it can. Shared by every write
 *  path — the repositories and backup import validation — so the rule
 *  lives in one place. Messages are user-facing (Spanish). */
export function movementAccountProblem(
  account: Pick<Account, 'name' | 'currency' | 'openingDate'>,
  movement: { date: DateStamp; currency: string },
): string | undefined {
  if (movement.currency !== account.currency) {
    return `La cuenta "${account.name}" es en ${account.currency}, el movimiento es en ${movement.currency}`
  }
  if (movement.date < account.openingDate) {
    return `La fecha es anterior al saldo inicial de "${account.name}" (${formatFullDate(account.openingDate)})`
  }
  return undefined
}
