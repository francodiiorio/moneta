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
  await expect(page.getByText('Total ahorros e inversiones', { exact: true })).toBeVisible()
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
  // exact: true — InvestmentAssetRow's delete button is labeled "Eliminar
  // activo", which otherwise substring-matches this field's "Activo" label.
  await page.getByLabel('Activo', { exact: true }).click()
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

test('a newly-created asset with no position shows up right away, instead of looking like nothing happened', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('S&P 500')
  await page.getByLabel('Símbolo').fill('SPYT')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // Regression: this used to still show the tab's empty state, as if
  // creating the asset had done nothing — see InvestmentAssetRow.
  await expect(page.getByText('Todavía no cargaste inversiones')).not.toBeVisible()
  await expect(page.getByText('SPYT')).toBeVisible()
  await expect(page.getByText('Sin posición cargada')).toBeVisible()

  // "Agregar posición" from the asset's own row preselects it.
  await page.getByRole('button', { name: 'Agregar posición' }).click()
  await expect(page.getByRole('combobox', { name: 'Activo' })).toContainText('SPYT')
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await expect(page.getByText('Sin posición cargada')).not.toBeVisible()
  await expect(page.getByText('5 unidades')).toBeVisible()
})

test('deletes an asset that has no position yet', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('Activo a borrar')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Activo a borrar')).toBeVisible()

  await page.getByRole('button', { name: 'Eliminar activo' }).click()
  await page.getByRole('button', { name: 'Eliminar' }).click()

  await expect(page.getByText('Activo a borrar')).not.toBeVisible()
  await expect(page.getByText('Todavía no cargaste inversiones')).toBeVisible()
})

test('shows unrealized gain/loss vs. the average cost once both a cost and a price are loaded', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Prueba')
  await page.getByLabel('Símbolo').fill('SPYT')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYT/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByLabel(/Costo promedio/).fill('600')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // No price yet: a costBasis exists but there's nothing to compare it
  // against, so no gain/loss should render (equivalent case covered at
  // the unit level in service.test.ts).
  await expect(page.getByText('Sin precio cargado')).toBeVisible()

  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('650')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // 5 * (650 - 600) = 250, / (5*600=3000) * 100 = 8.33% -> rounds to 8%.
  // USD renders with the "USD" code, not "$" (indistinguishable from ARS).
  await expect(page.getByText(/\+USD\s?250[.,]00\s?\(\+8%\)/)).toBeVisible()
})

test('/ajustes/tasas redirects to Ahorro e Inversiones, and a manual rate can be loaded from Cotizaciones', async ({ page }) => {
  await page.goto('/ajustes/tasas')
  await expect(page).toHaveURL('/patrimonio')

  await page.getByRole('tab', { name: 'Cotizaciones' }).click()
  await expect(page.getByText('Actualización automática', { exact: true })).toBeVisible()
  await expect(page.getByText('Cotización USD para valuar tu patrimonio')).toBeVisible()

  // Two "Nueva tasa" buttons exist while the list is empty (PageHeader's
  // action + EmptyState's own CTA) — .first() picks the header one.
  await page.getByRole('button', { name: 'Nueva tasa' }).first().click()
  // Radix Select's hidden native <select> also matches "Tasa" via the
  // dialog's own aria-labelledby ("Nueva tasa") — scope to the textbox.
  await page.getByRole('textbox', { name: 'Tasa', exact: true }).fill('1520')
  await page.getByLabel('Referencia (opcional)').click()
  await page.getByRole('option', { name: 'Oficial' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await expect(page.getByText('USD → ARS')).toBeVisible()
  await expect(page.getByText('1.520')).toBeVisible()
})

test('a crypto asset offers the automatic price toggle with a CoinGecko id field', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('Bitcoin')

  await page.getByLabel('Tipo').click()
  await page.getByRole('option', { name: 'Cripto' }).click()
  await expect(page.getByText('Actualizar precio automáticamente')).toBeVisible()

  await page.getByLabel('Actualizar precio automáticamente (CoinGecko)').click()
  await expect(page.getByLabel('ID en CoinGecko')).toBeVisible()
  await page.getByLabel('ID en CoinGecko').fill('bitcoin')

  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
