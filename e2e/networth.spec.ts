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

test('creates an investment asset, a position and a price, and sees the valued total', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  // Empty list: EmptyState's own CTA is the only "Nuevo activo" in the DOM
  // (the header's dropdown item only renders once the menu is opened).
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Prueba')
  await page.getByLabel('Símbolo').fill('SPYT')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // The asset exists but has no position yet, so the list is still empty —
  // use the header's "Nuevo" dropdown for "Nueva posición" this time.
  // exact: true — otherwise it also substring-matches EmptyState's own
  // "Nuevo activo" button, still in the DOM since the list is empty.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo').click()
  await page.getByRole('option', { name: /SPYT/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await expect(page.getByText('SPYT')).toBeVisible()
  await expect(page.getByText('Sin precio cargado')).toBeVisible()

  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('100')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByText(/500[.,]00/).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Resumen' }).click()
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'USD' }).click()
  await expect(page.getByText(/500[.,]00/).first()).toBeVisible()
})
