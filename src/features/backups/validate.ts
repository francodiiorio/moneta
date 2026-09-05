import type { LatestBackupData } from './migrations'

/** Sin partida doble no hay nada que balancear — la única invariante que
 *  queda es la más básica: todo gasto tiene un monto positivo y una
 *  categoría. Zod ya fuerza esto vía `expenseSchema` en el parseo normal,
 *  pero un archivo importado es entrada no confiable y ya migrada a mano
 *  (los migrators construyen objetos directo, sin pasar por Zod) — esta
 *  es la última verificación antes de escribir sobre la base real. */
export function validateLedgerIntegrity(data: LatestBackupData): void {
  for (const expense of data.expenses) {
    if (expense.amount <= 0) {
      throw new Error(`Gasto inválido "${expense.description}" (${expense.id}): el monto debe ser mayor a cero`)
    }
    if (!expense.categoryId) {
      throw new Error(`Gasto inválido "${expense.description}" (${expense.id}): falta la categoría`)
    }
  }
}
