import { Link } from 'react-router'
import { Wallet } from 'lucide-react'
import { MoneyText } from '@/components/MoneyText'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { negate, type Money } from '@/domain/money'
import { currentMonthStamp, formatMonthLabel, formatShortDate, type MonthStamp } from '@/lib/dates'
import { cn } from '@/lib/cn'
import type { MonthLeft } from '../service'

interface MonthLeftHeroProps {
  month: MonthStamp
  data: MonthLeft | undefined
}

/** The home's one number: what's left of the month once the fixed gastos,
 *  the cards due and everything else go out. */
export function MonthLeftHero({ month, data }: MonthLeftHeroProps) {
  const monthName = formatMonthLabel(month).toLowerCase()
  const past = month < currentMonthStamp()

  if (data === undefined) return <div className="h-48 animate-pulse rounded-2xl bg-muted" />

  const negative = data.left.amount < 0
  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-sm font-normal text-muted-foreground">
          {negative ? (past ? `Te faltó en ${monthName}` : `Te falta en ${monthName}`) : past ? `Te quedó en ${monthName}` : `Te quedan en ${monthName}`}
        </h2>
        <MoneyText
          value={negative ? negate(data.left) : data.left}
          className={cn('text-3xl font-semibold tracking-tight break-all sm:text-4xl', negative ? 'text-negative' : 'text-positive')}
        />
      </div>

      {data.missingRateCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Parcial: faltan tasas de cambio para{' '}
          {data.missingRateCount === 1 ? '1 monto, que no está sumado' : `${data.missingRateCount} montos, que no están sumados`}.
        </p>
      )}

      {!data.hasIncome && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Cargá tu sueldo</span> para saber cuánto te queda de verdad: hoy no
            hay ningún ingreso este mes.
          </p>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/presupuestos?tab=fijos">
              <Wallet className="size-4" />
              Cargar mi sueldo
            </Link>
          </Button>
        </div>
      )}

      <dl className="grid gap-2 text-sm">
        <Line label="Ingresos" value={data.income} sign="+" />
        <Line label="Gastos fijos" value={data.fixed} sign="−" />
        <Line
          label="Tarjetas que vencen"
          value={data.cards}
          sign="−"
          detail={data.cardItems.map((card) => (
            <span key={`${card.cardId}:${card.dueDate}`} className="block">
              {card.cardName} · vence el {formatShortDate(card.dueDate)} ·{' '}
              {card.missingRate ? 'falta la tasa de cambio' : <MoneyText value={card.amount} />}
            </span>
          ))}
        />
        <Line label="Otros gastos (sin tarjeta)" value={data.other} sign="−" />
      </dl>
    </Card>
  )
}

interface LineProps {
  label: string
  value: Money
  sign: '+' | '−'
  /** Below the line, e.g. each card statement. */
  detail?: React.ReactNode
}

/** One `dt` with its `dd`s directly inside the row's div, as a `dl` needs. */
function Line({ label, value, sign, detail }: LineProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">
        {sign} <MoneyText value={value} />
      </dd>
      {detail && <dd className="col-span-2 mt-0.5 text-xs text-muted-foreground">{detail}</dd>}
    </div>
  )
}
