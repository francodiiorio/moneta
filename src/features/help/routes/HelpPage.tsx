import {
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
    icon: ArrowLeftRight,
    title: '1. Cargá gastos e ingresos',
    steps: [
      'En "Cuentas" creá tus cuentas (banco, efectivo, billetera virtual) con su moneda y el saldo que tenían a una fecha. Desde ahí, Moneta calcula el saldo solo.',
      'Desde "Movimientos" → "Nuevo movimiento", elegí Gasto o Ingreso e indicá la descripción, el monto, la categoría y la cuenta. Un ingreso siempre entra a una cuenta; un gasto con débito sale de una, y uno con tarjeta de crédito se carga sin cuenta.',
      'Para pasar plata entre tus cuentas (o comprar dólares), usá "Nuevo movimiento" → Transferencia. No cuenta como gasto ni ingreso: sólo mueve saldos. Si las cuentas son de distinta moneda, cargá lo que salió y lo que entró, y Moneta te muestra la cotización que te hicieron.',
      'En "Tarjetas" cargá cada tarjeta con su día de cierre y de vencimiento. Al cargar un gasto, elegila en "Medio de pago": entra sola en el resumen que corresponde según la fecha (o elegí otro, si el comercio lo presentó tarde). Si un mes el banco mueve las fechas, corregilas en ese resumen y los gastos se reacomodan. Cuando pagás un resumen cerrado, registralo con "Pagar": elegís de qué cuenta sale cada moneda (si pagás dólares con pesos, cargás cuánto te debitaron) y baja el saldo de la cuenta sin crear un gasto nuevo — las compras ya se contaron.',
      'Si el saldo no coincide con el del banco, usá "Ajustar saldo" en la cuenta: se guarda la diferencia como un ajuste visible en Movimientos, sin tocar nada de lo cargado.',
      'Podés crear una categoría nueva al vuelo mientras estás cargando un movimiento.',
    ],
    link: { to: '/movimientos', label: 'Ir a Movimientos' },
  },
  {
    icon: Tag,
    title: '2. Organizá categorías',
    steps: [
      'En Ajustes → Categorías podés crear, editar y archivar categorías, con hasta un nivel de subcategorías.',
    ],
    link: { to: '/ajustes/categorias', label: 'Ir a Categorías' },
  },
  {
    icon: PiggyBank,
    title: '3. Definí presupuestos',
    steps: [
      'En "Presupuestos", asignale un monto mensual o anual a cada categoría que quieras controlar.',
      'La barra de progreso muestra cuánto llevás gastado del período: se pone amarilla cerca del 90% y roja si te pasaste.',
    ],
    link: { to: '/presupuestos', label: 'Ir a Presupuestos' },
  },
  {
    icon: CalendarSync,
    title: '4. Automatizá recurrentes y cuotas',
    steps: [
      'En "Planes" → pestaña Recurrentes, cargá un gasto que se repite (alquiler, suscripción) y se va a generar solo cada vez que abras la app. Si se debita de una cuenta o se paga con tarjeta, elegilo en "Medio de pago".',
      'En la pestaña Cuotas, cargá una compra en cuotas una sola vez con el monto total y la cantidad — Moneta arma todo el cronograma. Si la hiciste con tarjeta, elegila: cada cuota cae en un resumen, empezando por el de la compra. Las cuotas que todavía no vencieron aparecen como "Proyectado" en Movimientos.',
    ],
    link: { to: '/planes', label: 'Ir a Planes' },
  },
  {
    icon: Landmark,
    title: '5. Registrá tus ahorros e inversiones',
    steps: [
      'En "Patrimonio" → pestaña Ahorros, cargá plata quieta que no tiene movimientos — efectivo guardado, un plazo fijo. Si algo tiene movimientos seguido, mejor crealo como cuenta (no lo cargues en los dos lados).',
      'En la pestaña Inversiones, primero creá el activo (ej. SPY, un CEDEAR, Bitcoin) y después una posición con la cantidad que tenés. Si la compra salió de una de tus cuentas, elegila en "Cuenta de origen" y cargá lo que se debitó (comisiones incluidas): baja el saldo de la cuenta sin contar como gasto. Si ya habías reflejado ese débito a mano (un ajuste o un gasto), no le agregues la cuenta: se descontaría dos veces. Cargá el precio a mano con "Cargar precio" — cada carga queda en el historial, nunca pisa la anterior. Para cripto, podés activar "Actualizar precio automáticamente" con el id de CoinGecko.',
      'En la pestaña Cotizaciones elegís qué referencia de dólar usar para valuar (oficial, blue, MEP, CCL, etc.) y podés prender la actualización automática — trae el dólar y el euro solos cada tanto, o los actualizás vos con "Actualizar ahora". Apagada por defecto: sin activarla, la app no consulta nada por internet.',
      'La pestaña Resumen consolida cuentas + ahorros + inversiones en la moneda que elijas (ARS, USD o EUR), sin modificar los importes originales.',
      'Si falta una tasa de cambio o un precio para convertir algo, ese ítem queda afuera del total y aparece un aviso — nunca se inventa una conversión.',
    ],
    link: { to: '/patrimonio', label: 'Ir a Patrimonio' },
  },
  {
    icon: BarChart3,
    title: '6. Mirá tus reportes',
    steps: [
      'El Dashboard resume el mes en curso: gastos y patrimonio, de un vistazo.',
      '"Reportes" tiene el detalle: gasto por categoría y la evolución de tu patrimonio (cuentas, ahorros e inversiones, convertidos a tu moneda base) en los últimos 6 meses.',
    ],
    link: { to: '/reportes', label: 'Ir a Reportes' },
  },
  {
    icon: Upload,
    title: '7. Importá un extracto bancario',
    steps: [
      'Desde "Movimientos" → "Importar CSV", subís el archivo y le indicás qué columna es cuál (fecha, descripción, monto), la moneda y una categoría.',
      'Sólo se importan gastos: si el extracto trae también ingresos (columna de crédito, o un monto positivo), esas filas quedan marcadas como "no se importa" y no se pueden seleccionar.',
      'Antes de confirmar, revisás una vista previa: los posibles duplicados y las filas que no se pudieron leer quedan destildados por defecto, así nunca se importa nada sin que lo veas primero.',
    ],
    link: { to: '/movimientos/importar', label: 'Ir a Importar CSV' },
  },
  {
    icon: Save,
    title: '8. Hacé backup de tus datos',
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
    <div className="flex flex-col gap-4">
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
