// ============================================================================
//  Verificación de conectividad móvil, payload de arranque y seguridad del
//  registro cuando el inventario no se puede leer
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO (las rutas son relativas):
//
//      node tests/verify-conectividad-movil.mjs
//
//  Sólo Node, sin dependencias ni framework, como el resto de tests/: el
//  proyecto no tiene paso de build y se publica tal cual en GitHub Pages, así
//  que este archivo no se carga desde index.html ni afecta a la app.
//
//  Cubre cuatro cosas:
//   1. PAYLOAD: ni el arranque ni el conteo de existencias descargan
//      `qrImageBase64`; sólo se descarga el folio que se va a asignar.
//   2. SEGURIDAD: si el inventario no se puede leer, el registro de una
//      denominación de INVENTARIO_MONTOS se BLOQUEA en vez de inventarse un QR
//      de prueba SPECTRO-FUEL.
//   3. RED: tiempo de espera de 30 s y UN reintento automático.
//   4. TRANSPORTE: Firestore arranca con detección automática de long polling.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  FIRESTORE_TIMEOUT_MS,
  RETRY_DELAY_MS,
  withTimeout,
  withRetry,
  money,
} from "../js/utils.js";
import { INVENTARIO_MONTOS, MONTOS } from "../js/config.js";

if (!fs.existsSync("js/app.js")) {
  console.error(
    "Ejecuta este script desde la raíz del repo: node tests/verify-conectividad-movil.mjs"
  );
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const inv = fs.readFileSync("js/inventario.js", "utf8");

let pass = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log("  ok   " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL " + name + "\n       " + e.message);
    process.exitCode = 1;
  }
};
const testAsync = async (name, fn) => {
  try {
    await fn();
    console.log("  ok   " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL " + name + "\n       " + e.message);
    process.exitCode = 1;
  }
};

/* Los comentarios NOMBRAN las APIs que se quieren evitar ("en vez de
   getFirestore", "sin descargar el pool"), así que el análisis estático se
   hace sobre el código SIN comentarios. */
const soloCodigo = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const appCode = soloCodigo(app);
const invCode = soloCodigo(inv);

/* Extrae el cuerpo de una función del fuente equilibrando llaves. Es lo que
   permite EVALUAR la función real con dependencias simuladas, en vez de
   limitarse a buscar cadenas de texto. */
function extraerFuncion(src, firma) {
  const inicio = src.indexOf(firma);
  assert.ok(inicio !== -1, `no se encontró la función: ${firma}`);
  const abre = src.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === "{") nivel++;
    else if (src[i] === "}") {
      nivel--;
      if (nivel === 0) return src.slice(inicio, i + 1);
    }
  }
  throw new Error(`función sin cerrar: ${firma}`);
}

// ===========================================================================
console.log("\n== 1. Payload: el arranque no descarga ningún QR ==");
// ===========================================================================

const cargarStock = extraerFuncion(invCode, "async function cargarStock(");

test("cargarStock() cuenta con getCountFromServer, no con getDocs", () => {
  assert.match(cargarStock, /getCountFromServer\(/);
  assert.ok(
    !/getDocs\(/.test(cargarStock),
    "cargarStock() sigue descargando documentos; un COUNT no debe traer ninguno"
  );
});

test("cuenta una vez por denominación de INVENTARIO_MONTOS", () => {
  assert.match(cargarStock, /INVENTARIO_MONTOS\.map\(/);
  assert.match(cargarStock, /where\("status", "==", "disponible"\)/);
  assert.match(cargarStock, /where\("monto", "==", Number\(monto\)\)/);
});

test("la sonda de existencia es un COUNT total, no un getDocs(limit(1))", () => {
  assert.match(cargarStock, /getCountFromServer\(inventarioRef\)/);
  assert.match(cargarStock, /inventarioUsado = inventarioTotal > 0/);
});

test("ya no existe el pool en memoria con todos los folios disponibles", () => {
  // La consulta que traía 110 documentos (~660KB de base64) al entrar.
  assert.ok(
    !/getDocs\(\s*query\(\s*inventarioRef,\s*where\("status", "==", "disponible"\)\s*\)\s*\)/.test(
      invCode
    ),
    "sigue habiendo un getDocs de TODOS los disponibles, sin limit()"
  );
  assert.ok(
    !/\blet disponibles\b/.test(invCode),
    "sigue existiendo el array `disponibles` del pool completo"
  );
});

test("la reserva lee del SERVIDOR, nunca de la caché local", () => {
  /* getDocs() se conforma con la caché cuando no alcanza el servidor. Como los
     COUNT del arranque no guardan documentos, sin red devolvía un resultado
     VACÍO y el registro lo interpretaba como "no quedan folios": un problema
     de conexión disfrazado de "sin existencias". getDocsFromServer() falla de
     forma explícita y el registro se bloquea con el mensaje correcto. */
  const ventana = extraerFuncion(invCode, "async function ventanaDisponibles(");
  assert.match(ventana, /getDocsFromServer\(/);
  assert.ok(
    !/[^m]getDocs\(/.test(ventana),
    "un folio físico no se puede asignar a partir de la caché local"
  );
});

test("toda consulta de folios del registro lleva limit()", () => {
  const ventana = extraerFuncion(invCode, "async function ventanaDisponibles(");
  assert.match(ventana, /limit\(tope\)/);
  assert.match(ventana, /where\("status", "==", "disponible"\)/);
  assert.match(ventana, /where\("monto", "==", Number\(monto\)\)/);
  // Sin orderBy: evita tener que desplegar un índice compuesto.
  assert.ok(
    !/orderBy\(/.test(ventana),
    "un orderBy aquí exigiría un índice compuesto que no está desplegado"
  );
});

test("el qrImageBase64 se descarga sólo con el folio que se asigna", () => {
  const reservar = extraerFuncion(invCode, "export async function reservarFolios(");
  // La reserva no hace lecturas sueltas: todo pasa por la ventana con limit().
  assert.ok(!/getDocs\(/.test(reservar), "reservarFolios() no debe leer sin limit()");
  assert.match(reservar, /candidatos\(monto, cantidad\)/);
});

test("la lista completa se carga SÓLO al abrir la pestaña Inventario", () => {
  assert.match(appCode, /if \(target === "inventario"\) renderInventarioAdmin\(\);/);
  // Y no desde el arranque: unlock() sólo conecta el inventario, no lo lista.
  const unlock = extraerFuncion(appCode, "function unlock(");
  assert.ok(!/renderInventarioAdmin/.test(unlock), "no se lista al entrar a la app");
  assert.ok(!/cargarTodos/.test(appCode), "app.js no fuerza la carga completa");
});

test("la tabla de Inventario (Admin) sigue mostrando lo mismo", () => {
  /* Requisito explícito: no cambiar lo que ve el usuario en esa tabla. Sigue
     trayendo la colección entera y ordenándola igual; lo único que cambió
     después (ver tests/verify-anular-conexion.mjs) es que lee del servidor
     con reintento, para que una conexión mala no la pinte VACÍA. */
  const cargarTodos = extraerFuncion(invCode, "async function cargarTodos(");
  assert.match(cargarTodos, /\(inventarioRef\)/);
  assert.match(cargarTodos, /todos = snap\.docs\.map/);
  assert.match(cargarTodos, /todos\.sort\(/);
});

// ===========================================================================
console.log("\n== 2. Seguridad: inventario ilegible ⇒ registro bloqueado ==");
// ===========================================================================

// "No pudimos consultar" (se arregla reintentando) es un mensaje distinto de
// "No hay existencias" (se arregla importando un PDF): no deben confundirse.
const MENSAJE_BLOQUEO =
  "No pudimos consultar las existencias. Revisa tu conexión e inténtalo de nuevo.";

/* Evalúa la revisarInventario() REAL de js/app.js con dependencias simuladas.
   `escenario` decide qué responden el inventario y la reserva. */
function construirRevisar(escenario) {
  const fuente = extraerFuncion(appCode, "async function revisarInventario(");
  const llamadas = { reservarFolios: 0, ensurePool: [] };
  const fabrica = new Function(
    "ensurePool",
    "inventarioIlegible",
    "montoRequiereInventario",
    "stockDisponible",
    "reservarFolios",
    "INVENTARIO_MONTOS",
    "money",
    // revisarInventario() también pregunta ahora si el inventario está vacío
    // (js/app.js: inventarioVacio). Estos escenarios siempre tienen inventario.
    "inventarioVacio",
    "MSG_INVENTARIO_VACIO",
    `${fuente}; return revisarInventario;`
  );
  const revisar = fabrica(
    async (opciones) => { llamadas.ensurePool.push(opciones); },
    () => Boolean(escenario.ilegible),
    (monto) =>
      !escenario.ilegible &&
      escenario.inventarioUsado !== false &&
      INVENTARIO_MONTOS.includes(Number(monto)),
    (monto) => (escenario.stock ? escenario.stock[monto] ?? 0 : 99),
    async (items) => {
      llamadas.reservarFolios++;
      if (escenario.reservaError) {
        return { picks: [], faltantes: {}, error: new Error("unavailable") };
      }
      if (escenario.faltantes) {
        return { picks: [], faltantes: escenario.faltantes, error: null };
      }
      return {
        picks: items.map((m) =>
          INVENTARIO_MONTOS.includes(Number(m))
            ? { folio: "117765", monto: Number(m), vencimiento: null, qrImageBase64: "PNG" }
            : null
        ),
        faltantes: {},
        error: null,
      };
    },
    INVENTARIO_MONTOS,
    money,
    () => false,
    "inventario vacío (no aplica en estos escenarios)"
  );
  return { revisar, llamadas };
}

await testAsync(
  "inventario ilegible + monto de inventario ⇒ bloqueado con el mensaje pedido",
  async () => {
    for (const monto of INVENTARIO_MONTOS) {
      const { revisar, llamadas } = construirRevisar({ ilegible: true });
      const r = await revisar([monto]);
      assert.equal(
        r.problema,
        MENSAJE_BLOQUEO,
        `$${monto} debería bloquearse con el mensaje exacto`
      );
      assert.equal(r.picks, undefined, `$${monto} no debe devolver picks`);
      assert.equal(
        llamadas.reservarFolios,
        0,
        "no tiene sentido reservar si el inventario es ilegible"
      );
    }
  }
);

await testAsync("un monto no admitido bloquea el carrito completo", async () => {
  const { revisar } = construirRevisar({ ilegible: true });
  const r = await revisar([4000, 4000, 500]); // 500 sí sale del inventario
  assert.match(r.problema, /requieren un folio de inventario por vale/);
});

await testAsync(
  "denominación fuera de inventario no puede emitir un vale nuevo sin vínculo",
  async () => {
    // El esquema nuevo no permite usar la compatibilidad histórica en altas.
    assert.ok(
      !INVENTARIO_MONTOS.includes(4000),
      "este caso asume que 4000 no sale del inventario"
    );
    const { revisar } = construirRevisar({ ilegible: true });
    const r = await revisar([4000]);
    assert.match(r.problema, /requieren un folio de inventario por vale/);
    assert.equal(r.picks, undefined);
  }
);

await testAsync("si la reserva falla al leer, también se bloquea", async () => {
  const { revisar } = construirRevisar({ reservaError: true });
  const r = await revisar([500]);
  assert.equal(r.problema, MENSAJE_BLOQUEO);
});

await testAsync("sin existencias se avisa, y no se emite nada", async () => {
  const { revisar } = construirRevisar({ stock: { 500: 0 } });
  const r = await revisar([500]);
  assert.match(r.problema, /No hay existencias de \$500\./);
  assert.notEqual(r.problema, MENSAJE_BLOQUEO, "'no hay' no es 'no pudimos consultar'");
  assert.equal(r.picks, undefined);
});

await testAsync("si faltan folios en la reserva (vencidos), se bloquea", async () => {
  const { revisar } = construirRevisar({ faltantes: { 500: 1 } });
  const r = await revisar([500]);
  assert.match(r.problema, /No hay existencias vigentes de \$500/);
  assert.equal(r.picks, undefined);
});

await testAsync("las existencias se vuelven a contar en CADA registro", async () => {
  /* El bloqueo falso: con los conteos del arranque, un PDF importado desde
     otro celular no se veía y el registro decía "sin inventario". */
  const { revisar, llamadas } = construirRevisar({});
  await revisar([500]);
  assert.deepEqual(llamadas.ensurePool, [{ fresco: true }]);
  assert.match(inv, /export function ensurePool\(\{ fresco = false \} = \{\}\)/);
  assert.match(inv, /if \(fresco \|\| !stockPromise \|\| poolError\) stockPromise = cargarStock\(\)/);
});

await testAsync("los avisos de existencias respetan singular y plural", async () => {
  const uno = await construirRevisar({ stock: { 500: 1 } }).revisar([500, 500]);
  assert.match(uno.problema, /Sólo queda 1 vale de \$500 \(pediste 2\)\./);
  const tres = await construirRevisar({ stock: { 500: 3 } }).revisar([500, 500, 500, 500]);
  assert.match(tres.problema, /Sólo quedan 3 vales de \$500 \(pediste 4\)\./);
});

await testAsync("el aviso manda a la pestaña Inventario (ahí está «Importar PDF»)", async () => {
  const { revisar } = construirRevisar({ stock: { 500: 0 } });
  const r = await revisar([500]);
  assert.match(r.problema, /pestaña Inventario/);
  assert.ok(!/pestaña Admin/.test(app), "el botón de importar no está en Admin");
});

test("«↻ Actualizar» del inventario refresca la tabla Y los conteos", () => {
  const render = extraerFuncion(inv, "export async function renderInventarioAdmin(");
  assert.match(render, /Promise\.all\(\[cargarTodos\(force\), force \? refreshStock\(\) : null\]\)/);
  // Y los «Actualizar» de Historial y Dashboard también vuelven a contar.
  assert.match(app, /btn\.addEventListener\("click", \(\) => refrescarExistencias\(\)\)/);
});

test("«Registrar vales» se protege del doble toque", () => {
  const i = app.indexOf('valeForm.addEventListener("submit"');
  const envio = app.slice(i, app.indexOf("/* Comprueba el inventario y RESERVA", i));
  // Candado lógico antes de cualquier trabajo.
  // Incluye el guardado incierto: con un lote sin resolver no se reserva otro.
  assert.match(envio, /if \(revisando \|\| saving \|\| registroIncierto \|\| !confirmModal\.hidden\) return;/);
  // Bloqueo visible desde el primer toque…
  assert.match(envio, /revisando = true;\s*btnRegistrar\.disabled = true;/);
  assert.match(envio, /Consultando inventario…/);
  // …y restauración garantizada, también si la consulta lanza.
  // actualizarAccionRegistro() rehabilita el botón salvo con un guardado incierto.
  assert.match(envio, /finally \{\s*revisando = false;\s*actualizarAccionRegistro\(\);/);
  const accion = extraerFuncion(appCode, "function actualizarAccionRegistro(");
  assert.match(accion, /if \(registroIncierto\) \{\s*btnRegistrar\.disabled = true;/);
  assert.match(accion, /btnRegistrar\.disabled = false;/);
  assert.match(fs.readFileSync("index.html", "utf8"), /<button type="submit" id="btn-registrar">/);
});

await testAsync("camino feliz: devuelve un folio por vale", async () => {
  const { revisar } = construirRevisar({});
  const r = await revisar([500, 300]);
  assert.equal(r.problema, undefined);
  assert.equal(r.picks.length, 2);
  for (const p of r.picks) {
    assert.equal(p.folio, "117765");
    assert.equal(p.qrImageBase64, "PNG", "el QR viene de la misma consulta");
  }
});

test("doSave() consume la reserva; ya no vuelve a elegir folios", () => {
  const doSave = extraerFuncion(appCode, "async function doSave(");
  assert.match(doSave, /const \{ base, items, picks \} = pendingSave;/);
  assert.ok(
    !/tomarFolios\(/.test(appCode),
    "tomarFolios() elegía folios en el momento de guardar; ya no debe existir"
  );
  // El QR de prueba sólo puede salir cuando NO hay folio reservado.
  assert.match(doSave, /pick \? `COMBUSA-\$\{pick\.folio\}` : makeQrCode\(anio\)/);
});

await testAsync("doSave real vincula cada ID generado con su inventario en el mismo lote", async () => {
  // SDK y DOM simulados: comprueba el payload del CLIENTE, no la atomicidad
  // de Firestore. La suite de emulador comprueba por separado esas escrituras.
  const writes = [];
  let nextId = 0, commits = 0;
  const noop = () => {};
  const serverTimestamp = () => "SERVER_TIMESTAMP";
  const camposAsignacion = new Function("serverTimestamp",
    `${extraerFuncion(invCode, "export function camposAsignacion(").replace(/^export /, "")}; return camposAsignacion;`
  )(serverTimestamp);
  const cantidad = Number(app.match(/const MAX_VALES = (\d+);/)[1]);
  const ctx = {
    saving: false,
    pendingSave: {
      base: { nombre: "Fixture", categoria: "Empleado", registradoPor: "Prueba", fechaValeStr: "2026-11-15" },
      items: Array(cantidad).fill(200),
      picks: Array.from({ length: cantidad }, (_, i) => ({ folio: String(140000 + i), monto: 200 })),
    },
    Timestamp: { fromDate: (d) => d }, parseDateInput: (s) => new Date(s), uuid: () => "lote-fixture",
    btnConfirmar: {}, btnCancelar: {}, formError: {}, db: {}, valesRef: {},
    doc: () => ({ id: `AUTO${nextId++}` }), serverTimestamp, camposAsignacion,
    inventarioDocRef: (folio) => ({ folio }),
    writeBatch: () => ({
      update: (ref, data) => writes.push({ type: "update", ref, data }),
      set: (ref, data) => writes.push({ type: "set", ref, data }),
    }),
    commitConTiempo: async () => { commits++; return { ok: true }; },
    money, sum: (a) => a.reduce((s, n) => s + n, 0),
    marcarAsignadosLocal: noop, closeConfirm: noop, valeForm: { reset: noop }, clearCart: noop,
    updateCategoriaAuto: noop, fechaAnteriorToggle: {}, fechaValeInput: {}, todayInput: () => "2026-11-15",
    updateFechaToggle: noop, personaSelect: { focus: noop }, showToast: noop, loadVales: async () => {},
    openQrModal: noop, makeQrCode: () => { throw new Error("no se deben emitir QR de prueba"); },
    console: { error: (e) => { throw e; } },
  };
  ctx.registroIncierto = null;
  ctx.mostrarErrorGuardado = (e) => { throw e; };
  ctx.vigilarRegistroIncierto = () => { throw new Error("no debe quedar incierto"); };
  ctx.formError = {};
  const doSave = vm.runInNewContext(
    `${extraerFuncion(appCode, "async function completarRegistro(")}; ` +
    `(${extraerFuncion(appCode, "async function doSave(")})`, ctx);
  await doSave();
  assert.equal(commits, 1);
  assert.equal(writes.length, cantidad * 2);
  for (const alta of writes.filter((w) => w.type === "set")) {
    const asignacion = writes.find((w) => w.type === "update" && w.ref.folio === alta.data.folio);
    assert.equal(asignacion.data.asignadoValeId, alta.ref.id);
    assert.equal(asignacion.data.batchId, alta.data.batchId);
    assert.equal(alta.data.esquema, 2);
    assert.equal(alta.data.anulado, false);
  }
  ctx.pendingSave = { base: { fechaValeStr: "2026-11-15" }, items: [4000], picks: [null] };
  await doSave();
  assert.equal(commits, 1, "ni siquiera una denominación histórica puede guardarse sin folio");
  assert.match(ctx.formError.textContent, /No hay existencias/);
});

test("el modal de confirmación enseña el folio reservado", () => {
  /* Sólo es posible porque la reserva ocurre ANTES de confirmar: así quien
     registra ve qué vale de papel va a entregar, y puede cotejarlo. */
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /id="c-folios-row"[^>]*hidden/, "la fila arranca oculta");
  assert.match(html, /id="c-folios"/);

  const abrir = extraerFuncion(appCode, "function openConfirm(");
  assert.match(abrir, /openConfirm\(base, items, picks\)/);
  assert.match(abrir, /mostrarFolios\(picks, items\)/);
  // Persona, cantidad y total siguen a la vista.
  assert.match(abrir, /cPersona\.textContent = base\.nombre/);
  assert.match(abrir, /\$\{n\} \$\{n === 1 \? "vale" : "vales"\}/);
  assert.match(abrir, /cTotal\.textContent = money\(sum\(items\)\)/);
  // Y se le pasan los folios de verdad desde el envío del formulario.
  assert.match(appCode, /openConfirm\(base, items, revision\.picks\)/);
});

await testAsync("confirmación: un renglón por vale, monto junto a su folio", async () => {
  const fuenteLineas = extraerFuncion(app, "function lineasFolios(");
  const fuenteMostrar = extraerFuncion(app, "function mostrarFolios(");
  const fila = { hidden: false };
  const lista = { hijos: [], replaceChildren(...n) { this.hijos = n; } };
  const fabrica = new Function(
    "cFolios", "cFoliosRow", "formatFolio", "money", "document",
    `${fuenteLineas}; ${fuenteMostrar}; return { lineasFolios, mostrarFolios };`
  );
  // formatFolio REAL de js/inventario.js: el folio es un identificador y se
  // enseña tal cual está guardado.
  const comoTexto = new Function(
    `${extraerFuncion(inv, "export function formatFolio(").replace(/^export\s+/, "")}; return formatFolio;`
  )();
  assert.equal(comoTexto("117765"), "117,765", "con coma, como en el PDF de Combusa");
  assert.equal(comoTexto("007765"), "007,765", "no se pierden los ceros iniciales");
  assert.equal(comoTexto("1"), "1");
  const { lineasFolios, mostrarFolios } = fabrica(
    lista, fila, comoTexto, money,
    { createElement: () => ({ textContent: "" }) }
  );
  const textos = () => lista.hijos.map((li) => li.textContent);

  // Sin folios (denominación fuera del inventario): fila oculta.
  mostrarFolios([null, null], [4000, 4000]);
  assert.equal(fila.hidden, true);
  assert.deepEqual(textos(), []);

  // El ejemplo del requisito: cada monto con SU folio.
  mostrarFolios(
    [{ folio: "117700" }, { folio: "117704" }, { folio: "117702" }],
    [200, 200, 500]
  );
  assert.equal(fila.hidden, false);
  assert.deepEqual(textos(), [
    "$200 · Folio 117,700",
    "$200 · Folio 117,704",
    "$500 · Folio 117,702",
  ]);

  // Ordenado por monto aunque el carrito se armara en otro orden, sin perder
  // la pareja monto↔folio; los huecos sin inventario no generan renglón.
  assert.deepEqual(
    lineasFolios([1000, 200, 4000, 200], [{ folio: "9" }, { folio: "7" }, null, { folio: "8" }]),
    ["$200 · Folio 7", "$200 · Folio 8", "$1,000 · Folio 9"]
  );

  // Identificador: ni separador de miles ni pérdida de ceros iniciales.
  assert.deepEqual(lineasFolios([200], [{ folio: "007765" }]), ["$200 · Folio 007,765"]);

  // Los 20 vales del tope se enseñan TODOS (la lista se desplaza por CSS).
  const veinte = Array.from({ length: 20 }, (_, k) => ({ folio: String(117765 + k) }));
  assert.equal(lineasFolios(veinte.map(() => 200), veinte).length, 20);
});

test("el registro exige inventario aunque permanezcan utilidades del QR histórico", () => {
  // Se conserva la utilidad anterior; no autoriza nuevas altas sin folio.
  assert.match(appCode, /function makeQrCode\(/);
  assert.match(appCode, /SPECTRO-FUEL-\$\{year\}/);
  // Pero el registro ya no puede llegar ahí a ciegas: el bloqueo va antes.
  const revisar = extraerFuncion(appCode, "async function revisarInventario(");
  assert.match(revisar, /inventarioIlegible\(\)/);
  assert.match(revisar, new RegExp(MENSAJE_BLOQUEO));
});

test("todas las denominaciones ofrecidas salen del inventario", () => {
  // Una denominación nueva requiere inventario y soporte explícito en reglas.
  for (const m of MONTOS) {
    assert.ok(
      INVENTARIO_MONTOS.includes(m),
      `$${m} se ofrece en el formulario pero no sale del inventario`
    );
  }
});

// ===========================================================================
console.log("\n== 3. Red: 30 s de espera y un reintento ==");
// ===========================================================================

test("el tiempo de espera subió de 15 s a 30 s", () => {
  assert.equal(FIRESTORE_TIMEOUT_MS, 30_000);
  assert.ok(
    !/withTimeout\((?:[^,]+), 15000\)/.test(appCode),
    "sigue habiendo una lectura con el tiempo de espera viejo de 15 s"
  );
});

await testAsync("withTimeout rechaza con el mensaje que ve el usuario", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20),
    /Tiempo de espera agotado al conectar con Firestore/
  );
});

await testAsync("withTimeout no deja temporizadores vivos tras resolverse", async () => {
  // Un setTimeout huérfano mantendría el proceso (y la pestaña) despierta.
  const antes = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  await withTimeout(Promise.resolve("ok"), 60_000);
  const despues = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.equal(despues, antes, "el temporizador del tiempo de espera no se canceló");
});

await testAsync("withRetry reintenta UNA vez y avisa antes de hacerlo", async () => {
  let intentos = 0;
  let aviso = 0;
  let cierre = 0;
  const r = await withRetry(
    () => (++intentos === 1 ? Promise.reject(new Error("colgado")) : Promise.resolve("ok")),
    { onRetry: () => aviso++, onSettled: () => cierre++, delayMs: 10 }
  );
  assert.equal(r, "ok");
  assert.equal(intentos, 2, "exactamente un reintento");
  assert.equal(aviso, 1, "el aviso de conexión lenta se muestra una vez");
  assert.equal(cierre, 1, "y se retira al terminar");
});

await testAsync("el reintento espera antes de volver a intentarlo", async () => {
  /* Sin pausa el reintento es inútil: cuando el SDK de Firestore se da por
     desconectado, una lectura "desde el servidor" falla AL INSTANTE con el
     veredicto que ya tiene en memoria, sin tocar la red. Comprobado contra la
     app real: sin esta pausa el segundo intento fallaba siempre. */
  assert.ok(RETRY_DELAY_MS >= 1000, "una pausa menor de 1 s no le da tiempo al SDK");
  let intentos = 0;
  const t0 = Date.now();
  await withRetry(
    () => (++intentos === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("ok")),
    { delayMs: 300 }
  );
  const transcurrido = Date.now() - t0;
  assert.ok(transcurrido >= 290, `esperó ${transcurrido} ms, debería esperar la pausa`);
});

await testAsync("las lecturas de la app usan la pausa por defecto", async () => {
  // Ni app.js ni inventario.js deben pasar delayMs: se quedan con los 2,5 s.
  assert.ok(!/delayMs/.test(appCode), "app.js no debería recortar la pausa");
  assert.ok(!/delayMs/.test(invCode), "inventario.js no debería recortar la pausa");
});

await testAsync("si el reintento también falla, el error se propaga", async () => {
  let intentos = 0;
  await assert.rejects(
    () =>
      withRetry(
        () => {
          intentos++;
          return Promise.reject(new Error("sigue sin red"));
        },
        { delayMs: 10 }
      ),
    /sigue sin red/
  );
  assert.equal(intentos, 2, "no debe reintentar más de una vez");
});

await testAsync("un primer intento bueno no muestra ningún aviso", async () => {
  let aviso = 0;
  const r = await withRetry(() => Promise.resolve("directo"), { onRetry: () => aviso++ });
  assert.equal(r, "directo");
  assert.equal(aviso, 0);
});

test("loadVales() lee del servidor, no de la caché local", () => {
  /* getDocs() se rinde a los 10 s y resuelve con la caché local. La app no
     activa persistencia, así que esa caché está VACÍA en cada carga nueva: en
     una red lenta el historial se quedaba vacío, sin aviso y sin error, y el
     reintento no llegaba a dispararse nunca porque la lectura "funcionaba". */
  const loadVales = extraerFuncion(appCode, "async function loadVales(");
  assert.match(loadVales, /getDocsFromServer\(valesRef\)/);
  assert.ok(!/[^m]getDocs\(valesRef\)/.test(loadVales), "getDocs() aquí esconde el fallo");
});

test("loadVales() usa el reintento y enseña «Conexión lenta, reintentando…»", () => {
  const loadVales = extraerFuncion(appCode, "async function loadVales(");
  assert.match(loadVales, /withRetry\(\(\) => getDocsFromServer\(valesRef\)/);
  // El aviso se pone y se quita sólo si esta carga sigue siendo la más
  // reciente (`vigente()`): una carga ya superada no lo vuelve a mostrar.
  assert.match(loadVales, /onRetry: \(\) => \{ if \(vigente\(\)\) showSlowNotice\(\); \}/);
  assert.match(loadVales, /onSettled: \(\) => \{ if \(vigente\(\)\) hideSlowNotice\(\); \}/);
  assert.match(app, /Conexión lenta, reintentando…/);
});

test("el aviso de reintento NO es el error rojo", () => {
  const slow = extraerFuncion(appCode, "function showSlowNotice(");
  assert.match(slow, /loadingEl/);
  assert.ok(
    !/appError/.test(slow),
    "el error rojo (#app-error) se reserva para cuando el reintento falla"
  );
  // El error rojo sigue saliendo sólo desde el catch de loadVales().
  const loadVales = extraerFuncion(appCode, "async function loadVales(");
  assert.match(loadVales, /catch \(err\) \{[\s\S]*showAppError\(/);
  // Y tiene su propio estilo, distinguible del azul neutro de "Conectando…".
  const css = fs.readFileSync("css/styles.css", "utf8");
  assert.match(css, /\.loading--slow\s*\{/);
});

// ===========================================================================
console.log("\n== 4. Transporte: long polling automático ==");
// ===========================================================================

test("Firestore arranca con experimentalAutoDetectLongPolling", () => {
  assert.match(
    appCode,
    /initializeFirestore\(app, \{ experimentalAutoDetectLongPolling: true \}\)/
  );
  assert.match(appCode, /import \{\s*initializeFirestore,/);
  assert.ok(
    !/getFirestore\(/.test(appCode),
    "getFirestore(app) no admite opciones de transporte"
  );
});

test("se inicializa antes de cualquier lectura", () => {
  // initializeFirestore() lanza si Firestore ya se usó.
  const iInit = appCode.indexOf("initializeFirestore(app");
  const iPrimerUso = appCode.search(/\bgetDocs\(|\bgetCountFromServer\(|\bwriteBatch\(/);
  assert.ok(iInit !== -1 && iInit < iPrimerUso, "debe ser la primera llamada a Firestore");
});

test("la versión del SDK no cambió (la opción existe en 10.12.0)", () => {
  const versiones = new Set(
    [...app.matchAll(/firebasejs\/([\d.]+)\//g)].map((m) => m[1]).concat(
      [...inv.matchAll(/firebasejs\/([\d.]+)\//g)].map((m) => m[1])
    )
  );
  assert.deepEqual([...versiones], ["10.12.0"], "una sola versión del SDK, fijada");
});

// ===========================================================================
console.log("\n== 5. Sin dependencias nuevas ==");
// ===========================================================================

test("el repo sigue sin package.json ni node_modules", () => {
  assert.ok(!fs.existsSync("package.json"));
  assert.ok(!fs.existsSync("node_modules"));
});

test("los índices siguen vacíos (las reglas se prueban en el emulador)", () => {
  // Las consultas nuevas son dos filtros de igualdad + limit(): Firestore las
  // sirve con los índices de campo único que crea solo.
  assert.deepEqual(JSON.parse(fs.readFileSync("firestore.indexes.json", "utf8")), {
    indexes: [],
    fieldOverrides: [],
  });
});

console.log(`\n✅ ${pass} comprobaciones OK`);
