import { describe, expect, it } from 'vitest'
import { decryptPayload, encryptPayload, isEncryptedBackup } from './encryption'
import type { EncryptedBackup } from './schemas/encrypted'

/** Replicates encryption.ts's own KDF/cipher choices at a caller-chosen
 *  iteration count, bypassing the module's hardcoded ITERATIONS constant
 *  — used to build an envelope that looks like an older file encrypted
 *  before a future bump to that constant. */
async function encryptAtIterations(
  plaintext: string,
  passphrase: string,
  iterations: number,
): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  return {
    format: 'moneta-backup-encrypted',
    version: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

describe('encryptPayload / decryptPayload', () => {
  it('round-trips arbitrary text through the correct passphrase', async () => {
    const plaintext = JSON.stringify({ hello: 'world', amount: 12345 })
    const envelope = await encryptPayload(plaintext, 'correcto-caballo-batería-grapa')
    const decrypted = await decryptPayload(envelope, 'correcto-caballo-batería-grapa')
    expect(decrypted).toBe(plaintext)
  })

  it('uses a fresh salt and iv on every call, even for the same passphrase', async () => {
    const a = await encryptPayload('x', 'misma-contraseña')
    const b = await encryptPayload('x', 'misma-contraseña')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('rejects the wrong passphrase', async () => {
    const envelope = await encryptPayload('secreto', 'contraseña-correcta')
    await expect(decryptPayload(envelope, 'contraseña-incorrecta')).rejects.toThrow()
  })

  it('rejects a tampered ciphertext', async () => {
    const envelope = await encryptPayload('secreto', 'contraseña')
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' }
    await expect(decryptPayload(tampered, 'contraseña')).rejects.toThrow()
  })

  it('decrypts using the iteration count stored in the envelope, not the module default', async () => {
    // Simulates an older file encrypted before a future bump to the
    // module's ITERATIONS constant — the envelope's own `iterations`
    // (not the current default) must be what deriveKey uses, or this
    // decrypt would silently fail against a real old backup.
    const olderEnvelope = await encryptAtIterations('secreto viejo', 'contraseña', 100_000)
    expect(olderEnvelope.iterations).toBe(100_000)
    await expect(decryptPayload(olderEnvelope, 'contraseña')).resolves.toBe('secreto viejo')
  })

  it('rejects an envelope with an unreasonably large iteration count', async () => {
    const envelope = await encryptPayload('secreto', 'contraseña')
    const hostile = { ...envelope, iterations: 50_000_000 }
    await expect(decryptPayload(hostile, 'contraseña')).rejects.toThrow(/irrazonable/)
  })
})

describe('isEncryptedBackup', () => {
  it('recognizes a valid encrypted envelope', async () => {
    const envelope = await encryptPayload('x', 'contraseña')
    expect(isEncryptedBackup(envelope)).toBe(true)
  })

  it('rejects a plaintext backup envelope', () => {
    expect(isEncryptedBackup({ format: 'moneta-backup', version: 1 })).toBe(false)
  })

  it('rejects unrelated JSON', () => {
    expect(isEncryptedBackup({ hello: 'world' })).toBe(false)
    expect(isEncryptedBackup(null)).toBe(false)
    expect(isEncryptedBackup('a string')).toBe(false)
  })
})
