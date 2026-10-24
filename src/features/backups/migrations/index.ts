import { z } from 'zod'
import { backupV1Schema } from '../schemas/v1'
import { backupV2Schema } from '../schemas/v2'
import { backupV3Schema } from '../schemas/v3'
import { backupV4Schema } from '../schemas/v4'
import { backupV5Schema } from '../schemas/v5'
import { backupV6Schema } from '../schemas/v6'
import { backupV7Schema } from '../schemas/v7'
import { backupV8Schema } from '../schemas/v8'
import { backupV9Schema, type BackupDataV9 } from '../schemas/v9'
import { migrateV1ToV2 } from './v1_to_v2'
import { migrateV2ToV3 } from './v2_to_v3'
import { migrateV3ToV4 } from './v3_to_v4'
import { migrateV4ToV5 } from './v4_to_v5'
import { migrateV5ToV6 } from './v5_to_v6'
import { migrateV6ToV7 } from './v6_to_v7'
import { migrateV7ToV8 } from './v7_to_v8'
import { migrateV8ToV9 } from './v8_to_v9'

export const LATEST_VERSION = 9
export type LatestBackupData = BackupDataV9

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
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(result.data.data))))))))
    }
    case 2: {
      const result = backupV2Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(result.data.data)))))))
    }
    case 3: {
      const result = backupV3Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(result.data.data))))))
    }
    case 4: {
      const result = backupV4Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(result.data.data)))))
    }
    case 5: {
      const result = backupV5Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(result.data.data))))
    }
    case 6: {
      const result = backupV6Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(migrateV6ToV7(result.data.data)))
    }
    case 7: {
      const result = backupV7Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(migrateV7ToV8(result.data.data))
    }
    case 8: {
      const result = backupV8Schema.safeParse(raw)
      if (!result.success) {
        const detail = result.error.issues.map((issue) => issue.message).join('; ')
        throw new Error(`El backup no es válido: ${detail}`)
      }
      return migrateV8ToV9(result.data.data)
    }
    case 9: {
      const result = backupV9Schema.safeParse(raw)
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
