import { expect, test } from '@playwright/test'

// Las cuotas que todavía no llegaron no cuentan como gastado, pero el
// presupuesto del mes muestra cuánto ya está comprometido en ellas.
test('un presupuesto muestra lo comprometido en cuotas del mes, sin contarlo como gastado', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('visa 2551')
  await page.getByLabel('Día de cierre').fill('28')
  await page.getByLabel('Día de vencimiento').fill('6')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Bought today in 6 cuotas: next month's is still projected.
  await page.goto('/planes')
  await page.getByRole('tab', { name: 'Cuotas' }).click()
  await page.getByRole('button', { name: 'Nueva compra en cuotas' }).first().click()
  await page.getByLabel('Descripción').fill('cubiertas')
  await page.getByLabel('Monto total').fill('600.000')
  await page.getByLabel('Cantidad de cuotas').fill('6')
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Transporte' }).click()
  await page.getByLabel('Tarjeta (opcional)').click()
  await page.getByRole('option', { name: 'visa 2551' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/presupuestos')
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).first().click()
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Transporte' }).click()
  await page.getByLabel('Monto').fill('370.000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await expect(page.getByText(/0,00 de \$\s?370\.000,00/)).toBeVisible()
  await expect(page.getByText(/100\.000,00 comprometido en cuotas/)).toBeVisible()
  await expect(page.getByText(/quedan \$\s?270\.000,00 libres/)).toBeVisible()
  await expect(page.getByText('0%', { exact: true })).toBeVisible()
})

// Editar el monto desde un mes crea una versión nueva: los meses
// anteriores conservan el que tenían.
test('editar un presupuesto cambia el monto desde el mes elegido, sin tocar los anteriores', async ({ page }) => {
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).first().click()
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByLabel('Monto').fill('450.000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // From next month on (the month being browsed).
  await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await page.getByRole('button', { name: 'Editar presupuesto de Comida' }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar presupuesto de Comida' })
  await expect(dialog.getByLabel('Monto mensual')).toHaveValue(/450\.000/)
  await dialog.getByLabel('Monto mensual').fill('500.000')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText(/de \$\s?500\.000,00/)).toBeVisible()

  await page.getByRole('button', { name: 'Mes anterior' }).click()
  await expect(page.getByText(/de \$\s?450\.000,00/)).toBeVisible()

  // Same month again: a correction of that version, not a duplicate.
  await page.getByRole('button', { name: 'Editar presupuesto de Comida' }).click()
  await dialog.getByLabel('Monto mensual').fill('420.000')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText(/de \$\s?420\.000,00/)).toBeVisible()
  await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await expect(page.getByText(/de \$\s?500\.000,00/)).toBeVisible()
})
