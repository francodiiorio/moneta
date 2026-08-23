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

## Etapa 1 — Movimientos (transacciones)

El objetivo es validar el modelo de partida doble en uso real, no sólo en tests.

- Alta de ingreso, gasto y transferencia (misma moneda y cross-currency) sobre el ledger,
  usando los builders existentes de `domain/ledger`.
- Lista de movimientos con filtros por mes, cuenta y categoría.
- Edición y borrado (en cascada: transacción + sus postings) de una transacción.
- Carga de tasas de cambio manuales (`ExchangeRate`) para poder hacer transferencias
  cross-currency.

## Etapa 2 — Categorías

- CRUD de categorías con jerarquía de un nivel.
- Seed inicial de categorías comunes en español (comida, transporte, sueldo, etc.),
  editable/borrable por el usuario.

## Etapa 3 — Dashboard y Reportes

- Resumen del mes actual: ingresos, gastos, balance neto.
- Gasto por categoría (gráfico, Recharts).
- Evolución del patrimonio total, consolidado a la moneda base usando `ExchangeRate`.

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

- Code-splitting por ruta (el bundle actual es ~715 KB porque todavía no hay rutas
  lazy — no urgente hasta que el peso real de features futuras lo justifique).
- Cifrado opcional del archivo `.finance` con passphrase (WebCrypto AES-GCM).
- Modo *merge* en el import de backup (hoy sólo hace *replace* completo).
- Import de CSV/extractos bancarios.
- Adjuntar comprobantes (imágenes) como Blobs en IndexedDB.
- Multi-dispositivo (fuera de alcance del proyecto tal como está planteado hoy — ver
  `docs/PRODUCT.md` "No-objetivos").
