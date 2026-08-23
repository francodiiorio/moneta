import { z } from 'zod'

export const ENCRYPTED_BACKUP_FORMAT = 'moneta-backup-encrypted'

/**
 * Envelope wrapping an encrypted `BackupV1` (or whatever the latest
 * plaintext format is) — this is a transport-level concern, orthogonal
 * to the backup data schema's own versioning. `kdf`/`hash`/`iterations`
 * are stored per-file (not hardcoded) so a future bump to the default
 * iteration count doesn't break decrypting an older file.
 */
export const encryptedBackupSchema = z.object({
  format: z.literal(ENCRYPTED_BACKUP_FORMAT),
  version: z.literal(1),
  kdf: z.literal('PBKDF2'),
  hash: z.literal('SHA-256'),
  iterations: z.number().int().positive(),
  /** base64 */
  salt: z.string().min(1),
  /** base64 */
  iv: z.string().min(1),
  /** base64 — the plaintext BackupV1, JSON.stringify'd then encrypted whole. */
  ciphertext: z.string().min(1),
})

export type EncryptedBackup = z.infer<typeof encryptedBackupSchema>
