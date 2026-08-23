import { useEffect } from 'react'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { categoriesRepo } from '@/database/repositories'
import { ThemeProvider } from './theme-provider'
import { router } from './router'

export function App() {
  useEffect(() => {
    // Best-effort: ask the browser not to evict IndexedDB under storage
    // pressure. Silently ignored where unsupported (e.g. Safari < 15.2)
    // — the export/import backup flow is the real safety net.
    void navigator.storage?.persist?.()
    // Only inserts a starter set of categories if none exist yet — never
    // duplicates, never overwrites what the user already created.
    void categoriesRepo.seedDefaultsIfEmpty()
  }, [])

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  )
}
