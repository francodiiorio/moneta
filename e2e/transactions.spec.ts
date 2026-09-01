import { expect, test } from '@playwright/test'

test('creates a same-currency transfer between two accounts', async ({ page }) => {
  // Regression: transferFormSchema used to reject every same-currency
  // transfer silently (the hidden "Recibe" field's empty-string default
  // failed an `.optional()` check that only lets `undefined` through) —
  // clicking Guardar did nothing at all, no error, no toast.
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Origen')
  await page.getByLabel('Saldo inicial').fill('10000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Tarjeta Destino')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByRole('tab', { name: 'Transferencia' }).click()
  await page.getByLabel('Descripción').fill('Pago tarjeta')
  await page.getByRole('combobox', { name: 'Desde' }).click()
  await page.getByRole('option', { name: 'Banco Origen' }).click()
  await page.getByRole('combobox', { name: 'Hacia' }).click()
  await page.getByRole('option', { name: 'Tarjeta Destino' }).click()
  await page.getByLabel('Monto').fill('3.500,25')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Pago tarjeta')).toBeVisible()

  await page.goto('/cuentas')
  await expect(page.getByText(/6[.,]499,75/)).toBeVisible() // 10.000 - 3.500,25
  await expect(page.getByText(/3[.,]500,25/)).toBeVisible() // Tarjeta Destino's new balance
})
