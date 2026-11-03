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
      'Desde "Movimientos" → "Nuevo movimiento", elegí Gasto o Ingreso e indicá la descripción, el monto y la categoría. Moneta no lleva saldos de cuentas: un gasto es lo que compraste, no de dónde salió la plata — salvo que sea con tarjeta.',
      'Cargá tu sueldo y lo que te entre como ingresos: el Inicio los compara con lo que gastás en el mes.',
      'En "Tarjetas" cargá cada tarjeta con su día de cierre y de vencimiento. Al cargar un gasto, elegila en "Tarjeta": entra sola en el resumen que corresponde según la fecha (o elegí otro, si el comercio lo presentó tarde). Como el banco mueve el cierre de un mes a otro, el resumen en curso te pide las fechas reales, y al pagar un resumen cargás las del próximo. Cuando pagás un resumen cerrado, registralo con "Pagar": cargás lo que pagaste de cada moneda y queda pagado, sin crear un gasto nuevo — las compras ya se contaron.',
      'Podés crear una categoría nueva al vuelo mientras estás cargando un movimiento.',
      'Carga rápida: debajo de "Descripción" aparecen los comercios que más cargaste en los últimos meses. Tocás uno y se completan la categoría, la tarjeta y la moneda de la última vez: sólo te queda el monto.',
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
    title: '4. Automatizá gastos fijos y cuotas',
    steps: [
      'En "Presupuesto" → pestaña Fijos, cargá lo que se repite: tu sueldo ("Nuevo ingreso fijo") y los gastos fijos (alquiler, prepaga, suscripción). Se anotan solos cada vez que abras la app. Si un gasto fijo se paga con tarjeta, elegila en "Tarjeta".',
      'En "Tarjetas" → pestaña Cuotas, cargá una compra en cuotas una sola vez con el monto total y la cantidad — Moneta arma todo el cronograma. Si la hiciste con tarjeta, elegila: cada cuota cae en un resumen, empezando por el de la compra. Las cuotas que todavía no vencieron aparecen como "Por pagar" en Movimientos.',
    ],
    link: { to: '/presupuestos?tab=fijos', label: 'Ir a Fijos' },
  },
  {
    icon: Landmark,
    title: '5. Registrá tus ahorros e inversiones',
    steps: [
      'En "Patrimonio" → pestaña Ahorros, cargá lo que tenés ahorrado — efectivo guardado, un plazo fijo, una cuenta de ahorro en pesos o en dólares — y actualizalo cuando cambie.',
      'En la pestaña Inversiones, primero creá el activo (ej. SPY, un CEDEAR, Bitcoin) y después una posición con la cantidad que tenés. Una compra de inversión no cuenta como gasto. Cargá el precio a mano con "Cargar precio" — cada carga queda en el historial, nunca pisa la anterior. Para cripto, podés activar "Actualizar precio automáticamente" con el id de CoinGecko.',
      'En la pestaña Cotizaciones elegís qué referencia de dólar usar para valuar (oficial, blue, MEP, CCL, etc.) y podés prender la actualización automática — trae el dólar y el euro solos cada tanto, o los actualizás vos con "Actualizar ahora". Apagada por defecto: sin activarla, la app no consulta nada por internet.',
      'La pestaña Resumen consolida ahorros + inversiones en la moneda que elijas (ARS, USD o EUR), sin modificar los importes originales.',
      'Si falta una tasa de cambio o un precio para convertir algo, ese ítem queda afuera del total y aparece un aviso — nunca se inventa una conversión.',
    ],
    link: { to: '/patrimonio', label: 'Ir a Patrimonio' },
  },
  {
    icon: BarChart3,
    title: '6. Mirá tus reportes',
    steps: [
      'Inicio resume el mes en curso: gastos y patrimonio, de un vistazo.',
      '"Reportes" (arriba a la derecha en el celular, abajo en la barra lateral en la compu) tiene el detalle: gasto por categoría y la evolución de tu patrimonio (ahorros e inversiones, convertidos a tu moneda base) en los últimos 6 meses.',
    ],
    link: { to: '/reportes', label: 'Ir a Reportes' },
  },
  {
    icon: Upload,
    title: '7. Importá el resumen de tu tarjeta',
    steps: [
      'En "Tarjetas" → "Importar resumen", subí el PDF del resumen que te manda el banco (por ahora, Visa y Mastercard de BBVA). Se lee en tu dispositivo: el archivo no sale de él.',
      'Moneta elige sola la tarjeta (por el número de cuenta que tenga en sus notas, o la única de esa marca) y te muestra todo antes de guardar: los consumos, las compras en cuotas (se crean desde la cuota que factura el banco), los impuestos y cargos, y lo que ya tenías cargado, que no se vuelve a importar.',
      'Un crédito y el cargo que anula (un reintegro, una percepción devuelta) se cancelan entre sí. Arriba ves si el total coincide con el del banco.',
      'La categoría de cada comercio sale de cómo lo categorizaste la última vez: si cambiás una, la próxima importación la respeta. También guarda las fechas reales del resumen y las del próximo.',
    ],
    link: { to: '/tarjetas/importar', label: 'Importar un resumen' },
  },
  {
    icon: Upload,
    title: '8. Importá un extracto bancario (CSV)',
    steps: [
      'Es una opción avanzada: activá "Opciones avanzadas" en Ajustes. Desde "Movimientos" → "Importar CSV", subís el archivo, elegís si es de una tarjeta o no y le indicás qué columna es cuál (fecha, descripción, monto), la moneda y una categoría.',
      'Sólo se importan gastos: los créditos (plata que entró) quedan afuera. De una tarjeta, los gastos entran en sus resúmenes; si es el CSV del resumen del banco, elegí ese resumen y entran todos ahí.',
      'En un resumen de tarjeta cerrado, "Conciliar con el banco" compara con el total del banco y registra lo que el banco cobró de más (impuestos, intereses, comisiones) como gasto de ese resumen.',
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
