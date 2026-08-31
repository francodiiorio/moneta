import { expect, test } from '@playwright/test'

test('exporta un informe del mes y lo muestra sin chrome de la app', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Banco Prueba')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos')
  await page.getByRole('button', { name: 'Nuevo movimiento' }).first().click()
  await page.getByLabel('Descripción').fill('Supermercado')
  await page.getByLabel('Monto').fill('1500')
  await page.getByRole('combobox', { name: 'Cuenta' }).click()
  await page.getByRole('option', { name: 'Banco Prueba' }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/reportes')
  await page.getByRole('link', { name: 'Exportar informe' }).click()
  await expect(page).toHaveURL(/\/reportes\/informe\/\d{4}-\d{2}$/)

  await expect(page.getByRole('heading', { level: 1 })).toContainText(/\d{4}/)
  await expect(page.getByText('Ingresos', { exact: true })).toBeVisible()
  await expect(page.getByText(/1[.,]500,00/).first()).toBeVisible()
  // .getByText('Comida') would also match Recharts' aria-hidden text-
  // measurement span, which the ReportsPage chart left behind in the
  // document — this is a same-tab (client-side) navigation, so there's
  // no full page reload to clear it. Scope to the actual table cell.
  await expect(page.getByRole('cell', { name: 'Comida' })).toBeVisible()

  // Zero app chrome: the sidebar nav only exists inside AppLayout, which
  // this route deliberately doesn't render.
  await expect(page.getByRole('link', { name: 'Movimientos' })).toHaveCount(0)

  // Print styles actually apply — the closest we can get to verifying
  // the printed/PDF output in headless Chromium.
  const printButton = page.getByRole('button', { name: /Imprimir/ })
  await expect(printButton).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(printButton).toBeHidden()
  // .getByText('Comida') would also match Recharts' aria-hidden text-
  // measurement span, which the ReportsPage chart left behind in the
  // document — this is a same-tab (client-side) navigation, so there's
  // no full page reload to clear it. Scope to the actual table cell.
  await expect(page.getByRole('cell', { name: 'Comida' })).toBeVisible()
  await page.emulateMedia({ media: 'screen' })
})

test('un mes inválido en la URL muestra un estado amable en vez de romper', async ({ page }) => {
  await page.goto('/reportes/informe/2026-13')
  await expect(page.getByText('Mes inválido')).toBeVisible()
  await page.getByRole('link', { name: 'Volver a Reportes' }).click()
  await expect(page).toHaveURL('/reportes')
})
