import { expect, test, type Page } from '@playwright/test'

async function createCard(page: Page, name: string) {
  await page.goto('/tarjetas')
  await page.getByRole('button', { name: 'Nueva tarjeta' }).first().click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Día de cierre').fill('25')
  await page.getByLabel('Día de vencimiento').fill('5')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible()
}

// Ajustes → "Borrar todos los datos": pide escribir BORRAR, borra todo y la
// app vuelve como recién instalada (con sus categorías por defecto).
test('borrar todos los datos deja la app como recién instalada', async ({ page, context }) => {
  await createCard(page, 'Galicia')
  await page.goto('/ajustes')
  await page.getByRole('combobox').filter({ hasText: 'ARS' }).click()
  await page.getByRole('option', { name: 'USD' }).click()
  await expect(page.getByRole('combobox').filter({ hasText: 'USD' })).toBeVisible()

  // Another open tab of the app restarts too.
  const otherTab = await context.newPage()
  await otherTab.goto('/tarjetas')
  await expect(otherTab.getByRole('main').getByText('Galicia', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Borrar todos los datos' }).click()
  const dialog = page.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Borrar todo' })
  const input = dialog.getByLabel(/Escribí BORRAR/)
  await input.fill('BORRA')
  await expect(confirm).toBeDisabled()
  await input.fill('borrar')
  await confirm.click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Bienvenido a Moneta')).toBeVisible()
  await page.goto('/tarjetas')
  await expect(page.getByRole('tab', { name: 'Tarjetas', selected: true })).toBeVisible()
  await expect(page.getByText('Galicia')).toHaveCount(0)

  await expect(otherTab).toHaveURL(/\/$/)

  // Default settings and categories are back for a fresh start.
  await page.goto('/ajustes')
  await expect(page.getByRole('combobox').filter({ hasText: 'ARS' })).toBeVisible()
  await page.goto('/ajustes/categorias')
  await expect(page.getByText('Comida').first()).toBeVisible()
})

test('cancelar no borra nada', async ({ page }) => {
  await createCard(page, 'Brubank')
  await page.goto('/ajustes')
  await page.getByRole('button', { name: 'Borrar todos los datos' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByLabel(/Escribí BORRAR/).fill('BORRAR')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(dialog).not.toBeVisible()

  // Reopening starts with an empty confirmation.
  await page.getByRole('button', { name: 'Borrar todos los datos' }).click()
  await expect(page.getByRole('alertdialog').getByLabel(/Escribí BORRAR/)).toHaveValue('')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click()

  await page.goto('/tarjetas')
  await expect(page.getByRole('main').getByText('Brubank', { exact: true })).toBeVisible()
})
