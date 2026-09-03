import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { roundHalfUp } from '@/domain/money'

export interface InvestmentGainLossItem {
  label: string
  gainLossPercent: number
}

interface InvestmentGainLossChartProps {
  items: InvestmentGainLossItem[]
}

interface ChartRow extends InvestmentGainLossItem {
  magnitude: number
  percentLabel: string
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{item.percentLabel}</p>
      <p className="text-xs text-muted-foreground">{item.label}</p>
    </div>
  )
}

function formatPercent(value: number): string {
  const rounded = roundHalfUp(value)
  return `${rounded >= 0 ? '+' : ''}${rounded}%`
}

/** Ganancia/pérdida no realizada por posición, en porcentaje — no en
 *  monto: `gainLoss`/`costBasis` viven en la moneda propia del activo
 *  (no en la moneda de visualización, ver InvestmentHoldingWithDetails
 *  en ../service.ts), así que comparar montos entre posiciones en
 *  distinta moneda no sería correcto sin convertir cada una primero.
 *  `gainLossPercent` ya es adimensional y comparable tal cual.
 *
 *  Mismo esqueleto que NetWorthDistribution.tsx (barra horizontal,
 *  magnitud siempre ≥ 0, color por signo, label a la derecha) en vez de
 *  una barra divergente centrada en cero — Recharts no dibuja ni la
 *  barra ni su label cuando el valor es exactamente 0 (confirmado a
 *  mano, incluso mezclado con otras posiciones que sí tienen un valor
 *  real), así que una posición en 0% se descarta antes de graficar en
 *  vez de dejar una fila con la categoría a la izquierda y nada al
 *  lado. Para que esa posición no desaparezca sin dejar rastro, un
 *  texto debajo del gráfico avisa cuántas quedaron afuera por esta
 *  razón — a diferencia de NetWorthDistribution, acá cada fila es una
 *  posición con plata real invertida, no un bucket agregado que en $0
 *  literalmente no tiene nada que mostrar. */
export function InvestmentGainLossChart({ items }: InvestmentGainLossChartProps) {
  const rows = items.filter((item) => item.gainLossPercent !== 0)
  const hiddenCount = items.length - rows.length

  if (items.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Todavía no hay posiciones con precio y costo cargados para comparar.
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Todas tus posiciones están sin cambios (0%).
      </div>
    )
  }

  // Read top-to-bottom in the order received; Recharts renders
  // vertical-layout categories bottom-to-top, so the data is reversed.
  const data: ChartRow[] = [...rows]
    .reverse()
    .map((row) => ({ ...row, magnitude: Math.abs(row.gainLossPercent), percentLabel: formatPercent(row.gainLossPercent) }))
  const height = Math.max(90, data.length * 44)

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }}>
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
          <Bar dataKey="magnitude" radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((row) => (
              <Cell key={row.label} fill={row.gainLossPercent < 0 ? 'var(--negative)' : 'var(--positive)'} />
            ))}
            <LabelList dataKey="percentLabel" position="right" fill="var(--foreground)" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hiddenCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {hiddenCount === 1
            ? '1 posición sin cambios (0%) no se muestra acá.'
            : `${hiddenCount} posiciones sin cambios (0%) no se muestran acá.`}
        </p>
      )}
    </div>
  )
}
