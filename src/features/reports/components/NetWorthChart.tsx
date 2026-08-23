import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '@/domain/money'
import { formatMonthShort } from '@/lib/dates'
import type { NetWorthPoint } from '../service'

interface NetWorthChartProps {
  points: NetWorthPoint[]
}

interface ChartRow extends NetWorthPoint {
  netWorthValue: number
  monthLabel: string
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{formatMoney(point.netWorth)}</p>
      <p className="text-xs text-muted-foreground">{point.monthLabel}</p>
    </div>
  )
}

export function NetWorthChart({ points }: NetWorthChartProps) {
  if (points.every((p) => p.netWorth.amount === 0)) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin datos suficientes todavía.
      </div>
    )
  }

  const data: ChartRow[] = points.map((p) => ({
    ...p,
    netWorthValue: p.netWorth.amount,
    monthLabel: formatMonthShort(p.month),
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
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
          dataKey="netWorthValue"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#netWorthFill)"
          dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 2, stroke: 'var(--card)' }}
          activeDot={{ r: 5, fill: 'var(--primary)', strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
