# ARCHITECTURE.md

## Vista general

```
UI (React)  →  service.ts (feature)  →  domain/  (cálculo puro)
                       ↓
              database/repositories/  →  Dexie  →  IndexedDB
```

- **`domain/`** no sabe que existe una base de datos ni un navegador. Recibe datos,
  devuelve datos o tira una excepción. Es donde vive toda la lógica financiera:
  aritmética de dinero, valuación de patrimonio, resolución de tasas de cambio.
- **`database/`** es el único código que importa `dexie` o toca `IndexedDB` directamente.
  Expone repositories (`expenses.repo.ts`, etc.) con funciones async que devuelven
  entidades tipadas. Un repository puede llamar a `domain/` (por ejemplo, para calcular un
  reparto de cuotas) pero nunca al revés.
- **`features/`** conecta las dos capas de arriba con React. `service.ts` orquesta
  (parsea un formulario, llama al dominio para calcular, llama al repository para
  persistir); `hooks/` usa `useLiveQuery` para suscribirse a los datos; `store.ts` (si
  existe) es Zustand para estado que no persiste (qué diálogo está abierto).
- **`components/`** son piezas de UI reusables entre features (`MoneyText`, `PageHeader`,
  `EmptyState`) más `components/ui/`, que son los primitivos de shadcn/ui vendoreados
  (código generado, tratalo como tal — ver CLAUDE.md sobre `as` en esos archivos).

## Por qué Zustand no es una caché de datos

Zustand gestiona *estado de sesión de UI*: qué diálogo está abierto, qué mes está
seleccionado en un filtro, si un dropdown está abierto. **Nunca** guarda una copia de
gastos ni ninguna entidad persistida — esa responsabilidad es
exclusivamente de `useLiveQuery` (dexie-react-hooks), que se re-ejecuta automáticamente
cuando algo cambia en IndexedDB. Si Zustand empezara a cachear datos persistidos, se
abriría la puerta a que la UI muestre algo distinto de lo que realmente hay en la base —
exactamente el tipo de bug que este proyecto no se puede permitir.

## Flujo de una escritura (ej. crear un gasto)

1. El formulario (`features/transactions/components/TransactionFormDialog.tsx`) valida
   con Zod y llama a `service.ts`.
2. `service.ts:saveExpense` parsea el monto (`domain/money:parseAmount`) y arma el input
   del repository directo — no hay builder ni partida doble que construir, un gasto es
   un registro plano (fecha, monto, moneda, categoría, descripción).
3. `service.ts` llama al repository (`expenses.repo.ts:saveExpense`), que valida
   `amount > 0` **antes** de escribir. Si falla, no se escribe nada.
4. El repository persiste el gasto con un `put()` (asignando id y timestamps en creación;
   conservándolos en edición) dentro de una transacción Dexie.
5. Cualquier componente con un `useLiveQuery` sobre gastos se re-renderiza solo, sin que
   nadie tenga que invalidar nada manualmente.

## Estrategia de backup

IndexedDB es la fuente de verdad **durante el uso normal**. El archivo `.finance` es un
**snapshot puntual**, no una sincronización continua — se genera cuando el usuario pide
"Exportar" y se aplica cuando pide "Importar". No hay proceso en background que lo
mantenga actualizado.

- **Exportar**: lee todas las tablas (`database/repositories/backup.repo.ts`), arma un
  objeto versionado (`features/backups/schemas/v1.ts`), calcula un checksum SHA-256 y lo
  descarga como `moneta-YYYY-MM-DD.finance` (JSON).
- **Importar**: parsea el JSON, migra a la versión de schema más reciente si hace falta
  (`features/backups/migrations/`), valida con Zod, corre `validateLedgerIntegrity()`
  (monto positivo + categoría no vacía) sobre **todos** los gastos del archivo, y sólo si
  todo pasa reemplaza el contenido de IndexedDB en una única transacción atómica. Antes
  de reemplazar, la UI descarga
  automáticamente un backup de seguridad del estado actual — ver
  `features/backups/components/BackupCard.tsx`.
- El checksum se verifica pero no bloquea el import si no coincide (podría ser un archivo
  editado a mano legítimamente) — sólo se le avisa al usuario.

Ver `docs/DATA_MODEL.md` para el formato exacto y las reglas de versionado.

## PWA

`vite-plugin-pwa` en modo `generateSW` con `registerType: 'autoUpdate'`. El service
worker sólo precachea el app shell (JS/CSS/HTML/íconos) — **no** hay runtime caching de
red. Esto la hace instalable y usable offline por diseño, no como feature aparte.

La única red que la app hace es opt-in: cotizaciones automáticas
(`src/features/quotes/providers/`, `Settings.autoQuotesEnabled`, default `false` — ver
"Privacidad" en `CLAUDE.md` y el ADR en `docs/DECISIONS.md`). No pasa por el service
worker en absoluto — sin conexión, un fetch de cotización simplemente falla (capturado,
nunca se propaga) y la app sigue funcionando con la última cotización válida en
IndexedDB. Offline sigue siendo el caso normal, no uno que haya que manejar aparte.

## Testing por capa

- `domain/`: Vitest puro, sin DOM, sin IndexedDB.
- `database/repositories/`: Vitest + `fake-indexeddb` (ver `src/test/setup.ts`).
- `features/*/components`: Vitest + `@testing-library/react` + `happy-dom` para
  componentes puntuales; Playwright (`e2e/`) para flujos completos en un navegador real.
