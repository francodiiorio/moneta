import { expect, test } from '@playwright/test'

// Movimientos: cuánto llevás gastado en el mes, y ocultar las cuotas (de la
// lista y del total). Los gastos fijos no son cuotas.
test('el total del mes sigue a la lista, y ocultar cuotas las saca de los dos', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T12:00:00'))

  await page.goto('/tarjetas?tab=cuotas')
  await page.getByRole('button', { name: 'Nueva compra en cuotas' }).first().click()
  await page.getByLabel('Descripción').fill('Sillón')
  await page.getByLabel('Monto total').fill('90.000')
  await page.getByLabel('Cantidad de cuotas').fill('3')
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Transporte' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Coto')
  await page.getByLabel('Monto').fill('1.000')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  const card = page.getByText('Gastado en noviembre').locator('..')
  await expect(page.getByText(/^Sillón \(cuota 1\/3\)$/)).toBeVisible()
  // The cuota due today (30.000) plus Coto.
  await expect(card.getByText(/^\$\s?31\.000,00$/)).toBeVisible()

  await page.getByLabel('Ocultar cuotas').click()
  await expect(page.getByText(/^Sillón/)).toHaveCount(0)
  await expect(page.getByText('Gastado en noviembre · sin cuotas')).toBeVisible()
  await expect(card.getByText(/^\$\s?1\.000,00$/)).toBeVisible()
  await expect(card).not.toContainText(/por pagar/)
})
