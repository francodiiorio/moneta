import { expect, test } from '@playwright/test'

// Regression: the mobile bottom nav used to cram all 8 sections into
// icon-only tabs — too many for a bottom bar (~5 is the usable max
// before targets get cramped). Now it shows the 4 most-used sections
// plus a "Más" button that opens a sheet with the rest, labeled.
test.use({ viewport: { width: 390, height: 844 } })

test('mobile bottom nav shows 5 tabs and "Más" opens the overflow sheet', async ({ page }) => {
  await page.goto('/')

  const bottomNav = page.locator('nav.fixed.bottom-0')
  await expect(bottomNav.getByRole('link')).toHaveCount(4)
  await expect(bottomNav.getByRole('button', { name: 'Más' })).toBeVisible()

  await bottomNav.getByRole('button', { name: 'Más' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  for (const label of ['Planes', 'Patrimonio', 'Reportes', 'Ajustes']) {
    await expect(page.getByRole('link', { name: label })).toBeVisible()
  }

  await page.getByRole('link', { name: 'Patrimonio' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/\/patrimonio/)
})
