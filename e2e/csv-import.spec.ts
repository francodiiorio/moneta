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
