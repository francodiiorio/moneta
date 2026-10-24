import { useState } from 'react'

/**
 * For a dialog open while `value` is set: keeps the last value after it's
 * cleared, so the content stays during the close animation, and gives a
 * new `key` on every open so the body (and its form) starts fresh.
 */
export function useDialogSession<T>(value: T | undefined): { key: number; value: T } | undefined {
  const [session, setSession] = useState(() => (value !== undefined ? { key: 1, value } : undefined))
  const [wasOpen, setWasOpen] = useState(value !== undefined)
  if ((value !== undefined) !== wasOpen) {
    setWasOpen(value !== undefined)
    if (value !== undefined) setSession({ key: (session?.key ?? 0) + 1, value })
  }
  return session
}
