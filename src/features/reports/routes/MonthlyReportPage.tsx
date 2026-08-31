import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { isValidMonthStamp } from '@/lib/dates'
import { MonthlyReportDocument } from '../components/MonthlyReportDocument'

/** Validates the :month route param before rendering the document — keeps
 *  useMonthlyReport (a useLiveQuery call) unconditional in the document
 *  component, since hooks can't run conditionally. */
export function MonthlyReportPage() {
  const { month } = useParams<{ month: string }>()

  if (month === undefined || !isValidMonthStamp(month)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="text-lg font-semibold">Mes inválido</h1>
        <p className="text-sm text-muted-foreground">
          El enlace del informe no es válido. Elegí un mes en Reportes.
        </p>
        <Button asChild variant="outline">
          <Link to="/reportes">Volver a Reportes</Link>
        </Button>
      </div>
    )
  }

  return <MonthlyReportDocument month={month} />
}
