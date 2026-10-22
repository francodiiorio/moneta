import { expect, test, type Page } from '@playwright/test'

// The Dashboard hides amounts with transitions, never by unmounting: the
// "••••••" mask and the real amount crossfade on opacity, and "Progreso de
// tus inversiones" collapses to zero height (grid-rows 0fr). Playwright
// counts both opacity:0 and a clipped-to-zero child as "visible", so these
// helpers check what the user actually sees instead.
function amountMask(page: Page) {
  return page.getByText('••••••')
}

async function investmentsCardHeight(page: Page): Promise<number> {
  // The clipping wrapper, not the card: the card keeps its own height, it's
  // the overflow-hidden grid row around it that collapses to zero.
  const wrapper = page
    .getByText('Progreso de tus inversiones')
    .locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
  return (await wrapper.boundingBox())?.height ?? 0
}

// Regression: the Dashboard's "Patrimonio" card must match /patrimonio's
// own total (both come from the same getNetWorthSummary).
test('Dashboard "Patrimonio" matches /patrimonio', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Ahorros' }).click()
  await page.getByRole('button', { name: 'Nuevo ahorro' }).first().click()
  await page.getByLabel('Nombre').fill('Ahorro Dashboard Test')
  await page.getByLabel('Importe').fill('500')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('tab', { name: 'Resumen' }).click()
  await expect(page.getByText('Total patrimonio', { exact: true })).toBeVisible()
  await expect(page.getByText(/500,00/).first()).toBeVisible()

  await page.goto('/')
  // Scoped to <main>: the nav also has a "Patrimonio" link.
  await expect(page.getByRole('main').getByText('Patrimonio', { exact: true })).toBeVisible()
  await expect(page.getByText(/500,00/).first()).toBeVisible()

  // Regression: these cards used to always render, showing an inline
  // "sin datos" message — they should be absent entirely when there's
  // nothing to show, same as the "Presupuestos a revisar" card.
  await expect(page.getByText('Gasto por categoría este mes')).not.toBeVisible()
  await expect(page.getByText('Últimos gastos del mes')).not.toBeVisible()
})

test('Dashboard shows the expense-by-category chart and the expense trend', async ({ page }) => {
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Supermercado')
  await page.getByLabel('Monto').fill('1500')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Gasto por categoría este mes', { exact: true })).toBeVisible()
  await expect(page.getByText('Evolución de gastos', { exact: true })).toBeVisible()
  // .getByText('Comida') would also match Recharts' aria-hidden text-
  // measurement span — scope to the donut's legend row instead, which
  // carries the category, its amount and its share.
  const legendRow = page.getByRole('listitem').filter({ hasText: 'Comida' })
  await expect(legendRow).toBeVisible()
  await expect(legendRow).toContainText(/1[.,]500,00/)
  await expect(legendRow).toContainText('100%')
})

test('Dashboard shows the expense variation vs. the previous month', async ({ page }) => {
  // 1000 last month, 1500 this month — a 50% increase in gastos.
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Gasto mes pasado')
  // DateField is a Popover+Calendar, not a native date input — its
  // trigger button still inherits the accessible name "Fecha" from the
  // associated <FormLabel> (a <button> is labelable, same as an
  // <input>). exact: true — otherwise it also substring-matches the
  // field's own "Limpiar fecha" clear button.
  await page.getByLabel('Fecha', { exact: true }).click()
  await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  // Exact text match, not accessible name (day buttons' aria-label is a
  // full formatted sentence, e.g. "sábado, 1 de julio de 2026").
  // :not(.rdp-outside) — showOutsideDays renders the tail of the
  // adjacent month too, so "1" can appear twice; the outside one carries
  // that class on its .rdp-day parent cell.
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^1$/ }).click()
  await page.getByLabel('Monto').fill('1000')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Gasto este mes')
  await page.getByLabel('Monto').fill('1500')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  // VariationBadge renders the percent as a pill and "vs. mes anterior"
  // as a caption below it — scoped to the "Gastos del mes" card so the
  // Patrimonio card's own badge can't satisfy it.
  const expenseCard = page.locator('[data-slot="card"]').filter({ hasText: 'Gastos del mes' })
  await expect(expenseCard.getByText('50%', { exact: true })).toBeVisible()
  await expect(expenseCard.getByText('vs. mes anterior', { exact: true })).toBeVisible()
})

test('Dashboard shows a "Progreso de tus inversiones" card once a position has a price', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()

  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Dashboard Test')
  await page.getByLabel('Símbolo').fill('SPYD')
  // ARS (the app's default base currency) — sidesteps needing an exchange
  // rate loaded just to see the position valued at all.
  await page.getByLabel('Moneda').click()
  await page.getByRole('option', { name: 'ARS' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYD/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('100')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Progreso de tus inversiones')).toBeVisible()
})

// Regression: a peso-denominated position (a CEDEAR routinely prices in
// the tens of thousands of ARS) with an ordinary-sized quantity used to
// crash the entire app with "Position value overflows safe integer
// range" — domain/decimal:valuePosition multiplied quantity × price as a
// plain float *before* dividing back down, an intermediate product that
// overflows Number.MAX_SAFE_INTEGER long before the real, final position
// value (a few million pesos) ever would. Covered precisely at the
// domain level (quantity.test.ts, lots.test.ts) — this confirms the fix
// end-to-end, through the exact page (Dashboard, via
// getSavingsAndInvestmentsHistory) whose crash report first surfaced it.
test('a large peso-denominated CEDEAR position does not crash the Dashboard', async ({ page }) => {
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Overflow Test')
  await page.getByLabel('Símbolo').fill('SPYOF')
  await page.getByLabel('Tipo').click()
  await page.getByRole('option', { name: 'CEDEAR' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYOF/ }).click()
  await page.getByLabel('Cantidad').fill('380')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('20370')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // If valuePosition's overflow guard still had the pre-fix false
  // positive, this whole route would render React Router's default error
  // boundary instead of the app — this assertion alone would fail (the
  // card, and the rest of the page, simply wouldn't be there).
  await page.goto('/')
  await expect(page.getByText('Progreso de tus inversiones')).toBeVisible()
})

test('el ícono de ojo oculta el monto de "Patrimonio" y lo recuerda entre recargas', async ({ page }) => {
  // También carga una inversión: "Progreso de tus inversiones" muestra
  // montos reales en su tooltip, así que ocultar el monto de arriba
  // tiene que ocultar esta card entera — si no, el toggle no sirve de nada.
  await page.goto('/patrimonio')
  await page.getByRole('tab', { name: 'Inversiones' }).click()
  await page.getByRole('button', { name: 'Nuevo activo' }).click()
  await page.getByLabel('Nombre').fill('SPY Eye Test')
  await page.getByLabel('Símbolo').fill('SPYE')
  await page.getByLabel('Moneda').click()
  await page.getByRole('option', { name: 'ARS' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Nueva posición' }).click()
  await page.getByLabel('Activo', { exact: true }).click()
  await page.getByRole('option', { name: /SPYE/ }).click()
  await page.getByLabel('Cantidad').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByTitle('Cargar precio').click()
  await page.getByLabel(/Precio/).fill('100')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await expect(page.getByText('Progreso de tus inversiones')).toBeVisible()
  await expect(amountMask(page)).toHaveCSS('opacity', '0')
  await expect.poll(() => investmentsCardHeight(page)).toBeGreaterThan(0)

  await page.getByTitle('Ocultar monto').click()
  await expect(amountMask(page)).toHaveCSS('opacity', '1')
  await expect.poll(() => investmentsCardHeight(page)).toBe(0)

  // Guardado en Settings, no en un store efímero — sigue oculto tras
  // recargar. Ver docs/DATA_MODEL.md "hideSavingsAndInvestmentsAmount".
  await page.reload()
  await expect(amountMask(page)).toHaveCSS('opacity', '1')
  await expect.poll(() => investmentsCardHeight(page)).toBe(0)

  await page.getByTitle('Mostrar monto').click()
  await expect(amountMask(page)).toHaveCSS('opacity', '0')
  await expect.poll(() => investmentsCardHeight(page)).toBeGreaterThan(0)
})
