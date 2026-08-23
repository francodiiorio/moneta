import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'

interface MissingRateBannerProps {
  count: number
  /** What the excluded items are, for the message — singular/plural pair.
   *  Defaults to "movimiento"/"movimientos o cuentas" (Dashboard/Reportes/
   *  Presupuestos); Patrimonio passes its own since the excluded item
   *  there can be an ahorro or una inversión, not sólo un movimiento. */
  itemLabel?: [singular: string, plural: string]
}

const DEFAULT_ITEM_LABEL: [string, string] = ['movimiento o cuenta', 'movimientos o cuentas']

export function MissingRateBanner({ count, itemLabel = DEFAULT_ITEM_LABEL }: MissingRateBannerProps) {
  if (count === 0) return null

  const [singular, plural] = itemLabel

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {count === 1
          ? `No se pudo convertir 1 ${singular} por falta de tasa de cambio.`
          : `No se pudieron convertir ${count} ${plural} por falta de tasa de cambio.`}{' '}
        <Link to="/ajustes/tasas" className="underline underline-offset-2 hover:text-foreground">
          Cargar una tasa
        </Link>
        .
      </p>
    </div>
  )
}
