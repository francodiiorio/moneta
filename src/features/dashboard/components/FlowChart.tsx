import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatAxisAmount, formatMoney } from '@/domain/money'
import { formatMonthLabel, formatMonthShort } from '@/lib/dates'
import type { MonthFlowPoint } from '@/features/reports/service'

interface FlowChartProps {
  points: MonthFlowPoint[]
}

interface ChartRow {
  point: MonthFlowPoint
  monthLabel: string
  income: number
  expense: number
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  const { point } = row
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{formatMonthLabel(point.month)}</p>
      <p className="flex justify-between gap-4">
        <span className="text-muted-foreground">Ingresos</span>
        <span className="font-mono text-positive">{formatMoney(point.income)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted-foreground">Gastos</span>
        <span className="font-mono">{formatMoney(point.expense)}</span>
      </p>
      <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1">
        <span className="text-muted-foreground">Balance{point.partial ? ' (parcial)' : ''}</span>
        <span className={point.net.amount < 0 ? 'font-mono text-negative' : 'font-mono text-positive'}>
          {formatMoney(point.net)}
        </span>
      </p>
    </div>
  )
}

/** Ingresos against gastos, month by month — the Dashboard's main chart.
 *  Bars, not lines: each month is its own ledger, not a continuous
 *  quantity. The values plotted are minor units, only for bar heights;
 *  every figure shown goes through formatMoney. Fills its container's
 *  height (at least 240px), so it lines up with the category card beside
 *  it whatever that one's legend length. */
export function FlowChart({ points }: FlowChartProps) {
  const data: ChartRow[] = points.map((point) => ({
    point,
    monthLabel: formatMonthShort(point.month),
    income: point.income.amount,
    expense: point.expense.amount,
  }))
  const currency = points[0]?.expense.currency ?? 'ARS'

  return (
    <div className="flex flex-1 flex-col">
      <div className="min-h-60 flex-1">
        <ResponsiveContainer width="100%" height="100%" minHeight={240}>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={72}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickFormatter={(value: number) => formatAxisAmount(value, currency)}
          />
          <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<FlowTooltip />} />
          {/* No grow-in animation: the chart resizes to its row right after
              mount, which restarts it and can leave the bars caught at zero
              (same reason as CategoryBreakdownChart's donut). */}
          <Bar dataKey="income" fill="var(--positive)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="expense" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-positive" />
          Ingresos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" />
          Gastos
        </span>
      </div>
    </div>
  )
}
