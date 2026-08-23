import { replaceAllTables } from '@/database/repositories/backup.repo'
import { computeChecksum } from './checksum'
import { migrateToLatest } from './migrations'
import { validateLedgerIntegrity } from './validate'

export interface ImportResult {
  /** false if the file's checksum didn't match its contents — still
   *  imported (data passed schema + invariant validation), but the UI
   *  should warn the user the file may have been edited or corrupted. */
  checksumMatched: boolean
}

/**
 * Parses, migrates, and validates `file`, then atomically replaces the
 * entire database with its contents. Does not download a safety
 * backup first — callers (the Settings UI) are expected to call
 * `exportBackup` + `downloadBackup` immediately before this, so the
 * download only happens where there's a user to hand it to.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  const text = await file.text()

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }

  const data = migrateToLatest(raw)
  validateLedgerIntegrity(data)

  const expectedChecksum =
    typeof raw === 'object' && raw !== null && 'checksum' in raw ? raw.checksum : undefined
  const actualChecksum = await computeChecksum(data)
  const checksumMatched =
    typeof expectedChecksum === 'string' && expectedChecksum === actualChecksum

  await replaceAllTables(data)

  return { checksumMatched }
}
