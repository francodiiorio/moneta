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

## Etapa 4 — Presupuestos

- CRUD de `Budget` por categoría y período.
- Progreso del mes actual vs. presupuestado, en la página de Presupuestos y como
  indicador en el Dashboard.

## Etapa 5 — Recurrentes y cuotas

Depende de que Movimientos esté sólido, porque ambos terminan generando `Transaction`s
reales vía `sourcePlanId`.

- `RecurringPlan`: crear la regla, materializar automáticamente al abrir la app si
  corresponde (o mediante una acción explícita — a decidir en esa etapa).
- `InstallmentPlan`: cargar una compra en N cuotas, generar el cronograma con
  `allocate()`, materializar cada cuota en su fecha.

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
