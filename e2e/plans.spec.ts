import { expect, test, type Page } from '@playwright/test'

async function createRecurringPlan(page: Page) {
  await page.getByRole('button', { name: 'Nuevo recurrente' }).first().click()
  await page.getByLabel('Descripción').fill('Alquiler')
  await page.getByLabel('Monto').fill('100000')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option').first().click()
  // Start date a month ago so it has something to materialize —
  // createRecurringPlanFromForm materializes immediately on creation, no
  // reload needed (see the "materializes its first payment immediately"
  // test below).
  await page.getByLabel('Empieza', { exact: true }).click()
  await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^1$/ }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo recurrente' })).not.toBeVisible()
}

test('a recurring plan starting today materializes its first payment immediately, no reload needed', async ({
  page,
}) => {
  // Regression: creating a plan left the just-due occurrence unmaterialized
  // until the next full app load — App.tsx only runs materializeDue() once
  // on mount, and creating a plan via the dialog doesn't trigger it again.
  await page.goto('/planes')
  await page.getByRole('button', { name: 'Nuevo recurrente' }).first().click()
  await page.getByLabel('Descripción').fill('gym')
  await page.getByLabel('Monto').fill('55990')
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option').first().click()
  // Leave "Empieza" at its default (today) — no date picker interaction.
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nuevo recurrente' })).not.toBeVisible()

  await page.goto('/movimientos')
  await expect(page.getByText('gym').first()).toBeVisible()
})

test('deleting a recurring plan keeps its generated gastos by default', async ({ page }) => {
  await page.goto('/planes')
  await createRecurringPlan(page)

  await page.goto('/movimientos')
  await expect(page.getByText('Alquiler').first()).toBeVisible()

  await page.goto('/planes')
  await page.locator('div.rounded-xl', { hasText: 'Alquiler' }).locator('button').last().click()
  // Regression: this used to be the only option — deleting a plan left no
  // way to also remove the gastos it already generated.
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

test('checking "Borrar también" removes the plan\'s generated gastos too', async ({ page }) => {
  await page.goto('/planes')
  await createRecurringPlan(page)

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

// Cuotas que ya venías pagando: Moneta arranca desde la cuota del resumen en
// curso, y avisa si la fecha de compra no cuadra con ese número.
test('una compra en cuotas que ya venías pagando arranca desde la cuota del resumen en curso', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('visa 2551')
  await page.getByLabel('Día de cierre').fill('28')
  await page.getByLabel('Día de vencimiento').fill('6')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/planes')
  await page.getByRole('tab', { name: 'Cuotas' }).click()
  await page.getByRole('button', { name: 'Nueva compra en cuotas' }).first().click()
  await page.getByLabel('Descripción').fill('cubiertas')
  await page.getByLabel('Monto total').fill('528.240')
  await page.getByLabel('Cantidad de cuotas').fill('6')
  await page.getByLabel('Categoría').click()
  await page.getByRole('option', { name: 'Transporte' }).click()
  await page.getByLabel('Tarjeta (opcional)').click()
  await page.getByRole('option', { name: 'visa 2551' }).click()
  // Bought on the 15th of last month (this month while past the 28th):
  // one statement back, so today's statement bills cuota 2.
  await page.getByLabel('Fecha de compra').click()
  if (new Date().getDate() <= 28) await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^15$/ }).click()
  await page.getByRole('switch', { name: 'Ya la venía pagando' }).click()
  await page.getByLabel('¿Qué cuota figura en el resumen en curso?').fill('3')
  await expect(page.getByText(/la cuota del resumen en curso es la 2/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await page.getByLabel('¿Qué cuota figura en el resumen en curso?').fill('2')
  await expect(page.getByText(/la cuota del resumen en curso es la/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog', { name: 'Nueva compra en cuotas' })).not.toBeVisible()

  await expect(page.getByText('Cuota 2 de 6 · en el resumen en curso')).toBeVisible()
  await expect(page.getByText('4 cuotas')).toBeVisible()
})
