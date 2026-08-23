import { z } from 'zod'
import { backupV1Schema, type BackupDataV1 } from '../schemas/v1'

export const LATEST_VERSION = 1
export type LatestBackupData = BackupDataV1

const versionEnvelopeSchema = z.object({ version: z.number().int() })

/**
 * Migrates a raw parsed backup JSON to the latest in-memory shape.
 * Add a case here (and a schemas/vN.ts + migrations/vN_to_vN+1.ts) for
 * every future format bump — never edit an existing case's schema.
 */
export function migrateToLatest(raw: unknown): LatestBackupData {
  const envelope = versionEnvelopeSchema.safeParse(raw)
  if (!envelope.success) {
    throw new Error('El archivo no tiene el formato de backup esperado.')
  }

  const { version } = envelope.data
  if (version > LATEST_VERSION) {
    throw new Error(
      `Este backup fue creado por una versión más nueva de la app (v${version}). Actualizá Moneta para poder importarlo.`,
    )
  }

  switch (version) {
    case 1: {
      const result = backupV1Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return result.data.data
    }
    default:
      throw new Error(`Versión de backup desconocida: ${version}`)
  }
}
