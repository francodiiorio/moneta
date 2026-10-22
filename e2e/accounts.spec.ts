import { expect, test } from '@playwright/test'

// Etapa 8, Fase 1: an account's balance is computed from its opening
// balance, ingresos, debit gastos and adjustments — and it adds up into
// the Patrimonio total.
test('una cuenta suma ingresos, resta gastos con débito, se ajusta, y entra al patrimonio', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Galicia pesos')
  await page.getByLabel('Saldo inicial').fill('1000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/1[.,]000,00/)).toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByRole('tab', { name: 'Ingreso' }).click()
  await page.getByLabel('Descripción').fill('Sueldo')
  await page.getByLabel('Monto').fill('500')
  await page.getByLabel('Cuenta', { exact: true }).click()
  await page.getByRole('option', { name: /Galicia pesos/ }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Sueldo' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Supermercado')
  await page.getByLabel('Monto').fill('200')
  await page.getByLabel('Cuenta (opcional)').click()
  await page.getByRole('option', { name: /Galicia pesos/ }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await expect(page.getByText('Sueldo · Galicia pesos')).toBeVisible()
  await expect(page.getByText('Comida · Galicia pesos')).toBeVisible()

  // 1000 + 500 − 200
  await page.goto('/cuentas')
  await expect(page.getByText(/1[.,]300,00/)).toBeVisible()

  await page.getByRole('button', { name: 'Opciones de Galicia pesos' }).click()
  await page.getByRole('menuitem', { name: 'Ajustar saldo' }).click()
  await page.getByLabel(/Saldo real/).fill('1250')
  await page.getByRole('button', { name: 'Ajustar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/1[.,]250,00/)).toBeVisible()

  await page.goto('/patrimonio')
  await expect(page.getByText('Total patrimonio', { exact: true })).toBeVisible()
  await expect(page.getByText(/1[.,]250,00/).first()).toBeVisible()
})

test('un ingreso sin cuenta no se puede guardar', async ({ page }) => {
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByRole('tab', { name: 'Ingreso' }).click()
  await page.getByLabel('Descripción').fill('Sueldo')
  await page.getByLabel('Monto').fill('500')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Elegí la cuenta donde entró')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Nuevo ingreso' })).toBeVisible()
})

// Regression (finance review): the Dashboard's month-over-month badge used
// percentChange on the net worth total, which throws on a negative amount —
// an overdrawn account crashed the whole Dashboard.
test('un patrimonio negativo (cuenta en descubierto) no rompe el Dashboard', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Descubierto')
  await page.getByLabel('Saldo inicial').fill('-5000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('main').getByText('Patrimonio', { exact: true })).toBeVisible()
  await expect(page.getByText(/-\$\s?5[.,]000,00/).first()).toBeVisible()
})

// Regression: "15.000" (quince mil, es-AR) used to be saved as $15,00 —
// parseAmount took the last separator as the decimal one, always.
test('un monto con punto de miles se guarda completo', async ({ page }) => {
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Alquiler')
  await page.getByLabel('Monto').fill('15.000')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Vivienda' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/15[.,]000,00/)).toBeVisible()
})
