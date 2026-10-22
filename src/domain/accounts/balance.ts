import type { Account, AccountAdjustment, Expense, Income, Transfer } from '@/domain/entities'
import { add, getCurrency, money, negate, sub, type Money } from '@/domain/money'
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
  transfers: readonly Transfer[]
}

/** Flattens every record that touches an account into signed movements.
 *  Only `confirmed` expenses with an `accountId` count — a `projected`
 *  one hasn't happened yet (same rule reports/budgets follow), and one
 *  without `accountId` (credit card, or unspecified) never touched an
 *  account. A transfer is two movements: its `fromAmount` leaves one
 *  account, its `toAmount` enters the other. Investment purchases and card
 *  payments join here in later phases of Etapa 8 (see docs/ROADMAP.md). */
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
  for (const transfer of sources.transfers) {
    movements.push({
      accountId: transfer.fromAccountId,
      date: transfer.date,
      amount: negate(money(transfer.fromAmount, transfer.fromCurrency)),
    })
    movements.push({
      accountId: transfer.toAccountId,
      date: transfer.date,
      amount: money(transfer.toAmount, transfer.toCurrency),
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

type TransferAccount = Pick<Account, 'id' | 'name' | 'currency' | 'openingDate'>

/** Why `transfer` can't be recorded between `from` and `to`, or
 *  `undefined` if it can — same role as `movementAccountProblem`, shared by
 *  the repository and backup validation. Each side must fit its own
 *  account; a same-currency transfer moves exactly the same amount (only a
 *  currency change can make the two sides differ). */
export function transferProblem(
  transfer: Pick<Transfer, 'date' | 'fromAmount' | 'fromCurrency' | 'toAmount' | 'toCurrency'>,
  from: TransferAccount,
  to: TransferAccount,
): string | undefined {
  if (from.id === to.id) return 'Una transferencia tiene que ser entre dos cuentas distintas'
  if (transfer.fromAmount <= 0 || transfer.toAmount <= 0) return 'Los montos tienen que ser mayores a cero'
  const fromProblem = movementAccountProblem(from, { date: transfer.date, currency: transfer.fromCurrency })
  if (fromProblem) return fromProblem
  const toProblem = movementAccountProblem(to, { date: transfer.date, currency: transfer.toCurrency })
  if (toProblem) return toProblem
  if (transfer.fromCurrency === transfer.toCurrency && transfer.fromAmount !== transfer.toAmount) {
    return 'Entre cuentas de la misma moneda, el monto que sale y el que entra tienen que ser iguales'
  }
  return undefined
}

export interface ImpliedRate {
  /** The currency quoted as "1 base = rate quote" — whichever side makes
   *  the rate ≥ 1, so it reads like a real quote ("1 USD = 1.250 ARS")
   *  whether dollars were bought or sold. */
  base: string
  quote: string
  rate: number
}

/** The exchange rate a cross-currency transfer actually got. Display only
 *  (a float ratio of the two amounts in major units): it's never stored
 *  and never used to compute an amount — both amounts are stored exactly
 *  as they were. */
export function transferImpliedRate(
  transfer: Pick<Transfer, 'fromAmount' | 'fromCurrency' | 'toAmount' | 'toCurrency'>,
): ImpliedRate {
  const fromMajor = transfer.fromAmount / 10 ** getCurrency(transfer.fromCurrency).decimals
  const toMajor = transfer.toAmount / 10 ** getCurrency(transfer.toCurrency).decimals
  return fromMajor >= toMajor
    ? { base: transfer.toCurrency, quote: transfer.fromCurrency, rate: fromMajor / toMajor }
    : { base: transfer.fromCurrency, quote: transfer.toCurrency, rate: toMajor / fromMajor }
}
