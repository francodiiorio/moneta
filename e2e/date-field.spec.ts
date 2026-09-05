import { expect, test } from '@playwright/test'

// Regression: every date field used the native <input type="date">, whose
// display format follows the browser's own locale — almost always
// mm/dd/yyyy regardless of the app being in Spanish. DateField (a
// Popover+Calendar) always shows dd/mm/yyyy and never depends on the
// browser's locale.
test('the date picker shows dd/mm/aaaa, navigates months, and can be cleared', async ({ page }) => {
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo gasto' }).first().click()

  const trigger = page.getByLabel('Fecha', { exact: true })
  await expect(trigger).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/)

  await trigger.click()
  await expect(page.getByRole('button', { name: 'Ir al mes anterior' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ir al mes siguiente' })).toBeVisible()

  await page.getByRole('button', { name: 'Ir al mes anterior' }).click()
  await page.locator('.rdp-day:not(.rdp-outside) .rdp-day_button', { hasText: /^15$/ }).click()
  // name: 'Nuevo gasto' — Radix's (now-closed) Popover content also
  // carries role="dialog" and stays in the DOM, so an unscoped
  // getByRole('dialog') strict-mode-violates against it.
  await expect(page.getByRole('dialog', { name: 'Nuevo gasto' })).toBeVisible()

  await page.getByLabel('Limpiar fecha').click()
  await expect(trigger).toHaveText('Elegí una fecha')
})
