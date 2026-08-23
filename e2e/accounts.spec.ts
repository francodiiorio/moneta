import { expect, test } from '@playwright/test'

test('creates an account and sees its balance', async ({ page }) => {
  await page.goto('/cuentas')

  // Two "Nueva cuenta" buttons exist while the list is empty (PageHeader's
  // action + EmptyState's own CTA) — .first() picks the header one.
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Test')
  await page.getByLabel('Saldo inicial').fill('1000')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByText('Banco Test')).toBeVisible()
  await expect(page.getByText(/1[.,]000,00/)).toBeVisible()
})
