import { db } from '../db'
import type { Settings } from '@/domain/entities'

const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  baseCurrency: 'ARS',
  locale: 'es-AR',
  firstDayOfMonth: 1,
  theme: 'system',
  schemaVersion: 1,
}

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('singleton')
  return existing ?? DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = { ...current, ...patch }
  await db.settings.put(next)
  return next
}
