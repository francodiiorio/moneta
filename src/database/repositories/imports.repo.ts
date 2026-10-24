import { db } from '../db'
import { saveExpense, type ExpenseInput } from './expenses.repo'
import { saveIncome, type IncomeInput } from './incomes.repo'

/**
 * Writes a bank import (CSV) atomically: every gasto and ingreso lands or
 * none does. One `rw` transaction covering every table the nested saves
 * may need — a debit gasto reads its account, a card gasto its calendar.
 */
export async function saveImportedMovements(
  expenses: readonly ExpenseInput[],
  incomes: readonly IncomeInput[],
): Promise<void> {
  const tables = [db.expenses, db.incomes, db.categories, db.accounts, db.creditCards, db.cardStatements]
  await db.transaction('rw', tables, async () => {
    for (const input of expenses) await saveExpense(input)
    for (const input of incomes) await saveIncome(input)
  })
}
