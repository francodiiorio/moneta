# DECISIONS.md

ADRs cortos. Cada entrada: qué se decidió, por qué, qué se descartó.

## Ledger de partida doble ligera en vez de transacciones tipadas simples

**Decisión:** toda transacción es una lista de `Posting`s con signo que suman cero, en vez
de un registro con `type: 'income'|'expense'|'transfer'` + `accountId` + `amount` +
`toAccountId?`.

**Por qué:** con transacciones tipadas, una transferencia (y peor, una transferencia
cross-currency) es un caso especial en cada cálculo de balance, cada reporte y cada
validación. Con postings, "balance de una cuenta" es siempre la misma query
(`sum(postings where accountId = X)`) sin importar si el movimiento fue un gasto, un
ingreso o una transferencia.

**Costo aceptado:** los formularios tienen que traducir la intención del usuario ("gasté
$X en Y") a postings — por eso existen los builders (`buildExpense`, `buildIncome`,
`buildTransfer`, `buildFxTransfer`) en `domain/ledger`, para que ese mapeo se escriba una
sola vez.

## Enteros en unidades menores, nunca float

**Decisión:** todo importe es un entero (centavos), tipado como `Minor` (branded type).

**Por qué:** es el estándar de cualquier sistema financiero serio — el punto flotante
binario no puede representar exactamente la mayoría de los valores decimales
(`0.1 + 0.2 !== 0.3` en JS), lo que eventualmente produce diferencias de un centavo que
son muy difíciles de rastrear. Un branded type hace que sea un error de compilación pasar
un `number` crudo donde se espera un `Minor`.

## Reparto por resto mayor (`allocate`) para cuotas y splits

**Decisión:** dividir un total entre N partes usa el método del resto mayor: se calculan
los pisos de cada parte proporcional y el resto se reparte de a una unidad a las partes
con mayor resto fraccionario.

**Por qué:** es el único método simple que garantiza `sum(partes) === total` siempre. Redondear
cada parte por separado (ej. `Math.round(total/n)` repetido) puede perder o inventar una
unidad menor cuando `total` no es múltiplo de `n`.

## Recurrentes y cuotas como planes + instancias materializadas

**Decisión:** un `RecurringPlan`/`InstallmentPlan` no es una transacción; genera
`Transaction`s reales (con `sourcePlanId`) cuando corresponde, en vez de que los reportes
calculen las ocurrencias al vuelo cada vez.

**Por qué:** permite editar o marcar como pagada una ocurrencia puntual sin inventar un
sistema de excepciones sobre una regla recurrente, y mantiene el historial inmutable — si
se cambia la regla de un plan a futuro, las transacciones ya materializadas no se
recalculan retroactivamente.

**Costo aceptado:** más filas en la base que un modelo "todo virtual". Aceptable para el
volumen de datos de un usuario único.

## Cuenta con moneda fija + tasas manuales, no conversión automática

**Decisión:** cada `Account` tiene una `currency` fija; las tasas de cambio
(`ExchangeRate`) las carga el usuario a mano, con fecha. No hay integración con ninguna
API de cotizaciones.

**Por qué:** privacidad (cero requests de red, ver `CLAUDE.md`) y simplicidad — el usuario
en Argentina ya sabe qué tasa usó para una operación real (oficial, blue, tarjeta, etc.),
que casi nunca coincide con "la" cotización de una API.

## Dexie sobre IndexedDB crudo

**Decisión:** usar Dexie.js como wrapper de IndexedDB en vez de la API nativa.

**Por qué:** la API nativa de IndexedDB es de bajo nivel y muy verbosa para transacciones,
índices compuestos y queries; Dexie da una API basada en promesas, `useLiveQuery` para
reactividad en React, y sigue siendo 100% local (no es un backend-as-a-service).

## Backup versionado desde el día 1, separado del schema de Dexie

**Decisión:** el formato del archivo `.finance` tiene su propio número de versión,
independiente de las versiones de `db.version()` de Dexie.

**Por qué:** son ciclos de vida distintos. El schema de Dexie puede cambiar en formas que
no ameritan un cambio en el formato de backup (ej. agregar un índice), y viceversa, el
formato de backup podría necesitar cambiar por razones de compatibilidad externa sin que
cambie el schema interno.

## Local-first sin autenticación

**Decisión:** no hay login, cuentas de usuario, ni ningún concepto de identidad — el
dispositivo es el perímetro.

**Por qué:** es un requisito explícito del producto (ver `docs/PRODUCT.md`), no una
omisión temporal. Agregar autenticación implicaría un backend, que es exactamente lo que
este proyecto evita.

## Un feature puede importar el `service.ts`/hooks de otro, nunca sus componentes

**Decisión:** `features/dashboard` importa directamente `getMonthSummary`,
`getCurrentNetWorth` y sus hooks desde `features/reports/`, en vez de duplicar esa
lógica. En cambio, en Etapas anteriores se duplicó deliberadamente un hook trivial de una
sola línea (`useAccounts`, wrapper de `accountsRepo.listAccountsWithBalances`) entre
`features/accounts` y `features/transactions`.

**Por qué:** la tabla de capas de `CLAUDE.md` prohíbe textualmente que un feature importe
"otros `features/*/components` internos" — no menciona `service.ts` ni `hooks/`. Para un
wrapper trivial de una sola función de repository, duplicar es más barato que la
dependencia cruzada. Pero `getMonthSummary`/`getCurrentNetWorth` no son triviales: hacen
conversión de moneda con manejo de tasas faltantes (`missingRateCount`), y esa lógica
sería costosa y riesgosa de mantener en dos lugares (un fix tendría que aplicarse dos
veces). El componente compartido `MissingRateBanner` que ambas páginas usan sí vive en
`src/components/` — ahí es donde corresponde un componente puramente presentacional sin
lógica de negocio, no en un feature.

**Regla práctica:** un componente de UI nunca cruza de un feature a otro (usar
`src/components/` si hace falta compartirlo); un `service.ts`/hook puede cruzar cuando
duplicarlo costaría más que la dependencia — evaluar caso por caso, no por defecto.
