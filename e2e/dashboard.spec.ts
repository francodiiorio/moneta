import { expect, test } from '@playwright/test'

// Regression: the Dashboard's "Patrimonio total" card used to only sum
// Accounts (features/reports:getCurrentNetWorth predates the Patrimonio
// module and was never updated) — it silently ignored Ahorros/Inversiones,
// showing a different total than /patrimonio for the same label.
test('Dashboard "Patrimonio total" includes savings, matching /patrimonio', async ({ page }) => {
  // Create an account with a balance so the dashboard isn't in its empty state.
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Prueba')
  await page.getByLabel('Saldo inicial').fill('1000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Banco Prueba')).toBeVisible()

  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Ahorros' }).click()
  await page.getByRole('button', { name: 'Nuevo ahorro' }).first().click()
  await page.getByLabel('Nombre').fill('Ahorro Dashboard Test')
  await page.getByLabel('Importe').fill('500')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('tab', { name: 'Resumen' }).click()
  await expect(page.getByText(/1[.,]500,00/).first()).toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Patrimonio total', { exact: true })).toBeVisible()
  await expect(page.getByText(/1[.,]500,00/).first()).toBeVisible()
})

test('Dashboard shows expense-by-category chart and a recent expenses list', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Prueba')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Supermercado')
  await page.getByLabel('Monto').fill('1500')
  await page.getByRole('combobox', { name: 'Cuenta' }).click()
  await page.getByRole('option', { name: 'Banco Prueba' }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Gasto por categoría este mes', { exact: true })).toBeVisible()
  await expect(page.getByText('Últimos gastos del mes', { exact: true })).toBeVisible()
  await expect(page.getByText('Comida · Banco Prueba')).toBeVisible()
  await expect(page.getByText('Supermercado')).toBeVisible()
})
