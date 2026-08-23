import Dexie from 'dexie'
import { db } from '../db'
import type { Account } from '@/domain/entities'
import { generateId } from '@/lib/ids'
import { calculateAccountBalance } from '@/domain/ledger'
import { minor, type Minor } from '@/domain/money'
import type { DateStamp } from '@/lib/dates'

export interface AccountWithBalance extends Account {
  balance: Minor
}

export interface CreateAccountInput {
  name: string
  type: Account['type']
  currency: Account['currency']
  openingBalance: Minor
  color?: string
  icon?: string
}

export type UpdateAccountInput = Partial<
  Pick<Account, 'name' | 'type' | 'currency' | 'openingBalance' | 'color' | 'icon' | 'order'>
>

async function confirmedTransactionIds(): Promise<Set<string>> {
  const ids = await db.transactions.where('status').equals('confirmed').primaryKeys()
  return new Set(ids)
}

async function balanceFor(account: Account, confirmedIds: Set<string>, asOfDate?: DateStamp): Promise<Minor> {
  const postings = await db.postings
    .where('[accountId+date]')
    .between([account.id, Dexie.minKey], [account.id, asOfDate ?? Dexie.maxKey], true, true)
    .toArray()
  const confirmedAmounts = postings
    .filter((p) => confirmedIds.has(p.transactionId))
    .map((p) => minor(p.amount))
  return calculateAccountBalance(minor(account.openingBalance), confirmedAmounts)
}

/** @param asOfDate restricts the balance to postings on or before this date
 *  (inclusive) — used to reconstruct historical net worth. Omit for the
 *  current balance. */
export async function listAccountsWithBalances(asOfDate?: DateStamp): Promise<AccountWithBalance[]> {
  const accounts = await db.accounts.orderBy('order').toArray()
  const confirmedIds = await confirmedTransactionIds()
  return Promise.all(
    accounts.map(async (account) => ({
      ...account,
      balance: await balanceFor(account, confirmedIds, asOfDate),
    })),
  )
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const now = new Date().toISOString()
  const maxOrder = await db.accounts.orderBy('order').last()
  const account: Account = {
    id: generateId(),
    name: input.name,
    type: input.type,
    currency: input.currency,
    openingBalance: input.openingBalance,
    isArchived: false,
    order: (maxOrder?.order ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
    ...(input.color !== undefined && { color: input.color }),
    ...(input.icon !== undefined && { icon: input.icon }),
  }
  await db.accounts.add(account)
  return account
}

export async function updateAccount(id: string, patch: UpdateAccountInput): Promise<void> {
  await db.accounts.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function setAccountArchived(id: string, isArchived: boolean): Promise<void> {
  await db.accounts.update(id, { isArchived, updatedAt: new Date().toISOString() })
}
