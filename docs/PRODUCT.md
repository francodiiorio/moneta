# PRODUCT.md

## Qué es Moneta

Una app de finanzas personales para una sola persona, que corre enteramente en su
dispositivo. Sirve para llevar un registro completo y entender la propia situación
financiera: cuánto entra, cuánto sale, en qué se gasta, cómo evoluciona el patrimonio a lo
largo del tiempo.

## Usuario objetivo

Una persona que quiere el rigor de una app de finanzas "seria" (partida doble, multi-
moneda, presupuestos, cuotas) sin depender de un servicio en la nube, sin crear una
cuenta, y sin que sus datos bancarios pasen por un servidor de un tercero. Cómodo con
ARS y USD simultáneamente (inflación, ahorro en dólares, gastos en ambas monedas es el
caso de uso típico en Argentina).

## Casos de uso principales

- Registrar ingresos y gastos del día a día, categorizados.
- Llevar varias cuentas (banco, efectivo, tarjetas, inversiones) y ver el saldo real de
  cada una.
- Transferir entre cuentas, incluyendo conversión de moneda (ARS ↔ USD) con la tasa del
  día.
- Cargar compras en cuotas y ver el cronograma de pagos futuros sin que contaminen el
  saldo actual.
- Registrar gastos recurrentes (alquiler, suscripciones) que se generan solos mes a mes.
- Definir presupuestos por categoría y ver cuánto llevás gastado del mes.
- Ver reportes: gasto por categoría, comparativa mensual, evolución del patrimonio total
  (todas las cuentas, consolidadas a una moneda base).
- Exportar todo a un archivo y poder reconstruir el estado completo de la app en otro
  momento u otro dispositivo, manualmente.

## Principios de UX

- **Calma antes que densidad.** No es un dashboard corporativo lleno de tarjetas y
  colores. La información importante (saldo, si estás sobre presupuesto) se entiende de
  un vistazo; el resto está a un clic.
- **Mobile y desktop son ciudadanos de primera clase**, no uno adaptado del otro.
- **Los números nunca mienten por redondeo.** Preferí mostrar "$1.050,50" siempre exacto
  antes que una UI más bonita que arriesgue precisión.
- **La cuenta es la única variable de moneda.** El usuario no elige "en qué moneda cargar
  este gasto" cada vez — lo define una vez al crear la cuenta.

## No-objetivos (por ahora)

- No es una app multi-usuario ni colaborativa.
- No sincroniza con bancos ni importa extractos automáticamente.
- No tiene autenticación — el dispositivo del usuario es el perímetro de seguridad.
- No hace scoring, recomendaciones de inversión ni asesoramiento financiero.
- No manda notificaciones push ni tiene ningún componente en la nube.
