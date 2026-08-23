# DECISIONS.md

ADRs cortos. Cada entrada: qué se decidió, por qué, qué se descartó.

## Import de CSV: una categoría por lote, duplicados destildados no bloqueados

**Decisión:** `src/features/csvImport/` importa un extracto bancario a una sola cuenta
por vez, con **una** categoría de gasto y **una** de ingreso elegidas para todo el lote
(el `kind` de cada fila sale del signo del monto o de qué columna — débito/crédito —
tiene valor). Las filas que parecen duplicadas de movimientos ya cargados (mismo
día+monto+descripción normalizada, en esa cuenta) se detectan y vienen destildadas por
defecto en la vista previa, pero el usuario puede tildarlas igual — nunca se bloquean.

**Por qué:** categorizar por texto (matching de palabras clave, o peor, alguna
heurística más compleja) es una feature bastante más grande, con riesgo real de
categorizar mal en silencio — categorías incorrectas son más difíciles de notar que
duplicados, que al menos son visibles y revisables en la vista previa antes de
confirmar. Para la primera versión, una categoría por lote más recategorizar a mano lo
que haga falta desde Movimientos es más simple y más seguro que una heurística que se
equivoca en un caso que el usuario no llega a revisar.

**Costo aceptado:** un extracto con muchas categorías reales requiere recategorizar
manualmente después de importar. Queda en el backlog una versión con reglas de
categorización configurables si en la práctica esto molesta.

**Detalle técnico:** el parser (`papaparse`, dependencia nueva — corre 100% local, cero
red) autodetecta el delimitador, pero el **formato de fecha nunca se autodetecta** —
`23/08/2026` es genuinamente ambiguo entre DD/MM y MM/DD sin más contexto, así que el
usuario lo elige explícito en el mapeo en vez de una heurística que puede acertar la
mayoría de las veces y arruinar silenciosamente el resto.

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

## Borrar un plan nunca borra plata que ya pasó

**Decisión:** borrar un `RecurringPlan` deja intactas sus transacciones ya
materializadas (siempre `confirmed`); borrar un `InstallmentPlan` borra sólo sus cuotas
todavía `projected` y conserva las `confirmed`.

**Por qué:** una transacción `confirmed` es historial real — ya movió (o va a mover, en
el caso de una cuota futura ya vencida y confirmada) el balance de una cuenta, y borrarla
sin que el usuario edite esa transacción puntualmente sería un cambio de plata silencioso.
Una cuota `projected` en cambio es sólo una previsión: nunca afectó ningún balance ni
reporte (ambos filtran por `status === 'confirmed'` desde la Etapa 0/3), así que borrarla
junto con el plan que la generó es simplemente descartar una previsión que dejó de ser
válida.

**Costo aceptado:** el usuario que quiere "deshacer" una cuota o recurrente ya confirmado
tiene que borrar esa transacción puntual desde Movimientos, no desde el plan — mismo
patrón ya establecido para editar una ocurrencia sin afectar el resto (ver "Recurrentes y
cuotas como planes + instancias materializadas" arriba).

## Cifrado del backup: WebCrypto nativo, opt-in, sin recuperación

**Decisión:** el archivo `.finance` puede cifrarse opcionalmente con una contraseña
(AES-256-GCM + PBKDF2-SHA256 vía `crypto.subtle`, `src/features/backups/encryption.ts`).
Nunca es el comportamiento por defecto — el usuario tiene que activar un switch a
propósito y confirmar la contraseña. No hay ningún mecanismo de recuperación: perder la
contraseña deja el backup inservible para siempre.

**Por qué:** el `.finance` es la única persistencia que sale del dispositivo (la
IndexedDB local ya está protegida por el sandbox del navegador/OS) — es el único punto
donde cifrado agrega algo. `crypto.subtle` es una API nativa del navegador, así que esto
no agrega ninguna dependencia nueva, consistente con la política de dependencias del
repo. GCM es cifrado autenticado: una contraseña incorrecta y un archivo corrupto tiran
la misma excepción indistinguible — es deliberado (evita un oráculo de padding), así que
la UI muestra un único mensaje para ambos casos en vez de intentar diferenciarlos.

**Costo aceptado:** sin recuperación, un typo en la contraseña del día que se cifró un
backup lo vuelve inútil — por eso el formulario de export pide la contraseña dos veces.
No agregar un "hint" de contraseña ni ningún dato derivado más débil (reduciría la
seguridad real a cambio de una conveniencia que no vale la pena para este caso de uso).

## Merge de backup: la base local siempre gana

**Decisión:** el modo merge del import (`importBackup(file, { mode: 'merge' })`) sólo
agrega filas que no existen localmente — nunca sobrescribe ni borra una entidad que ya
está en el dispositivo, aunque el archivo traiga una versión distinta con la misma ID.

**Por qué:** es la única política que no corre riesgo de pisar una edición reciente con
datos viejos del archivo, sin necesitar una UI de resolución de conflictos (que es una
feature bastante más grande). Como consecuencia directa, re-importar el mismo backup (o
uno superpuesto) en modo merge es idempotente — no duplica nada, porque todo lo que ya
existe se salta. Esto también resuelve `Settings` sin caso especial: como esa fila
(`id: 'singleton'`) casi siempre existe ya, la regla general la deja intacta sola.

**Costo aceptado:** dos cuentas creadas independientemente en cada dispositivo (ej. dos
"Banco" con IDs distintas) quedan duplicadas visualmente después de un merge — no hay
deduplicación por nombre. Resolverlo bien requeriría matching difuso y una UI de
conflictos; para el caso de uso real (consolidar dos dispositivos una sola vez, no
sincronizarlos en curso — ver "No-objetivos" en `docs/PRODUCT.md`), el usuario
archivando la cuenta duplicada a mano es más barato que construir esa feature.

**Detalle no obvio:** "unión por ID" no alcanza para `transactions` con `sourcePlanId` —
un `RecurringPlan` que ya existía en ambos dispositivos antes de separarse materializa la
misma ocurrencia calendario con un `id` de transacción *distinto* en cada uno
(`generateId()` es aleatorio, no derivado de la fecha/plan). Dedupear sólo por `id`
duplicaría silenciosamente el monto en el balance de la cuenta — el caso de uso central
que esta feature dice resolver. Por eso `transactions` también dedupe por el par
`(sourcePlanId, occurrenceIndex)` cuando está presente, además de por `id`. Además, el
merge repara `RecurringPlan.lastMaterializedDate` después de agregar transacciones — sin
esto, `materializeDue()` duplicaría cualquier ocurrencia traída desde otro dispositivo
cuya fecha sea posterior al watermark local, en la próxima apertura de la app. Ver
`docs/DATA_MODEL.md` "Modo merge" para el detalle completo.

**Detalle no obvio:** el merge repara `RecurringPlan.lastMaterializedDate` después de
agregar transacciones — sin esto, `materializeDue()` duplicaría cualquier ocurrencia
traída desde otro dispositivo cuya fecha sea posterior al watermark local, en la próxima
apertura de la app. Ver `docs/DATA_MODEL.md` "Modo merge" para el detalle completo.

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
