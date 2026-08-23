import { useEffect } from 'react'
import { RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { categoriesRepo, settingsRepo } from '@/database/repositories'
import { materializeDue } from '@/features/plans/service'
import { isStale, refreshQuotes } from '@/features/quotes/service'
import { ThemeProvider } from './theme-provider'
import { router } from './router'

// materializeDue() is itself idempotent, but this guard skips the second
// call from React 18 StrictMode's dev-only double-invoke so the summary
// toast doesn't fire twice for the same app load.
let materializedThisLoad = false
// Same reasoning, for the quotes refresh below.
let quotesRefreshedThisLoad = false

export function App() {
  useEffect(() => {
    // Best-effort: ask the browser not to evict IndexedDB under storage
    // pressure. Silently ignored where unsupported (e.g. Safari < 15.2)
    // — the export/import backup flow is the real safety net.
    void navigator.storage?.persist?.()
    // Only inserts a starter set of categories if none exist yet — never
    // duplicates, never overwrites what the user already created.
    void categoriesRepo.seedDefaultsIfEmpty()

    if (!materializedThisLoad) {
      materializedThisLoad = true
      void materializeDue()
        .then(({ recurringCreated, installmentsConfirmed, failedPlanIds }) => {
          const total = recurringCreated + installmentsConfirmed
          if (total > 0) {
            const parts = []
            if (recurringCreated > 0) parts.push(`${recurringCreated} recurrente${recurringCreated === 1 ? '' : 's'}`)
            if (installmentsConfirmed > 0) parts.push(`${installmentsConfirmed} cuota${installmentsConfirmed === 1 ? '' : 's'}`)
            toast.info(`Se pusieron al día ${parts.join(' y ')}`)
          }
          if (failedPlanIds.length > 0) {
            toast.error(
              `No se pudo${failedPlanIds.length === 1 ? '' : 'ieron'} poner al día ${failedPlanIds.length} ` +
                `recurrente${failedPlanIds.length === 1 ? '' : 's'} — revisalo en Planes`,
            )
          }
        })
        .catch((error: unknown) => {
          console.error('materializeDue falló por completo', error)
          toast.error('No se pudieron poner al día los recurrentes ni las cuotas')
        })
    }

    if (!quotesRefreshedThisLoad) {
      quotesRefreshedThisLoad = true
      // Opt-in and silent: never runs unless the user turned it on
      // (Patrimonio → Cotizaciones), and never shows a toast on its own
      // — a failure here shouldn't interrupt opening the app, and the
      // Cotizaciones tab already surfaces "última actualización"
      // reactively for whoever cares to look.
      void settingsRepo
        .getSettings()
        .then((settings) => {
          if (!settings.autoQuotesEnabled) return
          if (!isStale(settings.quotesRefreshedAt)) return
          return refreshQuotes()
        })
        .catch((error: unknown) => {
          console.error('refreshQuotes falló al abrir la app', error)
        })
    }
  }, [])

  return (
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  )
}
