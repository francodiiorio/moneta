/** Triggers a browser download of `blob` — the file never leaves the
 *  device on its own. UI-only: never call from tests or services. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked right after the click, WebKit (an installed iOS PWA) can drop
  // the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
