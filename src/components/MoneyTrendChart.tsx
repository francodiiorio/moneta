import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Money } from '@/domain/money'
import { formatMonthShort, type MonthStamp } from '@/lib/dates'

export interface MoneyTrendPoint {
  month: MonthStamp
  value: Money
}

interface MoneyTrendChartProps {
  points: MoneyTrendPoint[]
  height?: number
  emptyMessage?: string
}

interface ChartRow extends MoneyTrendPoint {
  amountValue: number
  monthLabel: string
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{formatMoney(point.value)}</p>
      <p className="text-xs text-muted-foreground">{point.monthLabel}</p>
    </div>
  )
}

/** Generic single-series time-series area chart — same visual language as
 *  features/reports/components/NetWorthChart.tsx (gradient fill, dotted
 *  line, tooltip), generalized so both the Dashboard and Ahorro e
 *  Inversiones can plot their own `Money` series without a feature
 *  reaching into another feature's components/ (see CLAUDE.md's layering
 *  table — components/ is the shared, cross-feature layer). */
export function MoneyTrendChart({ points, height = 220, emptyMessage = 'Sin datos suficientes todavía.' }: MoneyTrendChartProps) {
  const gradientId = useId()

  if (points.every((p) => p.value.amount === 0)) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">{emptyMessage}</div>
    )
  }

  const data: ChartRow[] = points.map((p) => ({
    ...p,
    amountValue: p.value.amount,
    monthLabel: formatMonthShort(p.month),
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="monthLabel"
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
        />
        {/* Always include zero in the visible range — an axis that starts at
            dataMin exaggerates small changes into what looks like a swing
            from empty to full. */}
        <YAxis hide domain={[(dataMin: number) => Math.min(0, dataMin), 'dataMax']} />
        <Tooltip cursor={{ stroke: 'var(--border)' }} content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="amountValue"
          stroke="var(--primary)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 2, stroke: 'var(--card)' }}
          activeDot={{ r: 5, fill: 'var(--primary)', strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
