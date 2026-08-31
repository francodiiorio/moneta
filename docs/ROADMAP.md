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

## Etapa 6 — Patrimonio (hecho)

- **6A — Modelo base + Ahorros + Resumen (hecho).** Entidades nuevas (`SavingsHolding`,
  `InvestmentAsset`, `InvestmentHolding`, `AssetPrice`) y campos opcionales sobre
  `ExchangeRate`/`Settings`, todo en `db.version(2)` de Dexie (primera versión aditiva del
  repo) y en `schemas/v2.ts` del backup, con su migración `v1_to_v2.ts`. `EUR` se suma a
  las monedas soportadas. `domain/networth/valuation.ts:valuateNetWorth` consolida
  Cuentas + Ahorros + Inversiones en la moneda de display elegida por el usuario
  (`Settings.displayCurrency`), sin tocar los importes guardados — misma política de
  "falta una tasa → se excluye y se cuenta" que Reportes
  (`MissingRateBanner`). `domain/currency/rates.ts:resolveRate` suma triangulación por
  USD como último recurso y preferencia por `profile` (referencia de dólar). Ruta
  `/patrimonio` con tabs Resumen/Ahorros, ítem nuevo en el nav principal — ver ADRs en
  `docs/DECISIONS.md`.
- **6B — Inversiones: activos, posiciones, precio manual (hecho).** Tab Inversiones en
  `/patrimonio`: diálogo para crear un `InvestmentAsset` (nombre, símbolo, tipo, moneda —
  siempre `priceMode: 'manual'`, "auto" no significa nada hasta que exista un proveedor
  en 6C), diálogo para crear/editar una posición (`InvestmentHolding`: activo, cantidad,
  costo promedio opcional) y un diálogo de carga manual de precio que inserta una fila
  nueva en `AssetPrice` (append-only, nunca reemplaza la anterior). Cada fila de la lista
  muestra cantidad, precio unitario, valor nativo (`quantity × precio`) y su equivalente
  en la moneda de display — `features/networth/service.ts:getInvestmentHoldingsWithDetails`
  reusa `domain/decimal:valuePosition` + `domain/currency:convert`, mismo orden de
  operaciones que `valuateNetWorth` (nunca un atajo activo→moneda-de-display). Borrar un
  activo con posiciones cargadas sigue bloqueado por el repository (Etapa 6A).
- **6C — Cotizaciones automáticas (hecho).** `src/features/quotes/providers/`:
  Frankfurter (EUR/USD), dolarapi.com (USD/ARS por referencia — oficial/blue/MEP/CCL/
  mayorista/cripto/tarjeta) y CoinGecko (sólo activos `crypto` con `priceMode: 'auto'` +
  `externalId`) — los tres gratis, sin API key, con CORS habilitado, verificados a mano
  antes de conectarlos. `refreshQuotes()` (`features/quotes/service.ts`) llama a los tres
  en paralelo, nunca tira, y nunca toca ni borra una cotización ya cargada — un proveedor
  caído simplemente no aporta nada esa vez. Refresh silencioso al abrir la app si
  `Settings.autoQuotesEnabled` (default **apagado**) y algo está vencido (>12h,
  `isStale`); botón "Actualizar ahora" siempre disponible. Tab Cotizaciones en
  `/patrimonio`: switch de actualización automática, selector de qué referencia de dólar
  usar para valuar (`Settings.rateProfile`), historial de tasas con fuente/antigüedad, y
  alta manual con `profile`. Absorbe por completo lo que era `/ajustes/tasas`
  (`features/exchangeRates/` se borró; la ruta vieja redirige) — ver ADRs en
  `docs/DECISIONS.md`.

Con 6C cerrada, el módulo de Patrimonio queda completo: Resumen, Ahorros, Inversiones y
Cotizaciones, todo en `/patrimonio`.

**Post-6C — Dashboard consolidado con Patrimonio.** La tarjeta "Patrimonio total" del
Dashboard usaba `features/reports/service.ts:getCurrentNetWorth` — una función de la
Etapa 3, anterior al módulo de Patrimonio, que sólo suma Cuentas. Mostraba un número
distinto al de `/patrimonio` (que sí suma Cuentas + Ahorros + Inversiones) bajo el mismo
nombre. El Dashboard ahora usa `features/networth/service.ts:getNetWorthSummary` — la
misma fuente que `/patrimonio` — así que los dos siempre coinciden.

**Cerrado después:** el gráfico "Evolución del patrimonio" de Reportes (últimos 6 meses)
ahora también suma Ahorros e Inversiones — revaluados con el precio/tasa vigente en cada
mes, pero con la cantidad/monto de **hoy** (`SavingsHolding`/`InvestmentHolding` no tienen
historial propio, a diferencia de `AssetPrice`/`ExchangeRate`). Ver ADR "Evolución del
patrimonio: cantidades de hoy, precios de cada mes" en `docs/DECISIONS.md` para el porqué
y el costo aceptado de esa aproximación.

## Backlog / no priorizado

- ~~Code-splitting por ruta~~ (hecho) — `src/app/router.tsx` usa `lazy` de React Router
  por ruta (`{ path, lazy: () => import(...).then(m => ({ Component: m.XPage })) }`) en
  vez de imports estáticos. Recharts (el salto más grande) queda aislado en el chunk de
  `ReportsPage` y sólo se descarga si el usuario visita `/reportes`. El chunk compartido
  (React, react-router, Dexie, react-hook-form, zod, date-fns — usados por casi toda
  ruta) bajó de ~1.2 MB a ~528 kB; seguir bajando eso requeriría separar esas libs por
  vendor o diferir react-hook-form/zod dentro de cada diálogo, que es más invasivo y no
  se justifica todavía para el volumen de uso de esta app.
  Costo aceptado: `RouterProvider` no pinta nada (ni el shell estático de `AppLayout`)
  hasta resolver el chunk lazy de la ruta inicial — antes invisible porque todo era un
  solo bundle. Se cubre con `HydrateFallback` (`src/app/RootFallback.tsx`, un spinner
  mínimo) en la ruta raíz, para que una carga directa/refresh en una URL profunda (ej.
  `/ajustes/categorias`) muestre algo en vez de pantalla en blanco.
- ~~Cifrado opcional del archivo `.finance` con passphrase~~ (hecho) —
  `src/features/backups/encryption.ts`, AES-256-GCM + PBKDF2-SHA256 vía `crypto.subtle`
  nativo (cero dependencias nuevas). Nunca por defecto, sin recuperación si se pierde la
  contraseña — ver ADR en `docs/DECISIONS.md`.
- ~~Modo *merge* en el import de backup~~ (hecho) — `mergeAllTables()` en
  `database/repositories/backup.repo.ts`, unión por ID, la base local siempre gana. Ver
  ADR en `docs/DECISIONS.md`.
- ~~Import de CSV/extractos bancarios~~ (hecho) — `src/features/csvImport/`, ruta
  `/movimientos/importar`. Parser `papaparse` (dependencia nueva — corre 100% local,
  autodetecta delimitador). Flujo de dos pasos: mapear columnas (fecha con formato
  explícito, descripción, monto en una columna con signo o débito/crédito separados) →
  vista previa con detección de duplicados (por fecha+monto+descripción contra lo ya
  cargado en esa cuenta, destildados por defecto) y filas inválidas marcadas y
  deshabilitadas. Todo-o-nada al confirmar (`transactions.repo.ts:bulkSaveTransactions`).
  Una sola categoría de gasto y una de ingreso para todo el lote — sin matching por texto
  en esta versión, ver ADR en `docs/DECISIONS.md`.
- Multi-dispositivo (fuera de alcance del proyecto tal como está planteado hoy — ver
  `docs/PRODUCT.md` "No-objetivos").
- ~~Informe mensual exportable~~ (hecho) — `/reportes/informe/:month`, una "foto" de un
  mes (cerrado o en curso): ingresos/gastos/balance, gasto por categoría, y patrimonio de
  ese mes si hay algo registrado. Exporta a PDF vía el diálogo de impresión nativo del
  navegador — cero dependencias nuevas. Ver ADR "Informe mensual: PDF vía el diálogo de
  impresión del navegador" en `docs/DECISIONS.md`.
