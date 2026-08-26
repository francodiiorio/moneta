import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'

interface MissingPriceBannerProps {
  count: number
}

/** Distinct from MissingRateBanner: an investment position with no price
 *  loaded at all can't be valued regardless of currency conversion — see
 *  domain/networth/valuation.ts's `missingPriceCount`. */
export function MissingPriceBanner({ count }: MissingPriceBannerProps) {
  if (count === 0) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {count === 1
          ? 'No se pudo valuar 1 posición por falta de precio cargado.'
          : `No se pudieron valuar ${count} posiciones por falta de precio cargado.`}{' '}
        <Link to="/patrimonio" className="underline underline-offset-2 hover:text-foreground">
          Cargar un precio
        </Link>
        .
      </p>
    </div>
  )
}
