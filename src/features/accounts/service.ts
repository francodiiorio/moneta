import { accountsRepo } from '@/database/repositories'
import { parseAmount } from '@/domain/money'
import type { AccountFormValues } from './schema'

export { listAccountsWithBalances, setAccountArchived } from '@/database/repositories/accounts.repo'
export type { AccountWithBalance } from '@/database/repositories/accounts.repo'

export async function createAccountFromForm(values: AccountFormValues) {
  const openingBalance = parseAmount(values.openingBalance, values.currency).amount
  return accountsRepo.createAccount({
    name: values.name,
    type: values.type,
    currency: values.currency,
    openingBalance,
  })
}

export async function updateAccountFromForm(id: string, values: AccountFormValues) {
  const openingBalance = parseAmount(values.openingBalance, values.currency).amount
  return accountsRepo.updateAccount(id, {
    name: values.name,
    type: values.type,
    currency: values.currency,
    openingBalance,
  })
}
