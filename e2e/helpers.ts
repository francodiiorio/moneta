import { expect, type Page } from '@playwright/test'

/** Turns on Ajustes → "Opciones avanzadas", for tests of the options it
 *  shows (conciliation, closing-day option, yearly budgets, CSV import). */
export async function enableAdvancedMode(page: Page) {
  await page.goto('/ajustes')
  const toggle = page.getByRole('switch', { name: 'Opciones avanzadas' })
  await toggle.click()
  await expect(toggle).toBeChecked()
}
