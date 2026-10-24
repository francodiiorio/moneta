import { useEffect } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MoneyText } from '@/components/MoneyText'
import type { Money } from '@/domain/money'
import { formatFullDate, formatMonthLabel, type MonthStamp } from '@/lib/dates'
import { useMonthlyReport } from '../hooks/useMonthlyReport'
import type { ReportCategoryRow } from '../service'

interface MonthlyReportDocumentProps {
  month: MonthStamp
}

function NetWorthColumn({
  label,
  total,
  byBucket,
}: {
  label: string
  total: Money
  byBucket: { accounts: Money; savings: Money; investments: Money }
}) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">
        <MoneyText value={total} />
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Cuentas</dt>
          <dd className="mt-0.5">
            <MoneyText value={byBucket.accounts} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Ahorros</dt>
          <dd className="mt-0.5">
            <MoneyText value={byBucket.savings} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Inversiones</dt>
          <dd className="mt-0.5">
            <MoneyText value={byBucket.investments} />
          </dd>
        </div>
      </dl>
    </div>
  )
}

const UNCONVERTED = 'No se pudieron convertir por falta de tasa de cambio.'

const percent = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 1 })

interface CategoryTableProps {
  title: string
  rows: ReportCategoryRow[]
  total: Money
  /** Shown instead of the table when `rows` is empty. */
  empty: string
}

function CategoryTable({ title, rows, total, empty }: CategoryTableProps) {
  return (
    <section className="mb-6 print:break-inside-avoid">
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left text-xs text-neutral-500">
              <th className="py-1.5 font-normal">Categoría</th>
              <th className="py-1.5 text-right font-normal">%</th>
              <th className="py-1.5 text-right font-normal">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {rows.map((row) => (
              <tr key={row.categoryId}>
                <td className="py-1.5">{row.categoryName}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500">{percent.format(row.share)}</td>
                <td className="py-1.5 text-right">
                  <MoneyText value={row.amount} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-300 font-medium">
              <td className="py-1.5">Total</td>
              <td className="py-1.5" />
              <td className="py-1.5 text-right">
                <MoneyText value={total} />
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}

/** A printable "photo" of one month — ingresos, gastos and balance (each
 *  by category) and
 *  (when there's anything to value) a net worth snapshot. Exported as
 *  a PDF via the browser's own print dialog (see docs/DECISIONS.md
 *  "Informe mensual").
 *
 *  Deliberately uses literal colors (bg-white, text-neutral-*), never the
 *  app's semantic theme tokens (bg-background, text-foreground): those
 *  follow the active light/dark theme, and in dark mode `body` renders
 *  near-white text — browsers drop backgrounds when printing unless the
 *  user opts in, so a themed report would print near-white text on white
 *  paper. This document is always a plain light document, like a
 *  statement, independent of the app's theme. */
export function MonthlyReportDocument({ month }: MonthlyReportDocumentProps) {
  const report = useMonthlyReport(month)

  // The default filename/header when the user picks "Guardar como PDF".
  useEffect(() => {
    const previous = document.title
    document.title = `Moneta — Informe ${formatMonthLabel(month)}`
    return () => {
      document.title = previous
    }
  }, [month])

  if (report === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-white">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  const isEmpty =
    report.summary.expense.amount === 0 &&
    report.summary.income.amount === 0 &&
    report.summary.missingRateCount === 0 &&
    report.netWorth === undefined

  // coverageEnd is clamped to "today" (report.generatedOn) whenever the
  // month hasn't ended yet — true for the current month, and also for any
  // month entirely in the future (which never has its own transactions,
  // so it degrades to the same "up to today" wording rather than a
  // confusing "up to a date before this month even starts").
  const isCoverageClampedToToday = report.coverageEnd === report.generatedOn
  const statusLine = report.isCurrentMonth
    ? `Mes en curso — incluye movimientos hasta el ${formatFullDate(report.coverageEnd)}.`
    : isCoverageClampedToToday
      ? `Mes futuro — sin movimientos hasta el ${formatFullDate(report.coverageEnd)}.`
      : 'Mes cerrado.'

  return (
    <div className="min-h-svh bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-8 py-10 print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
          <Button asChild variant="ghost" size="sm">
            <Link to="/reportes">
              <ArrowLeft className="size-4" />
              Volver
            </Link>
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            Imprimir / Guardar como PDF
          </Button>
        </div>

        <header className="mb-6 border-b border-neutral-300 pb-4 print:break-inside-avoid">
          <p className="text-xs tracking-wide text-neutral-500 uppercase">Moneta · Informe mensual</p>
          <h1 className="mt-1 text-2xl font-semibold">{formatMonthLabel(report.month)}</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Generado el {formatFullDate(report.generatedOn)} · Montos en {report.baseCurrency}
          </p>
          <p className="text-sm text-neutral-500">{statusLine}</p>
        </header>

        {isEmpty ? (
          // Skip the (all-zero) summary grid and category section entirely
          // — showing them alongside this line would stack three redundant
          // "nothing here" signals on one printed page.
          <p className="text-sm text-neutral-600">No hay nada registrado en este mes.</p>
        ) : (
          <>
            <section className="mb-6 print:break-inside-avoid">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 print:grid-cols-3">
                <div>
                  <p className="text-xs text-neutral-500">Ingresos</p>
                  <p className="mt-1 text-lg font-semibold">
                    <MoneyText value={report.summary.income} />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Gastos</p>
                  <p className="mt-1 text-lg font-semibold">
                    <MoneyText value={report.summary.expense} />
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Balance neto</p>
                  <p className="mt-1 text-lg font-semibold">
                    <MoneyText value={report.summary.net} />
                  </p>
                  {report.summary.missingRateCount > 0 && (
                    <p className="mt-0.5 text-xs text-neutral-500">Parcial: faltan tasas de cambio.</p>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                Balance neto = ingresos − gastos del mes (gastos con tarjeta en el mes de la compra).
                Transferencias, pagos de resumen y compras de inversión no son gasto ni ingreso.
              </p>
            </section>

            <CategoryTable
              title="Ingreso por categoría"
              rows={report.incomeCategories}
              total={report.summary.income}
              empty={
                report.summary.income.amount === 0 &&
                report.summary.missingRateCount > report.summary.expenseMissingRateCount
                  ? UNCONVERTED
                  : 'Sin ingresos registrados en este mes.'
              }
            />
            <CategoryTable
              title="Gasto por categoría"
              rows={report.expenseCategories}
              total={report.summary.expense}
              empty={
                report.summary.expense.amount === 0 && report.summary.expenseMissingRateCount > 0
                  ? UNCONVERTED
                  : 'Sin gastos registrados en este mes.'
              }
            />
          </>
        )}

        {report.netWorth && (
          <section className="mb-6 print:break-inside-avoid">
            <h2 className="mb-2 text-sm font-semibold text-neutral-700">
              Patrimonio al {formatFullDate(report.netWorth.asOfDate)}
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <NetWorthColumn label="En pesos" total={report.netWorth.ars.total} byBucket={report.netWorth.ars.byBucket} />
              <NetWorthColumn label="En dólares" total={report.netWorth.usd.total} byBucket={report.netWorth.usd.byBucket} />
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Cuentas: saldo real a esa fecha. Ahorros e inversiones: cantidad actual, valuada al
              precio y tipo de cambio de esa fecha.
            </p>
          </section>
        )}

        {(report.missingRateCount > 0 || (report.netWorth?.missingPriceCount ?? 0) > 0) && (
          <section className="mb-6 text-xs text-neutral-500 print:break-inside-avoid">
            {report.missingRateCount > 0 && (
              <p>
                No se{' '}
                {report.missingRateCount === 1
                  ? 'pudo convertir 1 monto'
                  : `pudieron convertir ${report.missingRateCount} montos`}{' '}
                por falta de tasa de cambio.
              </p>
            )}
            {(report.netWorth?.missingPriceCount ?? 0) > 0 && (
              <p>
                No se{' '}
                {report.netWorth?.missingPriceCount === 1
                  ? 'pudo valuar 1 posición'
                  : `pudieron valuar ${report.netWorth?.missingPriceCount} posiciones`}{' '}
                por falta de precio cargado.
              </p>
            )}
          </section>
        )}

        <footer className="border-t border-neutral-300 pt-4 text-xs text-neutral-500">
          Moneta · Informe generado localmente en este dispositivo. Los datos nunca salieron de acá.
        </footer>
      </div>
    </div>
  )
}
