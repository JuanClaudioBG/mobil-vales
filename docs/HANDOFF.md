# Traspaso: etapa 1 de integridad (15 nov 2026)

## Estado al cierre del 15 nov 2026 (prevalece sobre lo de abajo)

Las secciones siguientes son el registro de trabajo del día; donde contradigan
a ésta, vale ésta.

- **Producción:** GitHub Pages sirve `52a99d5` (interfaz de Registro, Historial
  e Inventario; `version.json` = `2026-11-15-1`). Las reglas de Firestore en
  producción son las anteriores (iguales a `7664fdc` salvo un comentario). La
  integridad **no** está publicada.
- **Esta rama:** `integridad-sobre-52a99d5`, en el worktree
  `mobil-vales-integridad`, con commit local y sin push. Contiene los cambios
  de integridad reacomodados encima de `52a99d5`. `version.json` no cambió.
- **Respaldo de la carpeta original** (que sigue intacta en `7664fdc` con sus
  cambios sin commit): `~/Proyectos/Gasolinera-Familiar/respaldo-integridad-20261115-1953.patch`
  y la carpeta `…-untracked` junto a él.

### Integración sobre 52a99d5

`git apply --3way` del patch de respaldo. Conflictos en `js/app.js`,
`js/inventario.js` y `tests/verify-conectividad-movil.mjs`:

- Formato de folio: se conservó el **publicado** (`formatFolio` agrupa el texto
  con coma, `117,765` / `007,765`, sin pasar por `Number()`; `folioHtml` lo
  usa). `verify-historial-ui.cjs` y `verify-inventario-ui.cjs` quedaron como en
  `52a99d5`; `verify-registro-ui.cjs` y `verify-folios.mjs` se alinearon a ese
  formato.
- Todo lo de integridad se quedó como en la carpeta original: reglas,
  `esquema: 2`, `asignadoValeId`, `devueltoPorVale`, `ensurePool` fresco,
  candado `revisando`, mensajes de existencias, buscador de Admin.

### Ruta de anulación para históricos con folio (nueva)

Vales anteriores a `esquema` que tienen folio se pueden anular, devolviendo su
folio en el mismo lote, **sólo si se cumplen todas** estas condiciones (reglas
`devolucionHistorica` del lado del vale e `invDevolucionCorresponde` del lado
del inventario; el cliente las comprueba leyendo del servidor en
`comprobarAntesDeAnular`):

- vale sin `esquema`, con `folio` texto, `batchId` texto no vacío y no anulado;
- inventario antes: `asignado`, mismo `batchId`, mismo `monto` y **sin**
  `asignadoValeId`;
- mismo lote: el vale pasa a anulado (`anuladoEn == request.time`) y el folio a
  `disponible` con `batchId` y `asignadoValeId` en null y
  `devueltoPorVale == ID del vale`.

Si el folio tiene `asignadoValeId` de otro vale → «folio asignado a otro
registro». Cualquier otra diferencia (sin `batchId`, lote o monto distinto,
folio ausente, disponible, en revisión, canjeado o vencido) → «Requiere
revisión», sin escrituras. Siguen sin cambios la ruta de históricos sin folio y
la de `esquema 2` con vínculo exacto. Ningún alta nueva puede omitir
`esquema: 2`.

### Pruebas al cierre (todas corrieron)

| Prueba | OK | FAIL |
|---|---|---|
| `verify-anular-conexion.mjs` | 43 | 0 |
| `verify-conectividad-movil.mjs` | 43 | 0 |
| `verify-dashboard-filters.mjs` | 15 | 0 |
| `verify-excel-dashboard.mjs` | 136 | 0 |
| `verify-folios.mjs` | 17 | 0 |
| `verify-reopen.mjs` | 49 | 0 |
| `verify-scope-clarity.mjs` | 32 | 0 |
| `verify-reglas.mjs` (emulador, reglas de esta rama) | 63 | 0 |
| `verify-registro-ui.cjs`, `verify-historial-ui.cjs`, `verify-inventario-ui.cjs` (360 y 390 px, Firestore simulado) | 2 c/u | 0 |
| `verify-ui-release.cjs` (SDK real + emulador, 360 y 390 px) | 2 | 0 |

Además, con scripts temporales (borrados) y la app real contra el emulador:
registro de 20 vales en un lote con una anulación posterior; y anulación de un
histórico desde Historial (folio a `disponible`, `devueltoPorVale` correcto),
más un histórico con lote distinto que mostró «Requiere revisión» sin escribir.

`verify-ui-release.cjs` ahora espera `esquema: 2`, `asignadoValeId` igual al
vale nuevo y «Requiere revisión» para el histórico con folio inexistente.

Para las pruebas de Playwright contra el emulador: lanzar Chromium con
`--disable-features=LocalNetworkAccessChecks,…` y **no** interceptar las
peticiones al emulador (rompe el CORS). El SDK 10.12.0 se sirvió desde una
copia local (`SDK_CACHE`) que vive en `/private/tmp` y puede desaparecer.

### Pendiente de verificar antes de publicar

- **Datos de producción** (sólo lectura): cuántos vales históricos con folio
  cumplen la ruta histórica y cuántos quedarán en «Requiere revisión»; vales
  activos con folio sin `batchId` o con lote distinto al del inventario.
- Cliente publicado (`52a99d5`) con reglas nuevas desde la interfaz: sólo
  cubierto por REST en `verify-reglas.mjs`. Las altas del cliente publicado se
  **rechazan** con las reglas nuevas (no envía `esquema`): reglas y cliente
  deben publicarse juntos, con pausa operativa.
- El presupuesto de lecturas de reglas en la anulación es un cálculo (2
  documentos del propio lote), no una medición; lo que corrió es que el lote de
  20 vales y las anulaciones pasan.
- iPhone real y red móvil.
- `README.md` sigue desactualizado.


Estado: **cambios en el árbol de trabajo, sin commit**. No se desplegó nada, no
se escribió en producción y `version.json` sigue en `2026-10-21-1`.

**Continuación autorizada, 15 nov 2026:** el bloqueo por copia de
`folio + batchId` quedó cerrado **en emulador** mediante un vínculo al ID exacto
del vale. Se añadió `inventario.asignadoValeId` y `vales.esquema: 2`; se conservó
el máximo de 20 vales en un único lote, sin dividirlo ni reducirlo. No se
migraron datos. **Producción sigue sin verificar**: los históricos con folio
sin vínculo demostrable quedan bloqueados para anulación y requieren revisión.

Se leyeron README, este handoff, el diff completo (incluidos archivos nuevos)
y el estado de Git. No se encontraron archivos AGENTS.md en el repositorio ni
en los directorios padres revisados. README contiene información obsoleta
(`onSnapshot`, colección única); prevalecen el código y el alcance solicitado.

## Qué cambió

**Anulación e inventario** (`firestore.rules`, `js/app.js`, `js/inventario.js`)

- Un vale sólo se anula una vez. Antes, un dispositivo con la lista vieja podía
  volver a anular un vale y devolver un folio que ya era de otro vale (folio
  duplicado). Reproducido en el emulador con las reglas de `HEAD`.
- La devolución de un folio sólo se acepta si, en el mismo lote, el vale citado
  pasa de activo a anulado, su ID es `asignadoValeId`, tiene ese folio y su
  `batchId` es el de la asignación vigente.
- Campo nuevo y opcional en `inventario`: `devueltoPorVale` (ID del vale que
  devuelve el folio). Lo escribe el cliente sólo al devolver. No requiere
  rellenar inventario previo; eso **no demuestra compatibilidad de todos los
  vales existentes**, ni permite volver sin consecuencias a reglas anteriores.
- Anular dejando asignado el folio propio se rechaza; devolver sin anular,
  también.
- Cada alta exige el esquema nuevo y su asignación recíproca en el mismo
  commit. Una asignación no puede apuntar a un vale que ya existía. Copiar
  folio y lote no autoriza crear otro vale ni devolver el inventario.
- Sólo los históricos **sin campo folio** se pueden anular sin inventario.
  Se retiraron las excepciones por folio ausente/disponible y otros estados:
  no distinguían pruebas antiguas de inconsistencias actuales. Ningún alta
  puede omitir el esquema o el folio para usar esa excepción.
- Arreglo adicional: los vales antiguos con sólo `fecha` (sin `fechaVale`) no
  se podían anular ni con las reglas anteriores; ahora sí, si no tienen folio.
- Cliente: antes de anular lee del servidor el vale y la asignación del folio
  (`comprobarAntesDeAnular`, `asignacionDeFolio`, que sustituye a
  `existeFolio`).

**Existencias**: cada registro vuelve a contar (`ensurePool({ fresco: true })`);
«↻ Actualizar» refresca tabla y conteos; mensajes distintos para «No pudimos
consultar las existencias» y «No hay existencias».

**Doble toque**: «Registrar vales» se bloquea y muestra «Consultando
inventario…» (`revisando` en `js/app.js`).

**Folios**: visibles bajo el nombre en Historial y Admin; buscador por nombre o
folio (`folioDe`, `coincideBusqueda` en `js/utils.js`); buscador nuevo en
Admin. `formatFolio` ya no pone coma de miles en ninguna pantalla (`117765`, no
`117,765`).

**Confirmación y textos**: un renglón por vale (`$200 · Folio 117700`);
«pestaña Admin» corregido a «pestaña Inventario»; singular y plural.

Archivos: `firestore.rules`, `js/app.js`, `js/inventario.js`, `js/utils.js`,
`index.html`, `css/styles.css`, `tests/verify-anular-conexion.mjs`,
`tests/verify-conectividad-movil.mjs`, y nuevos `tests/verify-reglas.mjs`,
`tests/verify-folios.mjs`, `docs/HANDOFF.md`.

### Corrección pequeña añadida durante el cierre

`isSafeToReload()` sólo comprobaba `saving`, que no cubre las anulaciones.
Después de cerrar el PIN podía recargar con el commit de anulación pendiente.
Ahora `commitConTiempo()` cuenta los commits hasta que la promesa real se
resuelve o rechaza, e `isSafeToReload()` comprueba ese contador y `revisando`.
El timeout no libera el contador porque no cancela la escritura. Si la promesa
nunca termina, la actualización sigue esperando. No hay reintento, consulta de
reconciliación ni recuperación automática. Verificado con promesas controladas
en Node, **no en un navegador real**. Los clientes ya abiertos anteriores a
esta publicación siguen teniendo la limitación antigua.

La corrección de autoactualización y los cambios de Fable se conservaron.
En esta continuación se editaron `firestore.rules`, `js/app.js`,
`js/inventario.js`, `tests/verify-reglas.mjs`, `tests/verify-anular-conexion.mjs`,
`tests/verify-conectividad-movil.mjs` y este documento; se añadió el fixture
`tests/fixtures/presupuesto.rules`, exclusivamente para el emulador de controles.

## Pruebas

Última ejecución de este relevo:

| Prueba | Resultado |
|---|---|
| `tests/verify-reglas.mjs` (reglas locales nuevas, emulador) | 50 OK |
| Mismo script con `VALES_RULES_BASELINE=head` (reglas anteriores locales, emulador) | 6 OK, incluida reproducción del fallo original e incompatibilidad del alta nueva |
| Mismo script con `VALES_RULES_BASELINE=presupuesto` (fixture aislado) | 4 controles OK |
| `tests/verify-anular-conexion.mjs` | 41 OK |
| `tests/verify-conectividad-movil.mjs` | 43 OK |
| `tests/verify-folios.mjs` | 17 OK |
| `tests/verify-reopen.mjs` | 49 OK |
| `tests/verify-dashboard-filters.mjs` | 15 OK |
| `tests/verify-excel-dashboard.mjs`, `tests/verify-scope-clarity.mjs` | OK |
| `node --check js/app.js`, `git diff --check` | OK |

Los casos que antes caracterizaban el bypass ahora exigen su rechazo. La copia
se rechaza al crear y, si se siembra una copia inconsistente fuera de reglas,
tampoco puede anularse/devolver ni citar al dueño para devolver sin anularlo.
También se rechazan asignaciones sueltas, dos vales para una asignación,
vínculos cruzados por ID/folio/lote/monto, eliminación/adición del esquema al
anular y altas que se hacen pasar por históricas.

La carrera añadida usa `Promise.all` para lanzar dos commits REST sin esperar
entre ellos, cinco rondas con folios distintos. Cada lote tiene el folio común
y un segundo folio exclusivo. En cada ronda se verificó exactamente un éxito,
rechazo `PERMISSION_DENIED` del otro, ausencia de ambos vales perdedores, folio
exclusivo perdedor disponible e inventario/vales correspondientes al ganador.
Además se probó un commit de **20 vales + 20 asignaciones** en el mismo orden
del cliente, y una carrera entre **dos carritos completos de 20** con un folio
común. Sólo uno se completa; los 20 vales del perdedor no existen y sus 19 folios
exclusivos siguen disponibles. Esto verifica el emulador, no producción.

El ciclo asignar → anular/devolver → reasignar → anular/devolver comprueba que
`devueltoPorVale` conserva el primer ID al reasignar y cambia al segundo al
devolver. Se rechaza borrar/alterar ese campo durante la asignación, usar el
ID anterior o devolver sin enviar el ID vigente. `asignadoValeId` pasa de V1 a
null, luego a V2 y de nuevo a null. También se probó leer un
folio disponible, asignarlo a otro lote y después intentar anular con la
lectura obsoleta: las reglas rechazan el commit.

Los scripts de Node mezclan funciones reales con dependencias simuladas y
comprobaciones de texto. Verifican comportamiento local, formato y estructura;
**no prueban la integridad de Firestore ni una interacción móvil real**. Se
corrigió el título engañoso de una prueba que decía verificar reglas pero sólo
comprobaba que los índices estuvieran vacíos.
Se ejecuta además `doSave()` real con dependencias simuladas para comprobar que
los 20 IDs generados coinciden con sus 20 asignaciones, en un solo commit, y
que no se prepara un alta sin folio. Esa prueba es del payload del cliente.

Las pruebas de Node se corren desde la raíz: `node tests/<archivo>.mjs`.

### Presupuesto de accesos: revisado antes de editar

La [documentación oficial de límites](https://firebase.google.com/docs/firestore/quotas#security_rules)
establece 20 accesos por lote y 10 por operación; las llamadas resueltas en
caché no cuentan. No basta contar las escrituras ni probar un vale.

| Operación de alta | Llamadas escritas en la regla |
|---|---|
| Crear vale | 1 `getAfter` de su inventario |
| Asignar inventario | 1 `getAfter` del vale y 1 `exists` previo del mismo vale |
| Carrito de 20 | 40 `getAfter` + 20 `exists`, sobre los 40 documentos que se escriben |

No son 60 lecturas externas efectivas: en un lote válido los `getAfter`
consultan el estado propuesto de documentos del propio commit. Se comprobó
primero en un experimento aislado y después con las reglas completas. La
aceptación del máximo depende de esa resolución del conjunto de escrituras;
no se afirma que 60 consultas externas sean admisibles ni se quitan controles
recíprocos para ahorrar lecturas. El `exists` previo impide reutilizar un vale.

Control reproducible separado: 20 `get` a documentos distintos **fuera del
lote** pasan; 21 y 40 se rechazan sin documentos parciales. Una operación
con 11 accesos externos también se rechaza. Por tanto, el éxito del máximo no
se atribuye a que el emulador ignore todos los límites. No se midió el contador
interno de caché ni se ejecutó este flujo en producción. El emulador
[no reproduce todos los límites de producción](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production).
Mantener esta prueba al cambiar reglas: añadir lecturas fuera del lote puede
romper carritos válidos. No hubo cambios a `MAX_VALES` ni commits fragmentados.

### Emulador de Firestore: comandos que funcionaron

En esta máquina `java` no está en el PATH. Se usó el OpenJDK de Homebrew y el
jar del emulador que ya estaba en caché, sin `firebase-tools` y sin descargar
nada. Desde la raíz del repo:

```bash
# 1. Arrancar el emulador con las reglas del repo
/opt/homebrew/opt/openjdk/bin/java \
  -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar \
  --host 127.0.0.1 --port 8089 --rules "$PWD/firestore.rules" \
  > /tmp/emu-vales.log 2>&1 &
EMU=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:8089/ && break; sleep 0.5; done

# 2. Correr las pruebas de reglas
FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 GCLOUD_PROJECT=demo-vales \
  node tests/verify-reglas.mjs

# 3. Apagar el emulador
kill $EMU
```

La cabecera de `tests/verify-reglas.mjs` documenta además
`npx firebase-tools emulators:exec …`. **Ese comando no se ejecutó**; necesita
Java en el PATH.

La prueba habla con el emulador por REST: sin cabecera `Authorization` pasa por
las reglas (como la app); con `Bearer owner` las salta, y sólo se usa para
sembrar y leer. Se niega a correr si el host no es local o el proyecto no
empieza con `demo-`. Cada caso limpia esa base del emulador.

Para repetir la comparación con reglas anteriores, sin restaurar archivos:

```bash
git show 7664fdc4b7a1c2882fbf1edf83edb97e1d0fdc94:firestore.rules > /tmp/vales-reglas-head.rules
# Iniciar otro emulador con el mismo comando Java, puerto 8090 y
# --rules /tmp/vales-reglas-head.rules; apagarlo al terminar.
FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 GCLOUD_PROJECT=demo-vales-head \
  VALES_RULES_BASELINE=head node tests/verify-reglas.mjs
```

Controles del presupuesto: iniciar otro emulador con el mismo comando Java,
puerto 8091 y `--rules "$PWD/tests/fixtures/presupuesto.rules"`, y ejecutar:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8091 GCLOUD_PROJECT=demo-presupuesto \
  VALES_RULES_BASELINE=presupuesto node tests/verify-reglas.mjs
```

Apagar los emuladores al terminar. El fixture **no debe desplegarse** y no está
referenciado en `firebase.json`.

En este relevo el sandbox bloqueó inicialmente abrir/conectar sockets locales;
los comandos del emulador se ejecutaron con la excepción local aprobada por el
entorno. No fue un fallo de reglas. No se usó `firebase deploy`, ni su supuesto
`--dry-run`, ni se instaló nada. `HEAD` es la referencia anterior local;
**no se verificó que coincida con las reglas desplegadas**. El hash anterior
fija el HEAD usado en este relevo para que la comparación siga siendo reproducible.

### No verificado

- iPhone real, teclado en pantalla y despliegue/CDN real.
- Datos y reglas desplegadas de producción. Había un proyecto configurado en
  el cliente; en el primer relevo se intentó una consulta REST de sólo lectura, limitada a 501
  documentos de `vales` y proyectando exclusivamente `folio`, `batchId` y
  `anulado`. Falló por resolución de red (`ENOTFOUND`), sin obtener documentos.
  No se descargaron QR ni se imprimieron nombres, PINs o datos personales. No
  se solicitó acceso, no se cambiaron credenciales y no se reintentó con más
  permisos. **Verificado en producción mediante sólo lectura: ninguno.**
- Según el relevo anterior, el flujo en pantalla (360, 390 y 430 px, con Firestore simulado y datos
  ficticios) se recorrió **antes** del último cambio (bloqueo por folio ajeno).
  Ese cambio sólo tiene pruebas de Node y de emulador; no se volvió a ver en
  pantalla.

## Pendientes

- Compatibilidad real de los históricos, prueba móvil del paquete final y
  coordinación de publicación; detalles abajo. No se requiere migración para
  las altas nuevas sobre inventario disponible.
- A 360 px los nombres largos y algún encabezado se parten a media palabra
  (ya ocurría; el CSS lo hace para evitar desplazamiento lateral).
- `README.md` sigue desactualizado.
- Para etapas posteriores:
  - No encontrar un `batchId` no prueba que una escritura pendiente haya
    fallado; hará falta idempotencia y reconciliación.
  - Guardar la fecha a mediodía no sustituye una política de fecha y zona
    horaria.
  - Un error de permisos no demuestra por sí solo una colisión de folios.
- Fuera de alcance hasta nuevo aviso: rediseño global, barra inferior,
  compartir varios QR, reestructurar `js/app.js`, autenticación.

## Vínculo exacto y compatibilidad

**Verificado en emulador:** las reglas comprueban las dos direcciones de la
relación en el mismo commit. El alta del vale exige inventario asignado a su
ID, con mismo folio implícito en la ruta, lote, monto y tiempo de asignación.
La asignación exige que ese ID no existiera antes y que después sea un vale
activo de esquema 2 con el folio, lote y monto correspondientes. Una operación
suelta o cualquier incompatibilidad rechaza el lote completo.

Para devolver, el ID citado en `devueltoPorVale` debe ser exactamente el
`asignadoValeId` del inventario anterior, y ese vale debe pasar de activo a
anulado en el mismo commit. La regla del vale exige a su vez la devolución de
ese inventario, borrando el dueño actual a null. Los estados se evalúan al
confirmar con `resource`, `get` y `getAfter`; la lectura previa del navegador
sólo permite dar un mensaje claro. Nombre, monto y fecha no acreditan identidad:
el monto sólo se contrasta como dato del vale físico, además del ID exacto.

**Cambio aditivo autorizado:**

- `vales.esquema: 2`, obligatorio para todas las altas; inmutable. No se puede
  crear un documento legacy omitiéndolo ni quitarlo al anular. Las altas exigen
  folio y lote no vacío, `anulado: false`, fechas válidas y monto de inventario
  (200/300/500/1000). El ID cumple `[A-Za-z0-9_-]{1,64}`, como los IDs automáticos.
- `inventario.asignadoValeId`, ID exacto obligatorio en cada nueva asignación.
  Puede faltar en documentos anteriores y al importar; pasa a null al devolver
  y al siguiente ID al reasignar. No puede modificarse a solas ni durante la
  aprobación de un folio en revisión.
- Se conserva `devueltoPorVale` como registro de la última devolución: no es
  propietario actual, no se borra al reasignar y se reemplaza al devolver.

No se añadieron colecciones, backend, listeners, migraciones, inferencias de
propiedad ni recuperación automática. El PIN cliente sigue siendo una
limitación aceptada: estas reglas validan integridad, no identidad del usuario.

### Históricos

**Fixtures verificados en emulador; existencia real de estos casos en producción
no verificada.** Históricos son documentos ya existentes sin `esquema`; ninguna
alta nueva puede usar ese camino. No se utiliza una fecha elegida por el cliente
para decidir si un documento es histórico.

| Datos existentes | Resultado |
|---|---|
| Sin esquema ni campo folio, con `fecha` timestamp y monto histórico 4000 | Se puede anular una sola vez sin inventario |
| Histórico con folio, con batchId, folio `asignado` con mismo lote y monto y sin `asignadoValeId` | **Se anula y devuelve el folio** (ruta histórica, añadida al cierre) |
| Histórico con folio sin batchId, o con lote o monto incompatible | Bloqueado; requiere revisión |
| Folio ausente, disponible, en revisión, canjeado o vencido | No demuestra propiedad; no permite anular el vale con folio |
| Vale de esquema 2 pero inventario asignado sin `asignadoValeId` | Bloqueado aunque coincidan lote y demás datos |
| Vale e inventario nuevos vinculados por ID exacto | Anulación/devolución atómicas y ciclo completo de reasignación |
| Folio numérico, campos extra, batchId null, fecha inválida o ID incompatible | No se relaja la validación para anular |

La tolerancia de documentos antiguos con sólo `fecha` se conserva; no elimina
los requisitos de los demás campos. El esquema completo del vale y del
inventario se valida en cada actualización, incluidos límites de longitud y
campos permitidos. Los documentos disponibles importados antes pueden usarse
para nuevas asignaciones sin rellenarlos previamente.

El cliente muestra: «No se anuló: no podemos comprobar el vínculo de este vale
con su folio. Requiere revisión del registro y del inventario antes de continuar.
No se modificó ningún dato.» Para un ID ajeno demostrado conserva el aviso
específico de folio asignado a otro registro. No ofrece una reparación.

**Revisión posterior, por separado:** inventariar primero en modo de sólo lectura
los tipos y conteos de casos bloqueados (esquema, folio, lote, estado, dueño
exacto y referencias duplicadas), sin QR ni datos personales en los resultados.
Contrastar cada inconsistencia con evidencia del registro/importación y del
vale físico bajo acceso autorizado. No adjudicar un dueño por coincidencia de
nombre, monto o fecha. Si los datos no permiten demostrar el vínculo, mantener
el bloqueo y decidir explícitamente su tratamiento. Cualquier corrección o
migración requiere otra autorización; esta etapa no incluye ejecutarla.

## Publicación y recuperación propuestas — NO ejecutadas

Las combinaciones ya no son compatibles sólo con una breve interrupción de
anulaciones: **también cambió el alta**. La matriz usa HEAD
`7664fdc4b7a1c2882fbf1edf83edb97e1d0fdc94` como referencia anterior, no como
prueba de qué reglas hay desplegadas.

| Cliente / reglas | Alta | Anulación con inventario |
|---|---|---|
| Anterior / HEAD | Aceptada | Aceptada con la vulnerabilidad antigua reproducida |
| Esquema 2 / HEAD | Rechazada por campos nuevos; ningún documento parcial | Incompatible |
| Anterior / nuevas | Rechazada: falta esquema/ID exacto; no puede crear históricos | Bloqueada para asignaciones históricas y formatos antiguos de devolución |
| Esquema 2 / nuevas | Aceptada hasta 20 vales por lote | Aceptada para dueño exacto; históricos con folio sin vínculo bloqueados |

El cliente intermedio que sólo añadía `devueltoPorVale` tampoco envía el esquema
ni el ID exacto en las altas. El inventario importado sigue siendo legible y el
formato de importación no cambió. Eso no equivale a compatibilidad total de datos.

Orden propuesto:

1. Antes de publicar, evaluar o aceptar explícitamente el bloqueo operativo de
   los históricos con folio. Su cantidad es desconocida. Validar el paquete final
   en móvil. No migrar ni corregir producción como paso implícito.
2. Preparar juntos reglas, HTML/JS/CSS y un paquete de recuperación compatible
   con esquema 2. Coordinar una pausa de registros, anulaciones e importaciones;
   terminar formularios/modales y esperar commits reales. No forzar recargas
   cuando haya una escritura incierta.
3. En una tarea futura autorizada, publicar primero las reglas y luego el cliente
   completo con nueva versión. La ventana entre ambos bloquea altas/anulaciones
   antiguas sin escrituras parciales. No habilitar temporalmente altas legacy para
   suavizar la transición: reabriría el bypass.
4. Verificar la carga efectiva del cliente en cada dispositivo y hacer la prueba
   del ciclo completo antes de reanudar operaciones. El sondeo de versión es de
   60 s; la recarga pendiente reintenta cada 2 s cuando no hay formularios,
   modales, importaciones o commits activos. Puede esperar indefinidamente un
   commit sin resolver. Las pestañas anteriores no incorporan la corrección de
   autoactualización hasta que efectivamente carguen el cliente nuevo.

Si se publicaron reglas pero falla el cliente:

- Mantener las reglas nuevas y la pausa operativa. Recuperar hacia adelante
  sirviendo el paquete completo compatible o corrigiendo la entrega. Un cliente
  anterior no sirve como recuperación funcional de las altas nuevas.
- Distinguir `PERMISSION_DENIED` concluyente de timeout; una escritura incierta
  no se reenvía automáticamente. Verificar versión y ciclo antes de reabrir.
- No volver ciegamente a HEAD: reabre la doble anulación y rechaza documentos
  que ya contengan campos nuevos. Se reprodujo el bloqueo de reasignación con
  `devueltoPorVale`; HEAD tampoco admite `asignadoValeId` ni `esquema` por sus
  listas de campos permitidos. Eliminar esos campos en producción no es un
  procedimiento autorizado. Una reversión de reglas requiere decisión aparte.

**Estado final:** bloqueo técnico de copia cerrado en emulador, sin migración.
Pendientes antes de publicación: impacto real sobre históricos, validación móvil
y entrega coordinada. No se afirma compatibilidad total ni seguridad de acceso
por usuario. No se hicieron commit, push, despliegues, escrituras en producción
ni cambios en `version.json`.

## Ajuste de interfaz de Registro (15 nov 2026)

Cambio posterior, limitado al formulario de Registro y su confirmación:

- Persona seleccionada visible con nombre completo y categoría, conservando
  el selector, los colores y la identidad de la app.
- Existencias por denominación tomadas del mapa de COUNT ya cargado. El nuevo
  getter de presentación `stockConsultado` devuelve `null` cuando no hay conteo;
  la interfaz muestra «Sin consultar» al arrancar y después de un error, y
  «0 disponibles» sólo cuando el servidor simulado devuelve cero. Un callback
  de presentación actualiza esos textos al terminar las consultas existentes.
  No se agregan consultas ni se altera `stockDisponible` o la reserva.
- Acción «Registrar N vales · $total», con singular, actualizada al agregar,
  quitar o limpiar. Conserva el bloqueo y «Consultando inventario…»; al acabar
  la consulta recupera el texto del carrito.
- Confirmación con nombre destacado, total más grande, renglones separados
  con monto y folio, y desplazamiento para listas largas/pantallas bajas.
  Los estilos nuevos del modal están limitados a `#confirm-modal`.

**Verificado en navegador local con Firestore simulado**, no en producción:
Chromium ejecutó el HTML, CSS y módulos JS reales del repositorio a 360 y
390 px. Sólo se sustituyeron por interceptación la configuración (personas
ficticias), el nombre inicial del operador y las APIs de Firebase; las demás
peticiones externas se interceptaron sin salir a la red. No se guardaron vales.

`tests/verify-registro-ui.cjs` pasó en ambos anchos: estado desconocido, conteo
cero, cinco COUNT iniciales sin consultas adicionales para pintar existencias,
persona/categoría, singular/plural, quitar/limpiar, estado de consulta y doble
envío, tres folios con sus montos y total $900, cancelar, nombre largo y 20
vales (acciones accesibles también a 640 px de alto), bloqueo por falta de
existencias y por error de consulta, cero escrituras y cero errores JavaScript
no controlados. Se revisaron visualmente las cuatro capturas de 360×1000 y
390×1000 en `docs/capturas-registro/`.

Reproducción (Playwright disponible fuera del repositorio; sin dependencias
nuevas en la app):

```sh
python3 -m http.server 8792 --bind 127.0.0.1
# En otra terminal; PLAYWRIGHT_MODULE sólo hace falta si no resuelve el módulo:
PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-registro-ui.cjs
```

También se ejecutaron `verify-conectividad-movil.mjs` (43),
`verify-folios.mjs` (17), `verify-anular-conexion.mjs` (41) y
`verify-reopen.mjs` (49): **150 comprobaciones OK**. Se ajustó únicamente la
expectativa de restauración del texto del botón en la suite de conectividad.
`git diff --check` pasó.

**Alcance de la evidencia:** estas pruebas de interfaz con dobles de Firebase
no prueban integridad de Firestore. No se volvió a ejecutar el emulador en
este ajuste visual; sus resultados anteriores siguen documentados arriba.
`firestore.rules` y `version.json` se compararon byte a byte con la copia al
inicio de esta tarea y permanecen iguales. La revisión del diff de esta tarea
confirma que se conservaron la validación del inventario, asignación, anulación
con vínculo exacto y protección de autoactualización ante commits pendientes.
Producción sigue **no verificada**. No hubo commit, push ni despliegue; siguen
vigentes los bloqueos y el orden de publicación documentados anteriormente.

Archivos de este ajuste: `index.html`, `css/styles.css`, `js/app.js`,
`js/inventario.js` (sólo getter/callback de presentación),
`tests/verify-conectividad-movil.mjs`, nuevo `tests/verify-registro-ui.cjs`,
este handoff y las cuatro capturas PNG.

### Ajustes de Registro posteriores (15 nov 2026)

Se retiró el nombre duplicado debajo del selector: allí sólo permanece la
categoría. «Limpiar» pasó junto al desglose, por encima del total; su posición
se comprobó geométricamente a 360 y 390 px. El conteo cero ahora dice
«Agotado» (sustituye «0 disponibles» de la revisión anterior); el desconocido
sigue diciendo «Sin consultar». No cambió la validación al registrar.

Se volvió a ejecutar `tests/verify-registro-ui.cjs` con la app real local y
Firestore simulado: **OK a 360 y 390 px**, sin escrituras. Además de los casos
anteriores, se recorrió cada uno de los 20 folios dentro de la lista y se
comprobó que su renglón quedara visible, sin recorte ni superposición. A 640 px
de alto se comprobó que ambos botones, «Cancelar» y «Confirmar», fueran
alcanzables y admitieran toque (comprobación `trial`, sin ejecutar el guardado).
El desplazamiento existente fue suficiente: no se modificó el modal.

Capturas actualizadas en `docs/capturas-registro/`; se añadieron
`confirmacion-20-360.png` y `confirmacion-20-390.png`, con el final de la lista
y ambas acciones visibles. La captura solicitada es `registro-360.png`.
`verify-conectividad-movil.mjs`: **43 comprobaciones OK**.
`git diff --check`: OK. `js/inventario.js`, `firestore.rules` y `version.json`
se compararon byte a byte con su estado al comenzar este ajuste: intactos.
El diff de `js/app.js` sólo retira la repetición del nombre y cambia el texto
del conteo cero; asignación, anulación y autoactualización siguen intactas.
Sin commit, publicación ni acceso a producción. Estas pruebas siguen siendo
de interfaz con Firestore simulado, no pruebas de integridad del emulador.

## Historial móvil (15 nov 2026)

Presentación limitada a Historial a ≤768 px: nombre y monto en primera línea,
folio y fecha en segunda; nombres con salto entre palabras y monto reservado
al extremo derecho. «Sin folio» para históricos. Categoría, registrado por,
notas y los botones Ver/Anular siguen accesibles debajo. Tabla de escritorio,
Admin y Registro conservados. No se alteraron reglas, inventario, anulación,
reapertura de QR ni version.json.

`tests/verify-historial-ui.cjs`: OK en Chromium local a 360 y 390 px, con
Firestore simulado y cero escrituras. Incluye nombre largo, histórico sin
folio, filtros visibles, búsqueda de 117700 y 117,700 con el mismo resultado,
y reapertura del folio 117700: lectura del documento esperado y comparación
de los píxeles del canvas con la imagen ficticia suministrada por ese fixture.
No demuestra lectura de un QR físico ni integridad de Firestore.
Capturas revisadas en `docs/capturas-historial/historial-{360,390}.png`.
Suites Node: folios 17 OK, reapertura 49 OK; se adaptó la comprobación de
marcado de la celda del nombre a su nueva clase CSS. Diff sin errores.
Sin publicación ni acceso a producción.

## Inventario: presentación y búsqueda (15 nov 2026)

Existencias por denominación y acción Importar PDF arriba. Buscador de folio
sobre `todos`/la importación seleccionada, reutilizando `coincideBusqueda` sin
consultas nuevas ni conversión numérica del identificador. En móvil: folio y
monto primero; estado y vencimiento debajo; datos y acciones existentes
conservados. Sin fecha: «Sin fecha de vencimiento». Aviso de próximos 15 días
(incluye hoy y el día 15) sólo para disponibles, usando `todayInput`, comparación
ISO y `statusEfectivo`; vencidos siguen separados. No cambian importación,
transiciones, asignación, reglas ni version.json. Registro e Historial intactos.

`tests/verify-inventario-ui.cjs`: OK a 360 y 390 px con Firestore simulado.
Fixtures: vencimiento en día 15, ayer y sin fecha. Búsqueda `007765`/`007,765`
encuentra el mismo vale, conserva ceros y no añade lecturas; cero escrituras.
Capturas revisadas en `docs/capturas-inventario/`. Sin producción ni publicación.

Ajuste posterior de Inventario móvil: celdas auxiliares sin valor ocultas sólo
en móvil; asignado a y fecha de asignación se mantienen cuando tienen datos.
«Sin fecha de vencimiento» permanece visible. Buscador antes de Importación,
Estado y Monto. Suite UI ampliada con un vale asignado: OK a 360/390 px,
verificando tres celdas visibles en disponible sin datos auxiliares y ambas
celdas de asignación visibles en asignado. Sin nuevas consultas ni escrituras.
