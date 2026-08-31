import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney, isNegative, type Money } from '@/domain/money'

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
  //
  // A bucket total can be negative (e.g. Cuentas net of a credit-card-style
  // account with a negative balance). The bar length uses the magnitude —
  // otherwise a negative value pulls the XAxis domain below zero, which
  // shifts the zero-crossing away from the plot's left edge and renders
  // the bar (and its label) on top of the YAxis category text instead of
  // to its right. The label text still shows the real signed amount via
  // formatMoney — only the bar's length is ever unsigned.
  const data: ChartRow[] = [...rows]
    .reverse()
    .map((row) => ({ ...row, amountValue: Math.abs(row.amount.amount), amountLabel: formatMoney(row.amount) }))
  const height = Math.max(90, data.length * 44)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 68, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis
          type="category"
          dataKey="label"
          width={90}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
        />
        <Tooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltip />} />
        <Bar dataKey="amountValue" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((row) => (
            <Cell key={row.label} fill={isNegative(row.amount) ? 'var(--negative)' : 'var(--primary)'} />
          ))}
          <LabelList dataKey="amountLabel" position="right" fill="var(--foreground)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
