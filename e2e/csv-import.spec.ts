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

// Etapa 8, Fase 6: un extracto importado a una cuenta crea débitos e
// ingresos, y después se concilia el saldo contra el del banco.
test('importar un extracto a una cuenta y conciliar su saldo', async ({ page }) => {
  await page.goto('/cuentas')
  await page.getByRole('button', { name: 'Nueva cuenta' }).first().click()
  await page.getByLabel('Nombre').fill('Galicia')
  await page.getByLabel('Saldo inicial').fill('100.000')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/movimientos/importar')
  const today = todayDdMmYyyy()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'galicia.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Fecha,Descripcion,Monto\n${today},Supermercado,-4500\n${today},Sueldo,237000\n`),
  })
  await page.getByLabel('Destino').click()
  await page.getByRole('option', { name: /Cuenta Galicia/ }).click()
  await page.getByLabel('Categoría de ingreso').click()
  await page.getByRole('option', { name: 'Como ingresos · Sueldo' }).click()
  await page.getByText('Elegí una categoría').click()
  await page.getByRole('option', { name: 'Comida' }).click()
  await page.getByRole('combobox').filter({ hasText: 'Positivo = gasto' }).click()
  await page.getByRole('option', { name: /Positivo = ingreso/ }).click()
  await page.getByRole('button', { name: 'Ver vista previa' }).click()
  await expect(page.getByText('Ingreso', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Importar 2 movimientos' }).click()

  await expect(page.getByText('Se importaron 1 gasto y 1 ingreso.')).toBeVisible()
  // 100.000 − 4.500 + 237.000
  await expect(page.getByText(/332[.,]500,00/)).toBeVisible()
  await page.getByLabel(/Saldo según el banco/).fill('332.000')
  await expect(page.getByText(/Diferencia:/)).toBeVisible()
  await page.getByRole('button', { name: 'Registrar ajuste por la diferencia' }).click()
  await expect(page.getByText(/Ajuste registrado/)).toBeVisible()

  await page.goto('/cuentas')
  await expect(page.getByText(/332[.,]000,00/).first()).toBeVisible()
})
