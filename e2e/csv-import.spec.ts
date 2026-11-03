import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Regression: the file field used the unstyled native browser control
// (raw "Choose File" button) sitting next to the app's designed inputs.
// It's now a real Button that triggers a hidden input — this covers the
// picker itself, not the full mapping/import pipeline (pre-existing,
// out of scope for this fix).
test('picking a CSV file shows its name and detects the data rows', async ({ page }) => {
  await page.goto('/movimientos/importar')

  await expect(page.getByText('Ningún archivo elegido')).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles(path.join(dirname, 'fixtures', 'extracto-prueba.csv'))

  await expect(page.getByText('extracto-prueba.csv')).toBeVisible()
  await expect(page.getByText('2 filas de datos detectadas.')).toBeVisible()
})

function todayDdMmYyyy(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// Sólo se importan gastos: los créditos (plata que entró) se muestran en la
// vista previa pero quedan sin importar.
test('importar un extracto crea los gastos y deja afuera los créditos', async ({ page }) => {
  await page.goto('/movimientos/importar')
  const today = todayDdMmYyyy()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'galicia.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Fecha,Descripcion,Monto\n${today},Supermercado,4500\n${today},Sueldo,-237000\n`),
  })
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('button', { name: 'Ver vista previa' }).click()
  await expect(page.getByText('1 crédito sin importar')).toBeVisible()
  await page.getByRole('button', { name: 'Importar 1 movimiento' }).click()

  await expect(page).toHaveURL(/\/movimientos$/)
  await expect(page.getByText('Supermercado')).toBeVisible()
  await expect(page.getByText('Sueldo')).toHaveCount(0)
})
