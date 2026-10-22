import { movementAccountProblem, transferProblem } from '@/domain/accounts'
import type { LatestBackupData } from './migrations'

/** Sin partida doble no hay nada que balancear — lo que queda son las
 *  invariantes de cada registro plano: montos positivos, categoría del
 *  tipo correcto, y que todo movimiento de una cuenta (ingreso, gasto con
 *  débito, ajuste) apunte a una cuenta que exista y lo acepte (misma
 *  moneda, no antes de su saldo inicial — ver
 *  domain/accounts:movementAccountProblem). Zod ya fuerza la forma vía
 *  los schemas de entidad en el parseo normal, pero un archivo importado
 *  es entrada no confiable y ya migrada a mano (los migrators construyen
 *  objetos directo, sin pasar por Zod) — esta es la última verificación
 *  antes de escribir sobre la base real. */
export function validateLedgerIntegrity(data: LatestBackupData): void {
  const categoryKindById = new Map(data.categories.map((c) => [c.id, c.kind]))
  const accountById = new Map(data.accounts.map((a) => [a.id, a]))

  function assertAccount(label: string, accountId: string, movement: { date: string; currency: string }): void {
    const account = accountById.get(accountId)
    if (!account) throw new Error(`${label}: la cuenta ${accountId} no existe en el backup`)
    const problem = movementAccountProblem(account, movement)
    if (problem) throw new Error(`${label}: ${problem}`)
  }

  for (const expense of data.expenses) {
    const label = `Gasto inválido "${expense.description}" (${expense.id})`
    if (expense.amount <= 0) {
      throw new Error(`${label}: el monto debe ser mayor a cero`)
    }
    if (!expense.categoryId) {
      throw new Error(`${label}: falta la categoría`)
    }
    if (categoryKindById.get(expense.categoryId) === 'income') {
      throw new Error(`${label}: usa una categoría de ingreso`)
    }
    if (expense.accountId !== undefined) assertAccount(label, expense.accountId, expense)
  }

  for (const income of data.incomes) {
    const label = `Ingreso inválido "${income.description}" (${income.id})`
    if (income.amount <= 0) {
      throw new Error(`${label}: el monto debe ser mayor a cero`)
    }
    if (categoryKindById.get(income.categoryId) !== 'income') {
      throw new Error(`${label}: la categoría no existe o no es de ingreso`)
    }
    assertAccount(label, income.accountId, income)
  }

  for (const adjustment of data.accountAdjustments) {
    const label = `Ajuste de saldo inválido (${adjustment.id})`
    if (adjustment.amount === 0) {
      throw new Error(`${label}: no puede ser cero`)
    }
    assertAccount(label, adjustment.accountId, adjustment)
  }

  for (const lot of data.investmentLots) {
    const label = `Compra de inversión inválida (${lot.id})`
    const present = [lot.sourceAccountId, lot.sourceAmount, lot.sourceCurrency].filter((v) => v !== undefined).length
    // Zod's refine already enforces this for a parsed file, but migrated
    // data is built directly — never let a half-filled source slip by as
    // "no source" (it would silently drop a debit).
    if (present !== 0 && present !== 3) throw new Error(`${label}: cuenta de origen, monto y moneda van juntos`)
    if (lot.sourceAccountId === undefined || lot.sourceAmount === undefined || lot.sourceCurrency === undefined) continue
    if (lot.sourceAmount <= 0) throw new Error(`${label}: el monto debitado tiene que ser mayor a cero`)
    assertAccount(label, lot.sourceAccountId, {
      date: lot.date,
      currency: lot.sourceCurrency,
    })
  }

  for (const transfer of data.transfers) {
    const label = `Transferencia inválida "${transfer.description}" (${transfer.id})`
    const from = accountById.get(transfer.fromAccountId)
    const to = accountById.get(transfer.toAccountId)
    if (!from || !to) throw new Error(`${label}: una de sus cuentas no existe en el backup`)
    const problem = transferProblem(transfer, from, to)
    if (problem) throw new Error(`${label}: ${problem}`)
  }
}
