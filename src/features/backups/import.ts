import { replaceAllTables } from '@/database/repositories/backup.repo'
import { computeChecksum } from './checksum'
import { decryptPayload, isEncryptedBackup } from './encryption'
import { migrateToLatest } from './migrations'
import { validateLedgerIntegrity } from './validate'

export interface ImportResult {
  /** false if the file's checksum didn't match its contents — still
   *  imported (data passed schema + invariant validation), but the UI
   *  should warn the user the file may have been edited or corrupted. */
  checksumMatched: boolean
}

/** Thrown when `file` is encrypted and `importBackup` was called without
 *  a `passphrase` — distinct from a generic parse error so the caller can
 *  prompt for one instead of just showing a failure. */
export class PassphraseRequiredError extends Error {
  constructor() {
    super('Este backup está cifrado — hace falta la contraseña.')
    this.name = 'PassphraseRequiredError'
  }
}

/** Cheap check for the UI to decide whether to prompt for a passphrase
 *  before calling `importBackup` — parses the outer JSON envelope only,
 *  never attempts to decrypt. `false` for anything that isn't valid JSON
 *  too; `importBackup` is the source of truth for real parse errors. */
export async function peekIsEncrypted(file: File): Promise<boolean> {
  try {
    return isEncryptedBackup(JSON.parse(await file.text()))
  } catch {
    return false
  }
}

/**
 * Parses (decrypting first if needed), migrates, and validates `file`,
 * then atomically replaces the entire database with its contents. Does
 * not download a safety backup first — callers (the Settings UI) are
 * expected to call `exportBackup` + `downloadBackup` immediately before
 * this, so the download only happens where there's a user to hand it to.
 */
export async function importBackup(file: File, passphrase?: string): Promise<ImportResult> {
  const text = await file.text()

  let outer: unknown
  try {
    outer = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es JSON válido.')
  }

  let raw: unknown = outer
  if (isEncryptedBackup(outer)) {
    if (!passphrase) throw new PassphraseRequiredError()
    let plaintext: string
    try {
      plaintext = await decryptPayload(outer, passphrase)
    } catch {
      throw new Error('Contraseña incorrecta o archivo dañado.')
    }
    try {
      raw = JSON.parse(plaintext)
    } catch {
      throw new Error('Contraseña incorrecta o archivo dañado.')
    }
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
