import { expect, test } from '@playwright/test'

test('creates a savings holding and sees it added to the net worth total', async ({ page }) => {
  await page.goto('/patrimonio')

  await page.getByRole('tab', { name: 'Ahorros' }).click()

  // Two "Nuevo ahorro" buttons exist while the list is empty (PageHeader's
  // action + EmptyState's own CTA) — .first() picks the header one.
  await page.getByRole('button', { name: 'Nuevo ahorro' }).first().click()
  await page.getByLabel('Nombre').fill('Ahorro Prueba')
  await page.getByLabel('Importe').fill('1000')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByText('Ahorro Prueba')).toBeVisible()

  await page.getByRole('tab', { name: 'Resumen' }).click()
  await expect(page.getByText('Patrimonio total', { exact: true })).toBeVisible()
  await expect(page.getByText(/1[.,]000,00/).first()).toBeVisible()
})
