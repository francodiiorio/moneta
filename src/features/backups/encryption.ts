import { ENCRYPTED_BACKUP_FORMAT, encryptedBackupSchema, type EncryptedBackup } from './schemas/encrypted'

const KDF = 'PBKDF2'
const HASH = 'SHA-256'
/** OWASP's current recommendation for PBKDF2-HMAC-SHA256 (2023 cheat
 *  sheet). Stored per-file in the envelope, not just as this constant, so
 *  a future bump doesn't break decrypting a file encrypted today. */
const ITERATIONS = 600_000
/** `envelope.iterations` comes from an untrusted file — a hand-edited
 *  `.finance` with an absurd value (e.g. 4 billion) would otherwise make
 *  PBKDF2 hang the tab for minutes before the wrong-passphrase/corrupt
 *  error even has a chance to surface. Comfortably above any sane future
 *  bump to ITERATIONS, but far below what could freeze the page. */
const MAX_ITERATIONS = 5_000_000
const SALT_BYTES = 16
const IV_BYTES = 12

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    KDF,
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: KDF, salt, iterations, hash: HASH },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypts `plaintext` (the JSON.stringify'd backup payload) with a key
 *  derived from `passphrase`. Fresh random salt + IV every call — never
 *  reused, even for the same passphrase. */
export async function encryptPayload(plaintext: string, passphrase: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, ITERATIONS)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )

  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: 1,
    kdf: KDF,
    hash: HASH,
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

/**
 * Decrypts `envelope` back to the plaintext JSON string. AES-GCM is
 * authenticated — a wrong passphrase or a tampered/corrupted envelope
 * both make `crypto.subtle.decrypt` throw. The two cases are
 * indistinguishable by design (telling them apart would open a padding-
 * oracle-style leak), so the caller should show one generic message for
 * both, never try to guess which one happened.
 */
export async function decryptPayload(envelope: EncryptedBackup, passphrase: string): Promise<string> {
  if (envelope.iterations > MAX_ITERATIONS) {
    throw new Error(`El backup pide un costo de derivación de clave irrazonable (${envelope.iterations} iteraciones).`)
  }

  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  const key = await deriveKey(passphrase, salt, envelope.iterations)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    base64ToBytes(envelope.ciphertext),
  )

  return new TextDecoder().decode(plaintext)
}

export function isEncryptedBackup(raw: unknown): raw is EncryptedBackup {
  return encryptedBackupSchema.safeParse(raw).success
}
