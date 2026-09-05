# PRODUCT.md

## Qué es Moneta

Una app de finanzas personales para una sola persona, que corre enteramente en su
dispositivo. Sirve para llevar un registro de en qué se gasta, cuánto se ahorra/invierte,
y si eso se mantiene dentro de lo presupuestado — sin la carga de llevar cuentas,
ingresos ni transferencias.

## Usuario objetivo

Una persona que quiere el rigor de una app de finanzas "seria" (multi-moneda,
presupuestos, cuotas) sin depender de un servicio en la nube, sin crear una cuenta, y sin
que sus datos financieros pasen por un servidor de un tercero. Cómodo con ARS y USD
simultáneamente (inflación, ahorro en dólares, gastos en ambas monedas es el caso de uso
típico en Argentina). No necesita ni quiere llevar el detalle de sus cuentas bancarias
día a día — sólo entender en qué se le va la plata y cómo evoluciona lo que ahorra e
invierte.

## Casos de uso principales

- Registrar gastos del día a día, categorizados, cada uno en su propia moneda.
- Cargar compras en cuotas y ver el cronograma de pagos futuros sin que contaminen el
  gasto del mes actual.
- Registrar gastos recurrentes (alquiler, suscripciones) que se generan solos mes a mes.
- Definir presupuestos por categoría y ver cuánto llevás gastado del mes.
- Llevar ahorros (efectivo, cajas de ahorro) e inversiones (activos, posiciones, precio) y
  ver su valor consolidado en una moneda de referencia.
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
- **Cada gasto lleva su propia moneda.** No hay una cuenta que la fije de antemano — se
  elige al cargarlo, igual que ya se elige la fecha o la categoría.

## No-objetivos (por ahora)

- No es una app multi-usuario ni colaborativa.
- No trackea ingresos, cuentas ni transferencias entre cuentas — decisión deliberada del
  usuario, no una limitación técnica (ver ADR "Simplificación: se elimina Cuentas,
  Ingresos y Transferencias" en `docs/DECISIONS.md`).
- No sincroniza con bancos ni importa extractos automáticamente (el import de CSV es
  manual, un archivo a la vez).
- No tiene autenticación — el dispositivo del usuario es el perímetro de seguridad.
- No hace scoring, recomendaciones de inversión ni asesoramiento financiero.
- No manda notificaciones push ni tiene ningún componente en la nube.
