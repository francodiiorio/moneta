function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    const sorted: Record<string, unknown> = {}
    for (const [key, val] of entries) sorted[key] = canonicalize(val)
    return sorted
  }
  return value
}

/** SHA-256 over a canonical (sorted-key) JSON serialization, so the
 *  checksum doesn't depend on property insertion order. */
export async function computeChecksum(data: unknown): Promise<string> {
  const canonical = JSON.stringify(canonicalize(data))
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
