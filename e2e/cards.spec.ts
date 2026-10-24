import { expect, test } from '@playwright/test'

// Etapa 8, Fase 4: una compra con tarjeta entra al resumen que corresponde
// según los días de cierre, y se ve en Tarjetas y en el Dashboard.
test('un gasto con tarjeta entra al resumen en curso y se ve en Tarjetas y el Dashboard', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('Visa Galicia')
  await page.getByLabel('Día de cierre').fill('25')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Cierra el 25 · vence el 5')).toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Zapatillas')
  await page.getByLabel('Monto').fill('85.000')
  await page.getByLabel('Medio de pago').click()
  await page.getByRole('option', { name: 'Visa Galicia' }).click()
  // The statement field appears, defaulting to the one the date falls into.
  await expect(page.getByLabel('Resumen')).toContainText('Según la fecha')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Ropa' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/Ropa · Visa Galicia · resumen de/)).toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('link', { name: 'Ver resúmenes' }).click()
  await expect(page.getByText('En curso')).toBeVisible()
  await expect(page.getByText('Zapatillas')).toBeVisible()
  await expect(page.getByText(/85[.,]000,00/).first()).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('main').getByText('Visa Galicia')).toBeVisible()
})

test('un gasto con tarjeta se puede fijar en un resumen posterior (presentación tardía)', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('Master')
  await page.getByLabel('Día de cierre').fill('25')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Hotel')
  await page.getByLabel('Monto').fill('100')
  await page.getByLabel('Medio de pago').click()
  await page.getByRole('option', { name: 'Master' }).click()
  await page.getByLabel('Resumen').click()
  // Pinned to the statement after the automatic one (options: "según la
  // fecha", then "Fijar en" the automatic one and the next two).
  await page.getByRole('option', { name: /^Fijar en/ }).nth(1).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Entretenimiento' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('link', { name: 'Ver resúmenes' }).click()
  await expect(page.getByText('Hotel')).toHaveCount(0)
  await page.getByRole('button', { name: 'Resumen siguiente' }).click()
  await expect(page.getByText('Hotel')).toBeVisible()
  await expect(page.getByText('Próximo')).toBeVisible()
})

// Regression (code review, Fase 4a): Gasto with a card → Ingreso with an
// account → back to Gasto left both set, and saving failed.
test('cambiar de pestaña con una tarjeta elegida no deja dos medios de pago', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Galicia')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('Visa')
  await page.getByLabel('Día de cierre').fill('25')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Algo')
  await page.getByLabel('Monto').fill('100')
  await page.getByLabel('Medio de pago').click()
  await page.getByRole('option', { name: 'Visa' }).click()
  await page.getByRole('tab', { name: 'Ingreso' }).click()
  await page.getByLabel('Cuenta', { exact: true }).click()
  await page.getByRole('option', { name: /Galicia/ }).click()
  await expect(page.getByLabel('Cuenta', { exact: true })).toContainText('Galicia')
  await page.getByRole('tab', { name: 'Gasto' }).click()
  await expect(page.getByLabel('Medio de pago')).toContainText('Galicia')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Otros' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Otros · Galicia')).toBeVisible()
})

// Etapa 8, Fase 4b: una compra en cuotas con tarjeta reparte una cuota por
// resumen, empezando por el de la compra.
test('una compra en cuotas con tarjeta pone una cuota en cada resumen', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('Visa')
  await page.getByLabel('Día de cierre').fill('25')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/planes')
  await page.getByRole('tab', { name: 'Cuotas' }).click()
  await page.getByRole('button', { name: 'Nueva compra en cuotas' }).first().click()
  await page.getByLabel('Descripción').fill('Heladera')
  await page.getByLabel('Monto total').fill('300.000')
  await page.getByLabel('Cantidad de cuotas').fill('3')
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Vivienda' }).click()
  await page.getByLabel('Tarjeta (opcional)').click()
  await page.getByRole('option', { name: 'Visa' }).click()
  // With a card the first cuota follows the purchase date.
  await expect(page.getByLabel('Primera cuota')).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('link', { name: 'Ver resúmenes' }).click()
  await expect(page.getByText('Heladera (cuota 1/3)')).toBeVisible()
  await page.getByRole('button', { name: 'Resumen siguiente' }).click()
  await expect(page.getByText('Heladera (cuota 2/3)')).toBeVisible()
  await expect(page.getByText('Proyectado')).toBeVisible()
  await page.getByRole('button', { name: 'Resumen siguiente' }).click()
  await expect(page.getByText('Heladera (cuota 3/3)')).toBeVisible()
})

// Etapa 8, Fase 5: pagar un resumen cerrado desde una cuenta baja su saldo
// (sin crear un gasto), se ve en Movimientos, y se puede deshacer.
test('pagar el resumen cerrado desde una cuenta y deshacerlo', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Galicia')
  await page.getByLabel('Saldo inicial').fill('100.000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('Visa')
  await page.getByLabel('Día de cierre').fill('28')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  // A purchase on the 15th of the month whose statement already closed:
  // last month while today is up to the 28th, this month after it.
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Zapatillas')
  await page.getByLabel('Monto').fill('30.000')
  await page.getByLabel('Fecha', { exact: true }).click()
  if (new Date().getDate() <= 28) await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^15$/ }).click()
  await page.getByLabel('Medio de pago').click()
  await page.getByRole('option', { name: 'Visa' }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Ropa' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo gasto' })).not.toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Pagar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /^Pagar Visa/ })
  // The account in the statement's currency is picked by default.
  await expect(dialog.getByLabel('Desde')).toContainText('Galicia')
  await dialog.getByRole('button', { name: 'Pagar', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('Pagado', { exact: true })).toBeVisible()

  await page.goto('/cuentas')
  await expect(page.getByText(/70[.,]000,00/).first()).toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText(/^Resumen Visa de /)).toBeVisible()
  await expect(page.getByText('Pago de tarjeta · Galicia')).toBeVisible()

  await page.goto('/tarjetas')
  await page.getByRole('link', { name: 'Ver resúmenes' }).click()
  await page.getByRole('button', { name: 'Resumen anterior' }).click()
  await expect(page.getByText(/Pagaste .* desde Galicia/)).toBeVisible()
  await page.getByRole('button', { name: 'Deshacer pago' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deshacer pago' }).click()
  await expect(page.getByRole('button', { name: 'Pagar resumen' })).toBeVisible()

  await page.goto('/cuentas')
  await expect(page.getByText(/100[.,]000,00/).first()).toBeVisible()
})
