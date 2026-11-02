import { expect, test, type Page } from '@playwright/test'

async function addGasto(page: Page, description: string, amount: string) {
  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill(description)
  await page.getByLabel('Monto').fill(amount)
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

// Etapa 9, Fase 4c: el Inicio dice qué cambió contra el mes anterior.
test('observaciones: un comercio que costó más que a esta altura del mes anterior', async ({ page }) => {
  // Each gasto takes today's date: the clock moves between them.
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00'))
  await addGasto(page, 'Rappi', '100.000')
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00'))
  await addGasto(page, 'Rappi', '140.000')

  await page.goto('/')
  const panel = page.locator('[data-slot="card"]', { has: page.getByRole('heading', { name: 'Lo que cambió' }) })
  // Comida is just Rappi: said once.
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await expect(panel.getByRole('listitem')).toHaveText(/^En Rappi llevás \$\s?140\.000,00, 40\s?% más que a esta altura de octubre\.$/)
})
