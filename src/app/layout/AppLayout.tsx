import { NavLink, Outlet } from 'react-router'
import { NAV_ITEMS, SECONDARY_NAV_ITEMS, type NavItem } from '../nav-items'
import { cn } from '@/lib/cn'

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      <item.icon className="size-4" />
      {item.label}
    </NavLink>
  )
}

export function AppLayout() {
  return (
    // pt-[env(safe-area-inset-top)]: installed as a PWA (standalone display
    // mode), iOS renders the status bar as a translucent overlay instead of
    // reserving its own space — without this, page content starts under
    // the status bar/notch instead of below it. Needs viewport-fit=cover
    // in index.html or env() resolves to 0 (also a no-op on any device
    // without a notch/status-bar overlay, e.g. desktop or a plain browser
    // tab).
    <div className="flex min-h-svh bg-background pt-[env(safe-area-inset-top)]">
      {/* Sticky at full height: Reportes/Ajustes stay at the bottom of the
          screen, not of a long page. */}
      <aside className="sticky top-0 hidden h-svh w-56 shrink-0 flex-col overflow-y-auto border-r border-border px-2.5 py-5 md:flex">
        <div className="mb-5 flex items-center gap-2 px-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-xs font-bold">M</span>
          </div>
          <span className="text-sm font-semibold tracking-tight">Moneta</span>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Secciones">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <nav className="mt-auto flex flex-col gap-1 border-t border-border pt-3" aria-label="Reportes y ajustes">
          {SECONDARY_NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: the bottom nav holds the five sections; Reportes and
            Ajustes live up here. */}
        <header className="flex items-center justify-between px-4 pt-2 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-[10px] font-bold">M</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">Moneta</span>
          </div>
          <nav className="flex items-center gap-1" aria-label="Reportes y ajustes">
            {SECONDARY_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    'flex size-11 items-center justify-center rounded-lg transition-colors',
                    isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
                  )
                }
              >
                <item.icon className="size-4.5" />
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 md:pt-5 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* pb-[env(safe-area-inset-bottom)]: on an iPhone with a home
          indicator, running as an installed PWA (standalone display mode)
          puts this nav flush against the bottom edge — without this, the
          icons render underneath/behind the indicator instead of above it.
          Needs index.html's viewport-fit=cover or env() resolves to 0. */}
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            aria-label={item.label}
            className={({ isActive }) =>
              cn('flex flex-1 items-center justify-center py-3', isActive ? 'text-primary' : 'text-muted-foreground')
            }
          >
            <item.icon className="size-5" />
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
