import { expect, test } from '@playwright/test'

// Etapa 9: five sections, all of them in the bottom bar (no "Más" sheet);
// Reportes and Ajustes are icons in the top bar.
test.use({ viewport: { width: 390, height: 844 } })

test('mobile shows the five sections at the bottom and Reportes/Ajustes at the top', async ({ page }) => {
  await page.goto('/')

  const bottomNav = page.locator('nav.fixed.bottom-0')
  await expect(bottomNav.getByRole('link')).toHaveCount(5)
  for (const label of ['Inicio', 'Movimientos', 'Tarjetas y cuentas', 'Presupuesto', 'Patrimonio']) {
    await expect(bottomNav.getByRole('link', { name: label })).toBeVisible()
  }

  const topNav = page.locator('header').getByRole('navigation', { name: 'Reportes y ajustes' })
  await topNav.getByRole('link', { name: 'Ajustes' }).click()
  await expect(page).toHaveURL(/\/ajustes/)
  await topNav.getByRole('link', { name: 'Reportes' }).click()
  await expect(page).toHaveURL(/\/reportes/)

  await bottomNav.getByRole('link', { name: 'Tarjetas y cuentas' }).click()
  await page.getByRole('tab', { name: 'Cuentas' }).click()
  await expect(page).toHaveURL(/\/tarjetas\?tab=cuentas/)
})

test('old URLs land on their new place', async ({ page }) => {
  await page.goto('/cuentas')
  await expect(page).toHaveURL(/\/tarjetas\?tab=cuentas/)
  await expect(page.getByRole('tab', { name: 'Cuentas', selected: true })).toBeVisible()

  await page.goto('/planes')
  await expect(page).toHaveURL(/\/presupuestos\?tab=fijos/)
  await expect(page.getByRole('tab', { name: 'Fijos', selected: true })).toBeVisible()
})

// Lo avanzado no aparece hasta activarlo en Ajustes.
test('the advanced options stay hidden until turned on in Ajustes', async ({ page }) => {
  await page.goto('/movimientos')
  await expect(page.getByRole('link', { name: 'Importar CSV' })).toHaveCount(0)
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).first().click()
  await expect(page.getByRole('dialog').getByText('Período')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.goto('/ajustes')
  await page.getByRole('switch', { name: 'Opciones avanzadas' }).click()
  await expect(page.getByRole('switch', { name: 'Opciones avanzadas' })).toBeChecked()

  await page.goto('/movimientos')
  await expect(page.getByRole('link', { name: 'Importar CSV' })).toBeVisible()
  await page.goto('/presupuestos')
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).first().click()
  await expect(page.getByRole('dialog').getByText('Período')).toBeVisible()
})
