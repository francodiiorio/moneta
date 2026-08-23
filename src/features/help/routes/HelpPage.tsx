import {
  Wallet,
  ArrowLeftRight,
  Tag,
  PiggyBank,
  CalendarSync,
  Landmark,
  BarChart3,
  Upload,
  Save,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface GuideSection {
  icon: LucideIcon
  title: string
  steps: string[]
  link?: { to: string; label: string }
}

const SECTIONS: GuideSection[] = [
  {
    icon: Wallet,
    title: '1. Creá tus cuentas',
    steps: [
      'Andá a "Cuentas" y agregá cada cuenta real que quieras llevar: banco, efectivo, tarjeta, inversión.',
      'Elegí la moneda al crearla — es fija, no se puede cambiar después. Un movimiento de esa cuenta siempre va a estar en esa moneda.',
      'El saldo se calcula solo a partir de los movimientos que cargues; nunca se edita a mano.',
    ],
    link: { to: '/cuentas', label: 'Ir a Cuentas' },
  },
  {
    icon: ArrowLeftRight,
    title: '2. Cargá movimientos',
    steps: [
      'Desde "Movimientos" → "Nuevo movimiento", elegí ingreso, gasto o transferencia.',
      'Un ingreso o un gasto piden cuenta, categoría, monto y fecha.',
      'Una transferencia mueve dinero entre dos cuentas tuyas. Si son de distinta moneda, indicás el monto que sale de una y el que entra en la otra — la tasa de cambio se calcula sola.',
    ],
    link: { to: '/movimientos', label: 'Ir a Movimientos' },
  },
  {
    icon: Tag,
    title: '3. Organizá categorías',
    steps: [
      'En Ajustes → Categorías podés crear, editar y archivar categorías de gasto e ingreso, con hasta un nivel de subcategorías.',
      'También podés crear una categoría nueva al vuelo mientras estás cargando un movimiento.',
    ],
    link: { to: '/ajustes/categorias', label: 'Ir a Categorías' },
  },
  {
    icon: PiggyBank,
    title: '4. Definí presupuestos',
    steps: [
      'En "Presupuestos", asignale un monto mensual o anual a cada categoría que quieras controlar.',
      'La barra de progreso muestra cuánto llevás gastado del período: se pone amarilla cerca del 90% y roja si te pasaste.',
    ],
    link: { to: '/presupuestos', label: 'Ir a Presupuestos' },
  },
  {
    icon: CalendarSync,
    title: '5. Automatizá recurrentes y cuotas',
    steps: [
      'En "Planes" → pestaña Recurrentes, cargá un gasto o ingreso que se repite (alquiler, sueldo, suscripción) y se va a generar solo cada vez que abras la app.',
      'En la pestaña Cuotas, cargá una compra en cuotas una sola vez con el monto total y la cantidad — Moneta arma todo el cronograma. Las cuotas que todavía no vencieron aparecen como "Proyectado" en Movimientos y no afectan tu saldo actual hasta su fecha.',
    ],
    link: { to: '/planes', label: 'Ir a Planes' },
  },
  {
    icon: Landmark,
    title: '6. Registrá tu patrimonio (ahorros e inversiones)',
    steps: [
      'En "Patrimonio" → pestaña Ahorros, cargá plata que tenés guardada pero no pasa por movimientos — efectivo, una caja de ahorro que no conciliás.',
      'La pestaña Resumen consolida cuentas + ahorros + inversiones en la moneda que elijas (ARS, USD o EUR), sin modificar los importes originales.',
      'Si falta una tasa de cambio para convertir algo, ese ítem queda afuera del total y aparece un aviso — nunca se inventa una conversión.',
    ],
    link: { to: '/patrimonio', label: 'Ir a Patrimonio' },
  },
  {
    icon: BarChart3,
    title: '7. Mirá tus reportes',
    steps: [
      'El Dashboard resume el mes en curso: ingresos, gastos y balance neto, de un vistazo.',
      '"Reportes" tiene el detalle: gasto por categoría y la evolución de tu patrimonio total (todas las cuentas, convertidas a tu moneda base) en los últimos 6 meses.',
    ],
    link: { to: '/reportes', label: 'Ir a Reportes' },
  },
  {
    icon: Upload,
    title: '8. Importá un extracto bancario',
    steps: [
      'Desde "Movimientos" → "Importar CSV", subís el archivo y le indicás qué columna es cuál (fecha, descripción, monto) y una cuenta destino.',
      'Elegís una categoría para todos los gastos del lote y otra para todos los ingresos.',
      'Antes de confirmar, revisás una vista previa: los posibles duplicados y las filas que no se pudieron leer quedan destildados por defecto, así nunca se importa nada sin que lo veas primero.',
    ],
    link: { to: '/movimientos/importar', label: 'Ir a Importar CSV' },
  },
  {
    icon: Save,
    title: '9. Hacé backup de tus datos',
    steps: [
      'Todo vive únicamente en tu navegador — no hay ningún servidor. En Ajustes, "Exportar backup" genera un archivo .finance con todos tus datos: es tu única copia de seguridad real.',
      '"Importar backup" te deja reemplazar todo o fusionar con lo que ya tenés (si hay un conflicto, tus datos locales siempre ganan).',
      'Opcionalmente podés cifrar el backup con una contraseña. Si la olvidás, el archivo no se puede recuperar de ninguna forma.',
    ],
    link: { to: '/ajustes', label: 'Ir a Ajustes' },
  },
]

export function HelpPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cómo usar Moneta"
        description="Guía paso a paso de las funciones principales de la app."
      />

      <div className="flex flex-col gap-4">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  <section.icon className="size-4 text-muted-foreground" />
                </div>
                {section.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground marker:text-foreground/60">
                {section.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {section.link && (
                <Link to={section.link.to} className="w-fit text-sm font-medium text-primary hover:underline">
                  {section.link.label} →
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
