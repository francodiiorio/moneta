import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

// Etapa 9, Fase 4a: los vencimientos se bajan como un .ics para el
// calendario del celular, armado en el dispositivo.
test('agregar al calendario baja un .ics con cierres y vencimientos', async ({ page }) => {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill('visa 2551')
  await page.getByLabel('Día de cierre').fill('22')
  await page.getByLabel('Día de vencimiento').fill('4')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.goto('/')
  await page.getByRole('button', { name: 'Agregar al calendario' }).click()
  const dialog = page.getByRole('dialog', { name: 'Agregar al calendario' })
  await expect(dialog.getByRole('checkbox', { name: 'Tarjetas' })).toBeChecked()
  await expect(dialog.getByRole('checkbox', { name: 'Mostrar los montos' })).not.toBeChecked()

  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Bajar el archivo' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^moneta-vencimientos-\d{4}-\d{2}-\d{2}\.ics$/)
  const ics = await readFile(await file.path(), 'utf8')
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/)
  expect(ics).toContain('SUMMARY:Cierra visa 2551')
  expect(ics).toContain('SUMMARY:Vence visa 2551')
  expect(ics).toContain('BEGIN:VALARM')
  // 12 months, one close each: 11 when this month's close already passed.
  expect(ics.match(/SUMMARY:Cierra visa 2551/g)?.length).toBeGreaterThanOrEqual(11)
  expect(ics).toContain('SUMMARY:Bajá de nuevo tus vencimientos de Moneta')
  await expect(dialog).not.toBeVisible()
})
