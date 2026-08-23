import { Loader2 } from 'lucide-react'

/**
 * Shown while the router resolves the initial route's lazy chunk — e.g. a
 * direct load or refresh on a deep URL like /ajustes/categorias. Without
 * this, RouterProvider renders nothing at all (not even AppLayout's static
 * nav shell) until that chunk finishes fetching, since route matching
 * requires every matched route — including lazy leaves — to be ready
 * before the first paint.
 */
export function RootFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}
