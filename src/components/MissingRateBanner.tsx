import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'

interface MissingRateBannerProps {
  count: number
}

export function MissingRateBanner({ count }: MissingRateBannerProps) {
  if (count === 0) return null

  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {count === 1
          ? 'No se pudo convertir 1 movimiento o cuenta por falta de tasa de cambio.'
          : `No se pudieron convertir ${count} movimientos o cuentas por falta de tasa de cambio.`}{' '}
        <Link to="/ajustes/tasas" className="underline underline-offset-2 hover:text-foreground">
          Cargar una tasa
        </Link>
        .
      </p>
    </div>
  )
}
