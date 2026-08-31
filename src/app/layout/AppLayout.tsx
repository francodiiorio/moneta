import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { NAV_ITEMS } from '../nav-items'
import { cn } from '@/lib/cn'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/sheet'

// El bottom nav mobile sólo tiene lugar cómodo para ~5 items sin etiqueta
// (ver docs de usabilidad mobile: más que eso, los targets se apretujan y
// se pierde legibilidad). Se muestran los 4 de uso más frecuente y el
// resto se agrupa en la hoja "Más".
const MOBILE_PRIMARY_ITEMS = NAV_ITEMS.slice(0, 4)
const MOBILE_OVERFLOW_ITEMS = NAV_ITEMS.slice(4)

export function AppLayout() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const isOverflowActive = MOBILE_OVERFLOW_ITEMS.some((item) => location.pathname.startsWith(item.to))

  return (
    // pt-[env(safe-area-inset-top)]: installed as a PWA (standalone display
    // mode), iOS renders the status bar as a translucent overlay instead of
    // reserving its own space — without this, page content starts under
    // the status bar/notch instead of below it. Needs viewport-fit=cover
    // in index.html or env() resolves to 0 (also a no-op on any device
    // without a notch/status-bar overlay, e.g. desktop or a plain browser
    // tab).
    <div className="flex min-h-svh bg-background pt-[env(safe-area-inset-top)]">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border px-2.5 py-5 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-xs font-bold">M</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">Moneta</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* pb-[env(safe-area-inset-bottom)]: on an iPhone with a home
          indicator, running as an installed PWA (standalone display mode)
          puts this nav flush against the bottom edge — without this, the
          icons render underneath/behind the indicator instead of above it.
          Needs index.html's viewport-fit=cover or env() resolves to 0. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                'flex flex-1 items-center justify-center py-3',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="size-5" />
          </NavLink>
        ))}
        <button
          type="button"
          aria-label="Más"
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-1 items-center justify-center py-3',
            isOverflowActive ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <MoreHorizontal className="size-5" />
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* pb-[env(safe-area-inset-bottom)]: same home-indicator overlap as
            the bottom nav below, on the "Más" overflow sheet. */}
        <SheetContent side="bottom" className="rounded-t-xl pb-[env(safe-area-inset-bottom)] md:hidden">
          <SheetHeader>
            <SheetTitle>Más</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-4 pb-4">
            {MOBILE_OVERFLOW_ITEMS.map((item) => (
              <SheetClose asChild key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              </SheetClose>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  )
}
