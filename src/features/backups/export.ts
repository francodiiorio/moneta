import { readAllTables } from '@/database/repositories/backup.repo'
import { computeChecksum } from './checksum'
import { encryptPayload } from './encryption'
import { BACKUP_FORMAT } from './schemas/v1'
import type { BackupDataV12, BackupV12 } from './schemas/v12'
import packageJson from '../../../package.json'
import { downloadBlob } from '@/lib/download'

export interface ExportedBackup {
  filename: string
  blob: Blob
}

export async function buildBackupPayload(): Promise<BackupV12> {
  const tables = await readAllTables()
  const data: BackupDataV12 = {
    categories: tables.categories,
    expenses: tables.expenses,
    recurringPlans: tables.recurringPlans,
    installmentPlans: tables.installmentPlans,
    budgets: tables.budgets,
    exchangeRates: tables.exchangeRates,
    savingsHoldings: tables.savingsHoldings,
    investmentAssets: tables.investmentAssets,
    investmentHoldings: tables.investmentHoldings,
    assetPrices: tables.assetPrices,
    investmentLots: tables.investmentLots,
    accounts: tables.accounts,
    incomes: tables.incomes,
    accountAdjustments: tables.accountAdjustments,
    transfers: tables.transfers,
    creditCards: tables.creditCards,
    cardStatements: tables.cardStatements,
    statementPayments: tables.statementPayments,
    ...(tables.settings !== undefined && { settings: tables.settings }),
  }
  const checksum = await computeChecksum(data)
  return {
    format: BACKUP_FORMAT,
    version: 12,
    exportedAt: new Date().toISOString(),
    app: { name: 'moneta', version: packageJson.version },
    checksum,
    data,
  }
}

/** @param passphrase When given, the backup is written to disk encrypted
 *  (AES-GCM, see encryption.ts) — never by default. There is no recovery
 *  if the passphrase is lost; the caller is expected to have confirmed it
 *  with the user before calling this. */
export async function exportBackup(passphrase?: string): Promise<ExportedBackup> {
  const payload = await buildBackupPayload()
  const json = JSON.stringify(payload, null, 2)
  const filename = `moneta-${payload.exportedAt.slice(0, 10)}.finance`

  if (passphrase) {
    const envelope = await encryptPayload(json, passphrase)
    return { filename, blob: new Blob([JSON.stringify(envelope)], { type: 'application/json' }) }
  }

  return { filename, blob: new Blob([json], { type: 'application/json' }) }
}

/** Triggers a browser download. UI-only — never call from tests or
 *  from other services. */
export function downloadBackup(exported: ExportedBackup): void {
  downloadBlob(exported.blob, exported.filename)
}
