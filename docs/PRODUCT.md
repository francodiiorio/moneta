# PRODUCT.md

## Qué es Moneta

Una app de finanzas personales para una sola persona, que corre enteramente en su
dispositivo. Sirve para llevar un registro de en qué se gasta, cuánto entra a cada
cuenta, cuánto se ahorra/invierte, y si eso se mantiene dentro de lo presupuestado.
Desde la Etapa 8 vuelve a llevar cuentas e ingresos (y, en próximas fases,
transferencias y resúmenes de tarjeta), siempre como registros planos — sin partida
doble.

## Usuario objetivo

Una persona que quiere el rigor de una app de finanzas "seria" (multi-moneda,
presupuestos, cuotas) sin depender de un servicio en la nube, sin crear una cuenta, y sin
que sus datos financieros pasen por un servidor de un tercero. Cómodo con ARS y USD
simultáneamente (inflación, ahorro en dólares, gastos en ambas monedas es el caso de uso
típico en Argentina). Quiere entender en qué se le va la plata, cuánto tiene en cada
cuenta, y cómo evoluciona lo que ahorra e invierte.

## Casos de uso principales

- Registrar gastos del día a día, categorizados, cada uno en su propia moneda — con
  débito de una cuenta, o sin cuenta (tarjeta de crédito, efectivo no registrado).
- Registrar ingresos a una cuenta y seguir el saldo de cada cuenta, con ajustes para
  conciliar contra el banco.
- Cargar compras en cuotas y ver el cronograma de pagos futuros sin que contaminen el
  gasto del mes actual.
- Registrar gastos recurrentes (alquiler, suscripciones) que se generan solos mes a mes.
- Definir presupuestos por categoría y ver cuánto llevás gastado del mes.
- Llevar ahorros (plata quieta de monto declarado) e inversiones (activos, posiciones,
  precio) y ver el patrimonio — cuentas + ahorros + inversiones — consolidado en una
  moneda de referencia.
- Ver reportes: gasto por categoría, comparativa mensual, evolución de ahorros e
  inversiones.
- Importar un extracto bancario en CSV para cargar gastos en bloque, en vez de uno por
  uno.
- Exportar todo a un archivo y poder reconstruir el estado completo de la app en otro
  momento u otro dispositivo, manualmente.

## Principios de UX

- **Calma antes que densidad.** No es un dashboard corporativo lleno de tarjetas y
  colores. La información importante (gasto del mes, si estás sobre presupuesto) se
  entiende de un vistazo; el resto está a un clic.
- **Mobile y desktop son ciudadanos de primera clase**, no uno adaptado del otro.
- **Los números nunca mienten por redondeo.** Preferí mostrar "$1.050,50" siempre exacto
  antes que una UI más bonita que arriesgue precisión.
- **Cada gasto lleva su propia moneda.** Un gasto sin cuenta la elige al cargarlo; uno con
  débito toma la de su cuenta (una cuenta tiene una sola moneda).

## No-objetivos (por ahora)

- No es una app multi-usuario ni colaborativa.
- No lleva contabilidad de partida doble — cuentas, ingresos y (próximamente)
  transferencias son registros planos; ver ADR "Se reintroducen Cuentas, Ingresos y
  Transferencias" en `docs/DECISIONS.md`.
- No sincroniza con bancos ni importa extractos automáticamente (el import de CSV es
  manual, un archivo a la vez).
- No tiene autenticación — el dispositivo del usuario es el perímetro de seguridad.
- No hace scoring, recomendaciones de inversión ni asesoramiento financiero.
- No manda notificaciones push ni tiene ningún componente en la nube.
