import { expect, test } from '@playwright/test'

// Etapa 9, Fase 4b: la pestaña Cuotas arranca diciendo cuándo terminás de
// pagarlas, con lo que se va cada mes hasta entonces.
test('libre de cuotas: cuándo termina y cuánto se va cada mes', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00'))
  await page.goto('/tarjetas?tab=cuotas')
  await page.getByRole('button', { name: 'Nueva compra en cuotas' }).first().click()
  await page.getByLabel('Descripción').fill('Préstamo')
  await page.getByLabel('Monto total').fill('120.000')
  await page.getByLabel('Cantidad de cuotas').fill('3')
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Vivienda' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // First cuota today (Nov 15), the last two months later.
  await expect(page.getByRole('heading', { name: 'Libre de cuotas en febrero de 2027' })).toBeVisible()
  await expect(page.getByText(/Este mes pagás/)).toContainText('40.000,00')
  const months = page.getByRole('list', { name: 'Cuotas por mes' }).getByRole('listitem')
  await expect(months).toHaveCount(3)
  await expect(months.last()).toContainText('Última de Préstamo')
})
