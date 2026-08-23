# ROADMAP.md

## Etapa 0 — Base del proyecto (hecho)

- Scaffold Vite + React + TS estricto, Tailwind v4, shadcn/ui, PWA.
- Documentación (`CLAUDE.md`, `docs/`) y configuración de Claude Code (`.claude/`).
- Dominio: `money`, `currency`, `ledger` (builders + invariantes + balance), con tests.
- Persistencia: schema Dexie v1, repository de cuentas, repository de settings.
- Backups: export/import versionado (v1), con round-trip testeado y validación de
  invariantes del ledger antes de escribir.
- Vertical slice completo: **Cuentas** (crear, editar, archivar, ver balance en vivo) +
  **Ajustes** (moneda base, tema, export/import de backup).
- Shell de la app: layout responsive (sidebar desktop / bottom nav mobile), routing,
  tema claro/oscuro.

## Etapa 1 — Movimientos (transacciones) (hecho)

El objetivo era validar el modelo de partida doble en uso real, no sólo en tests —
cumplido: balances verificados a mano en el navegador, incluyendo una transferencia
cross-currency (ARS → USD).

- Alta de ingreso, gasto y transferencia (misma moneda y cross-currency) sobre el ledger,
  usando los builders existentes de `domain/ledger`.
- Lista de movimientos agrupada por fecha, con filtros por mes, cuenta y categoría.
- Edición (reemplaza los postings, conserva `id`/`createdAt`) y borrado en cascada.
- Selector de categoría con creación inline ("+ Nueva categoría") — el CRUD completo de
  categorías queda para la Etapa 2.
- La transferencia cross-currency pide directamente "monto que sale" y "monto que
  entra"; `fx.rate` se deriva de esos dos montos. La gestión de `ExchangeRate` (tasas
  guardadas por fecha) se difiere a la Etapa 3, que es donde se necesita para consolidar
  el patrimonio a una moneda base.

## Etapa 2 — Categorías (hecho)

- CRUD completo con jerarquía de un nivel, archivar (bloqueado si tiene hijas activas),
  reordenar con flechas ↑/↓ entre hermanas.
- Seed inicial de categorías comunes en español (comida, transporte, sueldo, etc.),
  editable/borrable por el usuario — corre una sola vez, automáticamente, si la tabla
  está vacía.
- Gestión en `/ajustes/categorias`, sin agregar un ítem nuevo al nav principal.

## Etapa 3 — Dashboard y Reportes (hecho)

- Resumen del mes actual: ingresos, gastos, balance neto (Dashboard, mes fijo; Reportes,
  con selector de mes).
- Gasto por categoría (gráfico de barras horizontal, Recharts, un solo hue tomado de
  `--primary` — ver la skill `dataviz`).
- Evolución del patrimonio: últimos 6 meses fijos, un punto por fin de mes (y "hoy" para
  el mes en curso), usando `accounts.repo.ts:listAccountsWithBalances(asOfDate)` +
  `domain/currency/rates.ts:convert()`.
- Todo consolidado a `Settings.baseCurrency`; si falta una tasa para convertir algo
  puntual, ese ítem se excluye del total y se muestra un aviso con el conteo
  (`MissingRateBanner`) en vez de fallar en silencio.
- Gestión de `ExchangeRate` en `/ajustes/tasas` (crear/listar/borrar) — le da uso real a
  `resolveRate`/`convert`, construidos en la Etapa 0 pero sin consumidor hasta ahora.

## Etapa 4 — Presupuestos (hecho)

- CRUD de `Budget` por categoría y período (mensual/anual), siempre en la moneda base.
  Editar crea una versión nueva (`startsOn` posterior) en vez de mutar el monto — se
  resuelve la vigente por categoría+período con `domain/budgets/progress.ts:
  resolveActiveBudget` (el `startsOn` más reciente `<=` el mes evaluado). Un presupuesto
  anual siempre se compara contra el año calendario en curso, sin importar qué mes esté
  navegando la página.
- Progreso del mes/año vs. presupuestado en `/presupuestos`, con barra de color por
  umbral (normal / ≥90% / excedido), y como indicador silencioso en el Dashboard
  (aparece sólo si algún presupuesto está en ≥90%, hasta 3).
- `features/reports/service.ts` expone `getExpenseByCategoryInRange(start, end)` (antes
  sólo por mes) para que Presupuestos reutilice el mismo cálculo de gasto consolidado sin
  duplicarlo, tanto para el rango mensual como el anual.

## Etapa 5 — Recurrentes y cuotas (hecho)

- `RecurringPlan`: regla (`domain/recurrence/occurrences.ts:generateOccurrences`, cada
  ocurrencia calculada desde el ancla `startDate + i*interval`, nunca acumulando sobre la
  anterior — evita que un `dayOfMonth: 31` derive al 28 después de febrero) + plantilla de
  transacción. Se materializa automáticamente al abrir la app (`App.tsx`, después de
  `seedDefaultsIfEmpty()`), con un toast de resumen; correr la materialización dos veces
  no duplica nada porque `lastMaterializedDate` avanza en la misma transacción Dexie que
  las escrituras (`recurringPlans.repo.ts:materializePlan`).
- `InstallmentPlan`: cronograma vía `domain/installments/schedule.ts` (`allocate()` para
  los montos, mismas fechas-desde-el-ancla para los vencimientos). Las N cuotas se
  escriben de una sola vez al crear el plan — las vencidas como `confirmed`, el resto como
  `projected` — y cada cuota pasa a `confirmed` sola al llegar su fecha
  (`transactions.repo.ts:confirmDueProjected`, corrida en cada `materializeDue`). Como
  `projected` ya estaba excluido de balances y reportes desde la Etapa 0/3, la deuda futura
  se puede ver sin ensuciar ningún total.
  Movimientos marca estas transacciones con una badge "Proyectado".
- Borrar un plan nunca borra plata que ya pasó: un `RecurringPlan` borrado deja intactas
  sus transacciones materializadas; un `InstallmentPlan` borrado borra sólo sus cuotas
  todavía `projected` — ver ADR en `docs/DECISIONS.md`.
- Ruta `/planes` con tabs Recurrentes/Cuotas, ítem nuevo en el nav principal.

## Backlog / no priorizado

- Code-splitting por ruta (el bundle actual es ~1.2 MB — Recharts es el salto más
  grande desde que Reportes lo usa de verdad — porque todavía no hay rutas lazy; esto ya
  amerita revisarlo antes de sumar más peso en etapas futuras).
- Cifrado opcional del archivo `.finance` con passphrase (WebCrypto AES-GCM).
- Modo *merge* en el import de backup (hoy sólo hace *replace* completo).
- Import de CSV/extractos bancarios.
- Adjuntar comprobantes (imágenes) como Blobs en IndexedDB.
- Multi-dispositivo (fuera de alcance del proyecto tal como está planteado hoy — ver
  `docs/PRODUCT.md` "No-objetivos").
