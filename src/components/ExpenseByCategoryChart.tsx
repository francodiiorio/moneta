import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Money } from '@/domain/money'

export interface CategoryAmount {
  categoryId: string
  categoryName: string
  amount: Money
}

interface ExpenseByCategoryChartProps {
  items: CategoryAmount[]
}

interface ChartRow extends CategoryAmount {
  amountValue: number
  amountLabel: string
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{formatMoney(item.amount)}</p>
      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
    </div>
  )
}

export function ExpenseByCategoryChart({ items }: ExpenseByCategoryChartProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin gastos este mes.
      </div>
    )
  }

  // The chart should read top-to-bottom as highest spend first; Recharts
  // renders vertical-layout categories bottom-to-top, so the data is reversed.
  const data: ChartRow[] = [...items]
    .reverse()
    .map((item) => ({ ...item, amountValue: item.amount.amount, amountLabel: formatMoney(item.amount) }))
  const height = Math.max(120, data.length * 44)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="categoryName"
          width={110}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
        />
        <Tooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltip />} />
        <Bar dataKey="amountValue" fill="var(--primary)" radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="amountLabel" position="right" fill="var(--foreground)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
