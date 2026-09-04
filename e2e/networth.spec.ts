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

test('"Nueva posición" no vuelve a ofrecer un activo que ya tiene holding', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Dup Test')
  await page.getByLabel('Símbolo').fill('SPYX')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYX/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // SPYX es el único activo y ya tiene holding — nada nuevo que crear.
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Nueva posición' })).toBeDisabled()
  await page.keyboard.press('Escape')

  // Un segundo activo sin holding reactiva la opción, pero el primero
  // (ya con posición) no debe aparecer en el selector. La lista ya no
  // está vacía, así que "Nuevo activo" ahora vive en el dropdown "Nuevo"
  // (antes era el CTA propio de EmptyState).
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('AAPL Dup Test')
  await page.getByLabel('Símbolo').fill('AAPX')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await expect(page.getByRole('option', { name: /AAPX/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /SPYX/ })).not.toBeVisible()
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
  await page.getByLabel(/Costo por unidad/).fill('600')
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

  // Same gain/loss surfaces as a chart in Resumen — see InvestmentGainLossChart.
  await page.getByRole('tab', { name: 'Resumen' }).click()
  await expect(page.getByText('Ganancia/pérdida por posición')).toBeVisible()
  await expect(page.getByText('+8%')).toBeVisible()
})

test('administrar las compras de una posición recalcula la cantidad y el costo promedio solos', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Lotes Test')
  await page.getByLabel('Símbolo').fill('SPYL')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYL/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByLabel(/Costo por unidad/).fill('100')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('5 unidades')).toBeVisible()

  // "Compras" (el lápiz) abre la administración de lotes — agregar una
  // segunda compra con costo distinto recalcula cantidad y promedio solo,
  // sin tocar la fila a mano.
  await page.getByTitle('Compras').click()
  await expect(page.getByText('Compras de SPYL')).toBeVisible()
  await page.getByRole('button', { name: 'Agregar compra' }).click()
  await page.getByLabel('Cantidad').fill('3')
  await page.getByLabel(/Costo por unidad/).fill('120')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  // Costo promedio ponderado: (5*100 + 3*120) / 8 = 107,50 — no se muestra
  // directo en ningún lado, así que se verifica indirecto vía la
  // ganancia/pérdida no realizada, que sí lo usa (costBasis = 8*107,50 =
  // 860; a precio 120, nativeValue = 960 -> +100, +11,63% -> redondea a +12%).
  await expect(page.getByText('8 unidades')).toBeVisible()
  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('120')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/\+USD\s?100[.,]00\s?\(\+12%\)/)).toBeVisible()
})

test('borrar el único lote de una posición hace que la posición desaparezca', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Delete Test')
  await page.getByLabel('Símbolo').fill('SPYD2')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYD2/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('5 unidades')).toBeVisible()

  await page.getByTitle('Compras').click()
  await expect(page.getByText('Compras de SPYD2')).toBeVisible()
  await page.getByRole('button', { name: 'Eliminar compra' }).click()
  await page.getByRole('button', { name: 'Eliminar' }).click()

  // Sin lotes, el diálogo (que sigue abierto — borrar el lote no borra
  // el activo) muestra su propio estado vacío.
  await expect(page.getByText('Todavía no hay compras cargadas.')).toBeVisible()

  // Al cerrar, la posición desapareció por completo — el activo vuelve a
  // mostrarse como "Sin posición cargada" en la lista de Inversiones.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('Sin posición cargada')).toBeVisible()
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

test('a CEDEAR asset offers the data912 auto-price toggle, and it can be switched back to manual later', async ({
  page,
}) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('Coca-Cola CEDEAR')
  await page.getByLabel('Símbolo (opcional)').fill('KO')

  await page.getByLabel('Tipo').click()
  await page.getByRole('option', { name: 'CEDEAR' }).click()
  await expect(page.getByText('Actualizar precio automáticamente')).toBeVisible()

  await page.getByLabel('Actualizar precio automáticamente (BYMA vía data912)').click()
  await expect(page.getByLabel('Símbolo en BYMA')).toBeVisible()
  await page.getByLabel('Símbolo en BYMA').fill('KO')

  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // "Configurar activo" (el engranaje) abre el mismo formulario en modo
  // edición — tipo y moneda bloqueados, el resto precargado.
  await page.getByRole('button', { name: 'Configurar activo' }).click()
  await expect(page.getByText('Editar activo')).toBeVisible()
  await expect(page.getByLabel('Tipo')).toBeDisabled()
  const autoToggle = page.getByLabel('Actualizar precio automáticamente (BYMA vía data912)')
  await expect(autoToggle).toBeChecked()
  await expect(page.getByLabel('Símbolo en BYMA')).toHaveValue('KO')

  // El respaldo manual: apagar el switch sin borrar el activo.
  await autoToggle.click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Configurar activo' }).click()
  await expect(page.getByLabel('Actualizar precio automáticamente (BYMA vía data912)')).not.toBeChecked()
})

test('cargar una compra con cuenta de origen descuenta el saldo sin que cuente como gasto', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Compra Test')
  await page.getByLabel('Moneda').click()
  await page.getByRole('option', { name: 'ARS' }).click()
  await page.getByLabel('Saldo inicial').fill('100000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Cuenta Origen Test')
  await page.getByLabel('Símbolo (opcional)').fill('SPYCO')
  await page.getByLabel('Moneda').click()
  await page.getByRole('option', { name: 'ARS' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYCO/ }).click()
  await page.getByLabel('Cantidad').fill('10')
  await page.getByLabel(/Costo por unidad/).fill('1000')
  await page.getByLabel('Cuenta de origen').click()
  await page.getByRole('option', { name: 'Banco Compra Test' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('10 unidades')).toBeVisible()

  // El saldo de la cuenta bajó exactamente el total de la compra
  // (10 * 1.000 = 10.000) — no cuenta como gasto, así que sigue siendo
  // un movimiento real, no un "ajuste" invisible.
  await page.goto('/cuentas')
  await expect(page.getByText(/90[.,]000,00/)).toBeVisible()

  // Aparece en Movimientos, pero sin la opción de editarlo directo — se
  // edita desde la compra en Ahorro e Inversiones.
  await page.goto('/movimientos')
  await expect(page.getByText(/Compra/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Más opciones' }).first().click()
  await expect(page.getByRole('menuitem', { name: 'Editar' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Y no cuenta como gasto en Reportes.
  await page.goto('/reportes')
  await expect(page.getByText('Compra de inversiones')).not.toBeVisible()
})
