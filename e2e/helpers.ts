import { expect, type Page } from '@playwright/test'

/** Turns on Ajustes → "Opciones avanzadas", for tests of the options it
 *  shows (conciliation, closing-day option, yearly budgets, CSV import). */
export async function enableAdvancedMode(page: Page) {
  await page.goto('/ajustes')
  const toggle = page.getByRole('switch', { name: 'Opciones avanzadas' })
  await toggle.click()
  await expect(toggle).toBeChecked()
}

/** Unfolds the home's "Más del mes" (KPIs, charts, cuentas, patrimonio),
 *  folded under "¿cuánto me queda?" since Etapa 9. */
export async function openMonthDetail(page: Page) {
  const details = page.locator('details', { has: page.getByText(/^Más del mes/) })
  if ((await details.getAttribute('open')) === null) await page.getByText(/^Más del mes/).click()
  await expect(details).toHaveAttribute('open', '')
}
