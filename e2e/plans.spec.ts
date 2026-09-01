import { expect, test, type Page } from '@playwright/test'

async function createRecurringPlan(page: Page) {
  await page.getByRole('button', { name: 'Nuevo recurrente' }).first().click()
  await page.getByLabel('Descripción').fill('Alquiler')
  await page.getByRole('combobox', { name: 'Cuenta' }).click()
  await page.getByRole('option', { name: 'Banco Prueba' }).click()
  await page.getByLabel('Monto').fill('100000')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option').first().click()
  // Start date a month ago so materializeDue() (runs on app boot) creates
  // at least one confirmed transaction from this plan.
  await page.getByLabel('Empieza', { exact: true }).click()
  await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^1$/ }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo recurrente' })).not.toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Prueba')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nueva cuenta' })).not.toBeVisible()
})

test('deleting a recurring plan keeps its generated movements by default', async ({ page }) => {
  await page.goto('/planes')
  await createRecurringPlan(page)

  // Reload to run materializeDue() (App.tsx, on boot) and generate the
  // past occurrence — its own completion toast is a concrete signal to
  // wait on, more reliable under load than a fixed sleep, and (like the
  // "Eliminar" case below) avoids navigating away via a real page.goto()
  // reload before the in-flight write actually finishes.
  await page.goto('/planes')
  await expect(page.getByText(/Se pusieron al día/)).toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText('Alquiler').first()).toBeVisible()

  await page.goto('/planes')
  await page.locator('div.rounded-xl', { hasText: 'Alquiler' }).locator('button').last().click()
  // Regression: this used to be the only option — deleting a plan left no
  // way to also remove the movements it already generated.
  await expect(page.getByLabel(/Borrar también/)).not.toBeChecked()
  await page.getByRole('button', { name: 'Eliminar' }).click()
  // Wait for the actual deletion to finish (not just the click event) before
  // navigating away — page.goto() is a real browser navigation, unlike an
  // in-app link click, and would otherwise sometimes race the in-flight
  // async delete under load.
  await expect(page.getByRole('alertdialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText('Alquiler').first()).toBeVisible()
})

test('checking "Borrar también" removes the plan\'s generated movements too', async ({ page }) => {
  await page.goto('/planes')
  await createRecurringPlan(page)

  await page.goto('/planes')
  await expect(page.getByText(/Se pusieron al día/)).toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText('Alquiler').first()).toBeVisible()

  await page.goto('/planes')
  await page.locator('div.rounded-xl', { hasText: 'Alquiler' }).locator('button').last().click()
  await page.getByLabel(/Borrar también/).check()
  await page.getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByRole('alertdialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText('Alquiler')).toHaveCount(0)
})
