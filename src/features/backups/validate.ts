import { movementAccountProblem, transferProblem } from '@/domain/accounts'
import {
  openingBalancesProblem,
  statementOverrideProblem,
  statementPaymentProblem,
  statementPeriodFor,
  type CardCalendar,
} from '@/domain/cards'
import { isValidMonthStamp } from '@/lib/dates'
import { firstPendingOccurrence } from '@/domain/recurrence'
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
  const calendarByCard = new Map<string, CardCalendar>(
    data.creditCards.map((card) => [card.id, { card, overrides: data.cardStatements.filter((s) => s.cardId === card.id) }]),
  )

  for (const card of data.creditCards) {
    const problem = openingBalancesProblem(card.openingBalances ?? [], card.openingBase)
    if (problem) throw new Error(`Tarjeta inválida "${card.name}" (${card.id}): ${problem}`)
  }

  const statementKeys = new Set<string>()
  for (const statement of data.cardStatements) {
    const label = `Resumen inválido (${statement.id})`
    const calendar = calendarByCard.get(statement.cardId)
    if (!calendar) throw new Error(`${label}: la tarjeta ${statement.cardId} no existe en el backup`)
    // Message built before the type-guard check (which narrows the value to
    // `never` in its failing branch).
    const invalidPeriod = `${label}: período ${statement.period} inválido`
    if (!isValidMonthStamp(statement.period)) throw new Error(invalidPeriod)
    const key = `${statement.cardId}:${statement.period}`
    if (statementKeys.has(key)) throw new Error(`Resumen duplicado para el período ${statement.period}`)
    statementKeys.add(key)
    // Same rules the app enforces when correcting dates — an out-of-order
    // close would silently re-place every purchase around it.
    const problem = statementOverrideProblem(calendar, statement.period, statement.closeDate, statement.dueDate)
    if (problem) throw new Error(`${label}: ${problem}`)
  }

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
    if (expense.accountId !== undefined && expense.cardId !== undefined) {
      throw new Error(`${label}: no puede ser con débito y con tarjeta a la vez`)
    }
    if ((expense.cardId === undefined) !== (expense.statementPeriod === undefined)) {
      throw new Error(`${label}: tarjeta y resumen van juntos`)
    }
    if (expense.cardId !== undefined && expense.statementPeriod !== undefined) {
      const calendar = calendarByCard.get(expense.cardId)
      if (!calendar) throw new Error(`${label}: la tarjeta ${expense.cardId} no existe en el backup`)
      const invalidPeriod = `${label}: resumen ${expense.statementPeriod} inválido`
      if (!isValidMonthStamp(expense.statementPeriod)) throw new Error(invalidPeriod)
      if (expense.statementPeriod < statementPeriodFor(calendar, expense.date)) {
        throw new Error(`${label}: su resumen cerró antes de la fecha del gasto`)
      }
    }
  }

  // A plan's payment method must point at something in the file — every
  // gasto it generates would otherwise fail (or be invalid) later.
  for (const plan of data.installmentPlans) {
    if (plan.startIndex !== undefined && plan.startIndex >= plan.count) {
      throw new Error(`Compra en cuotas "${plan.description}" (${plan.id}): empieza en una cuota que no existe`)
    }
    const before = plan.startIndex ?? 0
    if (before > 0 && data.expenses.some((e) => e.sourcePlanId === plan.id && (e.occurrenceIndex ?? before) < before)) {
      throw new Error(`Compra en cuotas "${plan.description}" (${plan.id}): tiene cuotas anteriores a la que empieza`)
    }
    if (plan.cardId === undefined) continue
    if (!calendarByCard.has(plan.cardId)) {
      throw new Error(`Compra en cuotas "${plan.description}" (${plan.id}): la tarjeta ${plan.cardId} no existe en el backup`)
    }
    if (plan.firstDueDate !== plan.purchaseDate) {
      throw new Error(`Compra en cuotas "${plan.description}" (${plan.id}): con tarjeta, la primera cuota es la fecha de compra`)
    }
  }
  for (const plan of data.recurringPlans) {
    const { accountId, cardId, description } = plan.template
    if (cardId !== undefined && !calendarByCard.has(cardId)) {
      throw new Error(`Recurrente "${description}" (${plan.id}): la tarjeta ${cardId} no existe en el backup`)
    }
    if (accountId !== undefined) {
      const account = accountById.get(accountId)
      if (!account) throw new Error(`Recurrente "${description}" (${plan.id}): la cuenta ${accountId} no existe en el backup`)
      // Same check as saving the plan: the account must accept the next
      // gasto it will generate, or the plan fails on every app open.
      const next = firstPendingOccurrence(plan.rule, plan.lastMaterializedDate)
      const problem = movementAccountProblem(account, { date: next ?? account.openingDate, currency: plan.template.currency })
      if (problem) throw new Error(`Recurrente "${description}" (${plan.id}): ${problem}`)
    }
  }

  const paymentKeys = new Set<string>()
  for (const payment of data.statementPayments) {
    const label = `Pago de resumen inválido (${payment.id})`
    if (!calendarByCard.has(payment.cardId)) throw new Error(`${label}: la tarjeta ${payment.cardId} no existe en el backup`)
    const invalidPeriod = `${label}: período ${payment.period} inválido`
    if (!isValidMonthStamp(payment.period)) throw new Error(invalidPeriod)
    const key = `${payment.cardId}:${payment.period}:${payment.currency}`
    if (paymentKeys.has(key)) throw new Error(`${label}: el resumen ya tiene un pago en ${payment.currency}`)
    paymentKeys.add(key)
    const account = accountById.get(payment.accountId)
    if (!account) throw new Error(`${label}: la cuenta ${payment.accountId} no existe en el backup`)
    const problem = statementPaymentProblem(payment, account)
    if (problem) throw new Error(`${label}: ${problem}`)
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
