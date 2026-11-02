import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Etapa 9, Fase 2: subir el PDF del resumen del banco carga todo — gastos,
// la compra en cuotas desde la cuota que factura y los cargos — y cuadra
// con el saldo. Volver a subirlo no duplica nada.
const PDF = fileURLToPath(new URL('./fixtures/resumen-bbva-prueba.pdf', import.meta.url))

test('importar el PDF del resumen carga todo, cuadra con el banco y no se duplica', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('visa prueba')
  await page.getByLabel('Día de cierre').fill('22')
  await page.getByLabel('Día de vencimiento').fill('4')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('link', { name: 'Importar resumen' }).click()
  await page.locator('input[type="file"]').setInputFiles(PDF)
  // The only Visa card is picked on its own.
  await expect(page.getByRole('combobox', { name: 'Tarjeta' })).toHaveText('visa prueba')
  await expect(page.getByText('Cerró el 22/10 · vence el 04/11')).toBeVisible()
  await expect(page.getByText(/Coincide con el banco/)).toBeVisible()
  await expect(page.getByText('Para importar (4)')).toBeVisible()
  await expect(page.getByText('Cuota 2/3')).toBeVisible()

  await page.getByRole('button', { name: 'Importar 4 movimientos' }).click()
  await expect(page).toHaveURL(/\/tarjetas\/.+\?resumen=2026-10/)
  await expect(page.getByText(/45\.300,00/).first()).toBeVisible()
  await expect(page.getByText('Rappi')).toBeVisible()
  await expect(page.getByText('Impuesto de sellos')).toBeVisible()

  // Again: everything is already there.
  await page.goto('/tarjetas/importar')
  await page.locator('input[type="file"]').setInputFiles(PDF)
  await expect(page.getByText('Para importar (0)')).toBeVisible()
  await expect(page.getByText('Ya están en Moneta (4)')).toBeVisible()
  await expect(page.getByText(/Coincide con el banco/)).toBeVisible()
})
