import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, type Money } from '@/domain/money'

interface DistributionRow {
  label: string
  amount: Money
}

interface NetWorthDistributionProps {
  accounts: Money
  savings: Money
  investments: Money
}

interface ChartRow extends DistributionRow {
  amountValue: number
  amountLabel: string
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{formatMoney(item.amount)}</p>
      <p className="text-xs text-muted-foreground">{item.label}</p>
    </div>
  )
}

export function NetWorthDistribution({ accounts, savings, investments }: NetWorthDistributionProps) {
  const rows: DistributionRow[] = [
    { label: 'Cuentas', amount: accounts },
    { label: 'Ahorros', amount: savings },
    { label: 'Inversiones', amount: investments },
  ].filter((row) => row.amount.amount !== 0)

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Todavía no hay nada para mostrar.
      </div>
    )
  }

  // Read top-to-bottom in the order defined above; Recharts renders
  // vertical-layout categories bottom-to-top, so the data is reversed.
  const data: ChartRow[] = [...rows]
    .reverse()
    .map((row) => ({ ...row, amountValue: row.amount.amount, amountLabel: formatMoney(row.amount) }))
  const height = Math.max(90, data.length * 44)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={90}
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
