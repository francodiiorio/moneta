import { Link } from 'react-router'
import { CreditCard, FileUp, PiggyBank, type LucideIcon } from 'lucide-react'

const FEATURES: { icon: LucideIcon; title: string; text: string; to: string }[] = [
  {
    icon: CreditCard,
    title: 'Tarjetas sin sorpresas',
    text: 'Cuándo cierra cada resumen, cuánto vas a pagar y desde qué cuenta.',
    to: '/tarjetas',
  },
  {
    icon: FileUp,
    title: 'Importá tu extracto',
    text: 'Subí el CSV del banco o de la tarjeta y conciliá contra el saldo real.',
    to: '/movimientos/importar',
  },
  {
    icon: PiggyBank,
    title: 'Ahorro e inversiones',
    text: 'Tu patrimonio en pesos y en dólares, mes a mes.',
    to: '/patrimonio',
  },
]

export function FeatureHighlights() {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
      {FEATURES.map(({ icon: Icon, title, text, to }) => (
        <Link
          key={title}
          to={to}
          className="group flex gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="size-4" />
          </span>
          <span>
            <span className="block text-sm font-medium">{title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
