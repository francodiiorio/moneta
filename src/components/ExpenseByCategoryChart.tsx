import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { MoneyText } from '@/components/MoneyText'
import { formatMoney, sumMoney, type Money } from '@/domain/money'

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

// Fixed hue order, never cycled — validated for CVD-safety (see
// src/app/styles.css). A pie caps at MAX_PIE_SLICES real categories,
// folding the rest into "Otras categorías" (rendered in a neutral
// muted tone, never a 7th generated hue) — see PIE_COLORS' own length.
const PIE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
]
const MAX_PIE_SLICES = PIE_COLORS.length
const OTHER_SLICE_ID = '__other__'

function PieTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{formatMoney(item.amount)}</p>
      <p className="text-xs text-muted-foreground">{item.categoryName}</p>
    </div>
  )
}

function buildPieData(items: CategoryAmount[]): ChartRow[] {
  const visible = items.slice(0, MAX_PIE_SLICES)
  const rest = items.slice(MAX_PIE_SLICES)
  const rows: ChartRow[] = visible.map((item) => ({
    ...item,
    amountValue: item.amount.amount,
    amountLabel: formatMoney(item.amount),
  }))
  if (rest.length > 0) {
    // Every item here is already converted to the same display currency
    // by the caller (getExpenseByCategory/-InRange always returns Money
    // in baseCurrency) — safe to sum directly.
    const otherAmount = sumMoney(items[0]!.amount.currency, rest.map((r) => r.amount))
    rows.push({
      categoryId: OTHER_SLICE_ID,
      categoryName: 'Otras categorías',
      amount: otherAmount,
      amountValue: otherAmount.amount,
      amountLabel: formatMoney(otherAmount),
    })
  }
  return rows
}

interface PieSliceLabelProps {
  cx?: number
  cy?: number
  midAngle?: number
  outerRadius?: number
  percent?: number
}

// Label selectively, never a number on every slice — a sliver under 8%
// of the total has no room for a legible label anyway.
function renderPieSliceLabel({ cx, cy, midAngle, outerRadius, percent }: PieSliceLabelProps) {
  if (percent === undefined || percent < 0.08) return null
  if (cx === undefined || cy === undefined || midAngle === undefined || outerRadius === undefined) return null
  const radian = Math.PI / 180
  const radius = outerRadius + 14
  const x = cx + radius * Math.cos(-midAngle * radian)
  const y = cy + radius * Math.sin(-midAngle * radian)
  return (
    <text x={x} y={y} fill="var(--muted-foreground)" fontSize={12} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {Math.round(percent * 100)}%
    </text>
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

  const data = buildPieData(items)
  const total = sumMoney(items[0]!.amount.currency, items.map((i) => i.amount))

  return (
    <div className="pie-legend-wrap flex flex-col">
      {/* height=220 matches MoneyTrendChart's default (see
          DashboardPage's "Evolución de gastos" card) so the two cards
          come out the same height without relying on CSS Grid stretch —
          stretch would also re-propagate the pie legend's on-hover
          expansion onto its neighbor. */}
      <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 400, height: 220 }}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amountValue"
            nameKey="categoryName"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            stroke="var(--card)"
            strokeWidth={2}
            label={renderPieSliceLabel}
            labelLine={false}
            // The default sweep-in animation can get caught mid-transition
            // by a re-render right after mount (e.g. a sibling card's height
            // settling), showing a broken-looking partial slice — not worth
            // it for a static financial figure anyway.
            isAnimationActive={false}
          >
            {data.map((row, index) => (
              <Cell
                key={row.categoryId}
                fill={row.categoryId === OTHER_SLICE_ID ? 'var(--muted-foreground)' : PIE_COLORS[index] ?? 'var(--muted-foreground)'}
              />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* The dependable identity channel for 2+ series is never
          color-matching alone — but on a device with a mouse, the
          per-slice Tooltip above already gives that on hover, so the
          static list is redundant chrome there: the `.pie-legend`/
          `.pie-legend-wrap` rules in styles.css collapse it to zero
          height (not just invisible — a reserved-but-invisible legend
          would still leave this card taller than its "Evolución de
          gastos" neighbor on the Dashboard) until the pointer is over
          the donut. Touch devices have no hover at all, so this rule is
          itself gated on `(hover: hover)` and they keep the list always
          visible. Built in plain HTML (not Recharts' own Legend) so the
          label text stays in a text token, never the series hue. Capped
          height + scroll either way, so a month with many categories
          can't grow this list without bound. */}
      <ul className="pie-legend mt-3 flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1">
        {data.map((row, index) => (
          <li key={row.categoryId} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  row.categoryId === OTHER_SLICE_ID ? 'var(--muted-foreground)' : PIE_COLORS[index] ?? 'var(--muted-foreground)',
              }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.categoryName}</span>
            <MoneyText value={row.amount} className="shrink-0" />
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
              {Math.round((row.amount.amount / total.amount) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
