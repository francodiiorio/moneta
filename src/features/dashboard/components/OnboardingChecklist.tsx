import { Link } from 'react-router'
import { CheckCircle2, ChevronRight, Circle, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/cn'
import type { OnboardingStep, OnboardingStepId } from '../service'

const STEP_COPY: Record<OnboardingStepId, { title: string; description: string; to: string }> = {
  account: { title: 'Creá una cuenta', description: 'Tu banco o tu efectivo, con el saldo de hoy.', to: '/cuentas' },
  card: { title: 'Agregá tu tarjeta', description: 'Con sus días de cierre y vencimiento.', to: '/tarjetas' },
  expense: { title: 'Cargá tu primer gasto', description: 'A mano, o importando el extracto del banco.', to: '/movimientos' },
  income: { title: 'Registrá un ingreso', description: 'Tu sueldo o lo que entre a una cuenta.', to: '/movimientos' },
  budget: { title: 'Armá un presupuesto', description: 'Un tope por categoría para el mes.', to: '/presupuestos' },
}

interface OnboardingChecklistProps {
  steps: OnboardingStep[]
  /** Compact once there's data: one row, the next step only. */
  compact?: boolean
  onHide?: () => void
}

export function OnboardingChecklist({ steps, compact = false, onHide }: OnboardingChecklistProps) {
  const done = steps.filter((s) => s.done).length
  const percent = Math.round((done / steps.length) * 100)
  const next = steps.find((s) => !s.done)

  const progressBar = (
    <div
      role="progressbar"
      aria-label="Primeros pasos"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={done}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${percent}%` }} />
    </div>
  )

  if (compact) {
    if (!next) return null
    const copy = STEP_COPY[next.id]
    return (
      <Card className="flex-row items-center gap-4 px-4 py-3">
        <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="text-muted-foreground">
              Primeros pasos · {done} de {steps.length} ·{' '}
            </span>
            <Link to={copy.to} className="font-medium text-primary hover:underline">
              {copy.title}
            </Link>
          </p>
          <div className="mt-2 max-w-sm">{progressBar}</div>
        </div>
        {onHide && (
          <Button variant="ghost" size="icon" aria-label="Ocultar primeros pasos" onClick={onHide}>
            <X className="size-4" />
          </Button>
        )}
      </Card>
    )
  }

  return (
    <Card className="gap-4 py-5">
      <div className="flex items-end justify-between gap-3 px-5">
        <div>
          <h2 className="font-semibold">Primeros pasos</h2>
          <p className="text-sm text-muted-foreground">Cinco pasos y Moneta empieza a trabajar para vos.</p>
        </div>
        <span className="shrink-0 text-sm font-medium text-primary">
          {done} de {steps.length}
        </span>
      </div>
      <div className="px-5">{progressBar}</div>
      <ol className="flex flex-col px-2">
        {steps.map((step) => {
          const copy = STEP_COPY[step.id]
          return (
            <li key={step.id}>
              <Link
                to={copy.to}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60',
                  step.done && 'opacity-60',
                )}
              >
                {step.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-positive" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm font-medium', step.done && 'line-through')}>
                    {copy.title}
                    <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{copy.description}</span>
                </span>
                {!step.done && (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
