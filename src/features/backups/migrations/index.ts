import { z } from 'zod'
import { backupV1Schema } from '../schemas/v1'
import { backupV2Schema } from '../schemas/v2'
import { backupV3Schema } from '../schemas/v3'
import { backupV4Schema, type BackupDataV4 } from '../schemas/v4'
import { migrateV1ToV2 } from './v1_to_v2'
import { migrateV2ToV3 } from './v2_to_v3'
import { migrateV3ToV4 } from './v3_to_v4'

export const LATEST_VERSION = 4
export type LatestBackupData = BackupDataV4

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
      return migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(result.data.data)))
    }
    case 2: {
      const result = backupV2Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV3ToV4(migrateV2ToV3(result.data.data))
    }
    case 3: {
      const result = backupV3Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV3ToV4(result.data.data)
    }
    case 4: {
      const result = backupV4Schema.safeParse(raw)
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
