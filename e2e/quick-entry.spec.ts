import { expect, test } from '@playwright/test'

// Etapa 9, Fase 2b: un comercio que cargás seguido aparece como botón y
// completa todo menos el monto.
test.use({ viewport: { width: 390, height: 844 } })

test('carga rápida: tocar un comercio completa categoría y tarjeta, y sólo falta el monto', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('visa 2551')
  await page.getByLabel('Día de cierre').fill('22')
  await page.getByLabel('Día de vencimiento').fill('4')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Rappi')
  await page.getByLabel('Monto').fill('15.000')
  await page.getByLabel('Medio de pago').click()
  await page.getByRole('option', { name: /visa 2551/ }).click()
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  const picks = page.getByRole('group', { name: 'Cargados seguido' })
  await picks.getByRole('button', { name: 'Rappi' }).click()
  await expect(page.getByLabel('Descripción')).toHaveValue('Rappi')
  await expect(page.getByLabel('Monto')).toBeFocused()
  await expect(page.getByLabel('Categoría')).toHaveText(/Comida/)
  await expect(page.getByLabel('Medio de pago')).toHaveText(/visa 2551/)
  await page.getByLabel('Monto').fill('9.500')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/9\.500,00/)).toBeVisible()
})
