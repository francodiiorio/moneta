import { Link } from 'react-router'
import { ArrowRight, Coins, Lock, ShieldCheck, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

const PROMISES = [
  { icon: Lock, text: 'Sin cuentas ni contraseñas' },
  { icon: WifiOff, text: 'Tus datos no salen de este dispositivo' },
  { icon: Coins, text: 'Pesos y dólares, cada uno en su moneda' },
]

/** The home with nothing loaded yet: what Moneta is and the first step —
 *  an invitation, not a dashboard of zeros. */
export function WelcomeHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 sm:px-10 sm:py-10">
      {/* Decorative: a soft glow and concentric "coin" rings in the brand
          color, behind the copy. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-16 size-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 size-72 rounded-full bg-positive/10 blur-3xl" />
        <div className="absolute top-1/2 right-6 hidden -translate-y-1/2 sm:block">
          <div className="flex size-52 items-center justify-center rounded-full border border-primary/25">
            <div className="flex size-36 items-center justify-center rounded-full border border-primary/40 bg-primary/5">
              <div className="flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                <ShieldCheck className="size-9" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative max-w-xl">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">Bienvenido a Moneta</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Tu plata, en tus manos.</h2>
        <p className="mt-3 text-muted-foreground">
          Llevá tus cuentas, tarjetas, cuotas y ahorros en un solo lugar, sin entregarle tus datos a nadie. Todo se
          guarda en este dispositivo.
        </p>
        <ul className="mt-5 flex flex-col gap-2 text-sm">
          {PROMISES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              {text}
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link to="/cuentas">
              Crear mi primera cuenta
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link to="/ayuda">Cómo funciona</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
