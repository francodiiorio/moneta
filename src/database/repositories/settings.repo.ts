import { db } from '../db'
import type { Settings } from '@/domain/entities'

const DEFAULT_SETTINGS: Settings = {
  id: 'singleton',
  baseCurrency: 'ARS',
  locale: 'es-AR',
  firstDayOfMonth: 1,
  theme: 'system',
  schemaVersion: 1,
  autoQuotesEnabled: false,
  hideSavingsAndInvestmentsAmount: false,
  // Matches the fallback the Cotizaciones select already shows
  // (`settings.rateProfile ?? 'oficial'`) — without this, that visual
  // default was never actually persisted, and `candidatesFor` in
  // domain/currency/rates.ts only matches untagged rates when `profile`
  // is undefined, so every ARS<->USD conversion silently failed once all
  // loaded rates carried an explicit profile.
  rateProfile: 'oficial',
}

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('singleton')
  // Merge, not `?? DEFAULT_SETTINGS`: a row persisted before a field
  // existed (e.g. autoQuotesEnabled) would otherwise never pick up its
  // default just because *some* fields are already saved.
  return existing ? { ...DEFAULT_SETTINGS, ...existing } : DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = { ...current, ...patch }
  await db.settings.put(next)
  return next
}
