import { accountAdjustmentsRepo, accountsRepo } from '@/database/repositories'
import { accountBalanceAt, toAccountMovements } from '@/domain/accounts'
import type { Account } from '@/domain/entities'
import { parseAmount, type Money } from '@/domain/money'
import { todayStamp, type DateStamp } from '@/lib/dates'
import type { AccountFormValues, AdjustBalanceFormValues } from './schema'

export { setAccountArchived, deleteAccount } from '@/database/repositories/accounts.repo'

export interface AccountWithBalance extends Account {
  /** Balance at the end of today. `undefined` only while today is still
   *  before `openingDate` — the form doesn't allow that, but an imported
   *  backup could carry one. */
  balance: Money | undefined
  /** Its currency can't change once true — every movement is in it (see
   *  accounts.repo.ts:updateAccount); the form locks the field. */
  hasMovements: boolean
}

export async function listAccountsWithBalances(): Promise<AccountWithBalance[]> {
  const [accounts, records] = await Promise.all([
    accountsRepo.listAccounts(),
    accountsRepo.listAccountMovementRecords(),
  ])
  const movements = toAccountMovements(records)
  const today = todayStamp()
  const withMovements = new Set(movements.map((m) => m.accountId))
  return accounts.map((account) => ({
    ...account,
    balance: accountBalanceAt(account, movements, today),
    hasMovements: withMovements.has(account.id),
  }))
}

/**
 * Every account's balance at each of `dates`, in its own currency —
 * what the net worth valuation (Patrimonio, Dashboard, Reportes) feeds
 * into its Cuentas bucket. An account not yet open at a date is left out
 * of that date's list, not counted as zero. Archived accounts still
 * count: archiving hides an account from pickers, it doesn't make its
 * money disappear. One read for all dates, so a 12-month history doesn't
 * re-read the tables 12 times.
 *
 * `openedOnOrBefore` keeps only accounts already open by then — for a
 * like-for-like comparison between two dates (see
 * features/networth/service.ts:getNetWorthMonthChange).
 */
export async function getAccountBalancesAt(
  dates: readonly DateStamp[],
  options: { openedOnOrBefore?: DateStamp } = {},
): Promise<Map<DateStamp, Money[]>> {
  const [allAccounts, records] = await Promise.all([
    accountsRepo.listAccounts(),
    accountsRepo.listAccountMovementRecords(),
  ])
  const { openedOnOrBefore } = options
  const accounts =
    openedOnOrBefore === undefined ? allAccounts : allAccounts.filter((a) => a.openingDate <= openedOnOrBefore)
  const movements = toAccountMovements(records)
  const result = new Map<DateStamp, Money[]>()
  for (const date of dates) {
    const balances: Money[] = []
    for (const account of accounts) {
      const balance = accountBalanceAt(account, movements, date)
      if (balance !== undefined) balances.push(balance)
    }
    result.set(date, balances)
  }
  return result
}

export async function createAccountFromForm(values: AccountFormValues): Promise<Account> {
  return accountsRepo.createAccount({
    name: values.name,
    type: values.type,
    currency: values.currency,
    openingBalance: parseAmount(values.openingBalance, values.currency).amount,
    openingDate: values.openingDate,
    ...(values.notes && { notes: values.notes }),
  })
}

export async function updateAccountFromForm(id: string, values: AccountFormValues): Promise<void> {
  await accountsRepo.updateAccount(id, {
    name: values.name,
    type: values.type,
    currency: values.currency,
    openingBalance: parseAmount(values.openingBalance, values.currency).amount,
    openingDate: values.openingDate,
    notes: values.notes || undefined,
  })
}

export type AdjustBalanceResult = { adjusted: false } | { adjusted: true; difference: Money }

/**
 * "Ajustar saldo": the user types the balance their bank shows for
 * `values.date`; this stores the difference against what Moneta computes
 * for that same date as an AccountAdjustment — never overwrites anything.
 * No-op (nothing written) when both already match. The difference is
 * computed inside the write transaction, see
 * accountAdjustments.repo.ts:createAdjustmentToReach.
 */
export async function adjustBalanceFromForm(
  account: Account,
  values: AdjustBalanceFormValues,
): Promise<AdjustBalanceResult> {
  const difference = await accountAdjustmentsRepo.createAdjustmentToReach({
    accountId: account.id,
    date: values.date,
    target: parseAmount(values.realBalance, account.currency).amount,
    ...(values.description && { description: values.description }),
  })
  return difference ? { adjusted: true, difference } : { adjusted: false }
}
