const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32, no I/L/O/U

function encodeTime(time: number, len: number): string {
  let out = ''
  let n = time
  for (let i = len - 1; i >= 0; i--) {
    const char = ENCODING[n % 32]
    out = char + out
    n = Math.floor(n / 32)
  }
  return out
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) {
    out += ENCODING[byte % 32]
  }
  return out
}

/**
 * Generates a ULID-like id: a 10-char base32 timestamp (millisecond,
 * sortable) followed by 16 random base32 chars. Good enough for a
 * single-user local-first app — not a full ULID (no monotonic counter
 * for same-millisecond collisions), but collision odds are negligible
 * at this write volume.
 */
export function generateId(): string {
  return encodeTime(Date.now(), 10) + encodeRandom(16)
}
