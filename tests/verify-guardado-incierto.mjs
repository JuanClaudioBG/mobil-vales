// ============================================================================
//  Guardado de vales con tiempo agotado: sin folios consumidos de más
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-guardado-incierto.mjs
//
//  Evalúa las funciones REALES de js/app.js (doSave, commitConTiempo,
//  completarRegistro, comprobarGuardadoAhora…) con SDK y DOM simulados y
//  commits controlados a mano: uno que tarda más que el tiempo de espera y
//  luego se confirma, y otro que tarda y luego se rechaza. Comprueba la
//  coordinación del CLIENTE; no prueba Firestore ni sus reglas.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import { withTimeout, withRetry, money } from "../js/utils.js";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-guardado-incierto.mjs");
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const appCode = soloCodigo(app);

let pass = 0;
const testAsync = async (name, fn) => {
  try {
    await fn();
    console.log("  ok   " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
};
const test = (name, fn) => testAsync(name, fn);

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

const FUNCIONES = [
  "async function commitConTiempo(",
  "async function doSave(",
  "function mostrarErrorGuardado(",
  "async function completarRegistro(",
  "function falloRegistroIncierto(",
  "function mostrarAvisoIncierto(",
  "function vigilarRegistroIncierto(",
  "async function comprobarGuardadoAhora(",
  "function actualizarAccionRegistro(",
];
const fuentes = FUNCIONES.map((f) => extraerFuncion(appCode, f));
// Las tres constantes de mensajes, tal cual (terminan en `";` de fin de línea;
// los textos llevan `;` dentro, así que no basta con buscar el primero).
const mensajes = appCode.match(/const MSG_GUARDADO_TARDA =[\s\S]*?const MSG_GUARDADO_SIN_LECTURA =[\s\S]*?";\n/)[0];
assert.match(mensajes, /MSG_GUARDADO_SIN_CONFIRMAR/);

const tick = () => new Promise((r) => setImmediate(r));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Arma un cliente con el código real y un SDK simulado. `commitImpl` decide
   qué devuelve cada batch.commit(); `leerVale` simula getDocFromServer. */
function cliente({ commitImpl, leerVale = async () => ({ exists: () => false }) }) {
  const reg = {
    commits: 0, lecturas: [], toasts: [], qrs: [], marcados: [], loads: 0,
    reservas: 0, sets: [], resets: 0,
  };
  let nextId = 0;
  const btn = () => ({ disabled: false, innerHTML: "", textContent: "" });
  const ctx = {
    saving: false, revisando: false, commitsEnCurso: 0, registroIncierto: null,
    pendingSave: null, carrito: [200, 500],
    Timestamp: { fromDate: (d) => d }, parseDateInput: (s) => new Date(s + "T12:00:00"),
    uuid: () => `lote-${reg.commits + 1}`,
    btnConfirmar: btn(), btnCancelar: btn(), btnRegistrar: btn(), btnComprobarGuardado: btn(),
    formError: { hidden: true, textContent: "" },
    avisoIncierto: { hidden: true }, avisoInciertoMsg: { textContent: "" },
    db: {}, valesRef: { col: "vales" }, COLLECTION: "vales",
    doc: (base, col, id) => (col === undefined ? { id: `AUTO${++nextId}` } : { col, id }),
    serverTimestamp: () => "TS",
    inventarioDocRef: (folio) => ({ folio }),
    camposAsignacion: (nombre, batchId, valeId) => ({ status: "asignado", batchId, asignadoValeId: valeId }),
    writeBatch: () => ({
      update() {},
      set(ref, data) { reg.sets.push({ id: ref.id, batchId: data.batchId }); },
      commit() { reg.commits++; return commitImpl(reg.commits); },
    }),
    withTimeout: (p) => withTimeout(p, 30),
    withRetry: (leer) => withRetry(leer, { ms: 30, delayMs: 5 }),
    getDocFromServer: async (ref) => { reg.lecturas.push(ref.id); return leerVale(ref); },
    makeQrCode: () => { throw new Error("no se emiten QR de prueba"); },
    money, sum: (a) => a.reduce((s, n) => s + n, 0),
    marcarAsignadosLocal: (a) => reg.marcados.push([...a].map((p) => p.folio)), // arreglo de este realm
    closeConfirm() {}, valeForm: { reset: () => reg.resets++ },
    clearCart() { ctx.carrito = []; ctx.actualizarAccionRegistro(); },
    cartItems: () => [...ctx.carrito],
    updateCategoriaAuto() {}, fechaAnteriorToggle: {}, fechaValeInput: {},
    todayInput: () => "2026-11-15", updateFechaToggle() {}, personaSelect: { focus() {} },
    showToast: (m) => reg.toasts.push(m),
    loadVales: async () => { reg.loads++; },
    openQrModal: (v) => reg.qrs.push([...v].map((x) => x.folio)),
    console: { error() {}, warn() {}, log() {} },
  };
  vm.runInNewContext(`${mensajes}\n${fuentes.join("\n")}\n` +
    "this.actualizarAccionRegistro = actualizarAccionRegistro;" +
    "this.doSave = doSave; this.comprobarGuardadoAhora = comprobarGuardadoAhora;" +
    "this.MSG = { tarda: MSG_GUARDADO_TARDA, sinConfirmar: MSG_GUARDADO_SIN_CONFIRMAR, sinLectura: MSG_GUARDADO_SIN_LECTURA };",
    ctx);
  /* Lo que hace el submit de #btn-registrar: con un registro incierto se
     ignora ANTES de reservar folios. Aquí se modela la reserva con un
     contador; el guardia real se comprueba aparte contra el fuente. */
  const registrar = (folios) => {
    if (ctx.revisando || ctx.saving || ctx.registroIncierto) return false;
    reg.reservas++;
    ctx.pendingSave = {
      base: { nombre: "Fixture", categoria: "Empleado", registradoPor: "Prueba", fechaValeStr: "2026-11-15" },
      items: [200, 500],
      picks: folios.map((f, i) => ({ folio: f, monto: [200, 500][i] })),
    };
    return true;
  };
  return { ctx, reg, registrar };
}

const controlado = () => {
  const lista = [];
  return {
    impl: () => { const d = Promise.withResolvers(); lista.push(d); return d.promise; },
    lista,
  };
};

// ===========================================================================
console.log("\n== Guardado con tiempo agotado ==");
// ===========================================================================

await testAsync("commit que tarda más que el timeout y LUEGO se confirma = éxito normal, sin segundo lote", async () => {
  const c = controlado();
  const { ctx, reg, registrar } = cliente({ commitImpl: c.impl });
  assert.ok(registrar(["117700", "117900"]));
  await ctx.doSave();

  // Tiempo agotado: bloqueado, aviso visible, nada de éxito todavía.
  assert.equal(reg.commits, 1);
  assert.ok(ctx.registroIncierto, "queda un registro incierto");
  assert.deepEqual([...ctx.registroIncierto.valeIds], ["AUTO1", "AUTO2"], "IDs generados antes del commit");
  assert.deepEqual(reg.sets.map((s) => s.id), ["AUTO1", "AUTO2"]);
  assert.equal(ctx.registroIncierto.batchId, "lote-1");
  assert.equal(ctx.btnRegistrar.disabled, true);
  assert.match(ctx.btnRegistrar.innerHTML, /Verificando guardado anterior…/);
  assert.equal(ctx.avisoIncierto.hidden, false);
  assert.equal(ctx.avisoInciertoMsg.textContent, ctx.MSG.tarda);
  assert.equal(ctx.formError.hidden, true, "no se muestra como error");
  assert.equal(ctx.pendingSave, null, "la reserva ya está en vuelo; no se reutiliza");
  assert.equal(ctx.commitsEnCurso, 1, "la autoactualización sigue esperando");
  assert.deepEqual([reg.toasts.length, reg.qrs.length, reg.resets], [0, 0, 0]);
  assert.deepEqual(ctx.carrito, [200, 500], "el carrito sigue tal cual");

  // Otro «Registrar»: no reserva ni guarda otro lote.
  assert.equal(registrar(["117701", "117901"]), false);
  ctx.pendingSave = { base: {}, items: [200], picks: [{ folio: "117702" }] };
  await ctx.doSave();
  assert.equal(reg.reservas, 1, "no se reservaron otros folios");
  assert.equal(reg.commits, 1, "no se hizo un segundo batch");
  ctx.actualizarAccionRegistro(); // p. ej. al tocar el carrito
  assert.equal(ctx.btnRegistrar.disabled, true, "sigue bloqueado tras repintar");

  // Llega la confirmación tardía.
  c.lista[0].resolve();
  await tick(); await tick();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(reg.toasts.length, 1);
  assert.match(reg.toasts[0], /2 vales registrados — \$700/);
  assert.deepEqual(reg.marcados, [["117700", "117900"]]);
  assert.equal(reg.resets, 1);
  assert.deepEqual(ctx.carrito, []);
  assert.equal(reg.loads, 1);
  assert.deepEqual(reg.qrs, [["117700", "117900"]]);
  assert.equal(ctx.btnRegistrar.disabled, false);
  assert.equal(ctx.btnRegistrar.textContent, "Registrar vales");
  assert.equal(ctx.commitsEnCurso, 0);
  assert.equal(reg.lecturas.length, 0, "no hizo falta leer nada");

  // Ya se puede registrar otro lote.
  assert.ok(registrar(["117701", "117901"]));
});

await testAsync("commit que tarda y LUEGO se rechaza = error normal, se libera y no se repite", async () => {
  const c = controlado();
  const { ctx, reg, registrar } = cliente({ commitImpl: c.impl });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  assert.ok(ctx.registroIncierto);
  assert.equal(ctx.btnRegistrar.disabled, true);

  c.lista[0].reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
  await tick(); await tick();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(ctx.formError.hidden, false);
  assert.equal(ctx.formError.textContent, "No se pudieron guardar los vales: Missing or insufficient permissions.");
  assert.doesNotMatch(ctx.formError.textContent, /folio/i, "no se afirma una causa que no se sabe");
  assert.deepEqual([reg.toasts.length, reg.qrs.length, reg.marcados.length, reg.resets], [0, 0, 0, 0]);
  assert.deepEqual(ctx.carrito, [200, 500], "el carrito queda para volver a intentar");
  assert.equal(ctx.btnRegistrar.disabled, false);
  assert.equal(ctx.btnRegistrar.textContent, "Registrar 2 vales · $700");
  assert.equal(reg.commits, 1, "no se reintentó la escritura");
  assert.equal(ctx.commitsEnCurso, 0);
});

await testAsync("rechazo inmediato del servidor sigue siendo un error normal (sin bloqueo)", async () => {
  const { ctx, reg, registrar } = cliente({
    commitImpl: () => Promise.reject(new Error("denegado")),
  });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(ctx.formError.textContent, "No se pudieron guardar los vales: denegado");
  assert.equal(reg.commits, 1);
});

await testAsync("commit a tiempo: éxito directo, sin aviso ni bloqueo", async () => {
  const { ctx, reg, registrar } = cliente({ commitImpl: async () => {} });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.deepEqual([reg.toasts.length, reg.qrs.length, reg.commits], [1, 1, 1]);
});

// ===========================================================================
console.log("\n== «Comprobar ahora» ==");
// ===========================================================================

await testAsync("no existe aún → sigue bloqueado y lo dice; luego existe → éxito una sola vez", async () => {
  const c = controlado();
  let servidor = { exists: () => false };
  const { ctx, reg, registrar } = cliente({ commitImpl: c.impl, leerVale: async () => servidor });
  registrar(["117700", "117900"]);
  await ctx.doSave();

  await ctx.comprobarGuardadoAhora();
  assert.deepEqual(reg.lecturas, ["AUTO1"], "lee sólo el primer vale del lote");
  assert.ok(ctx.registroIncierto, "no encontrarlo NO prueba que haya fallado");
  assert.equal(ctx.btnRegistrar.disabled, true);
  assert.equal(ctx.avisoInciertoMsg.textContent, ctx.MSG.sinConfirmar);
  assert.equal(ctx.btnComprobarGuardado.disabled, false);
  assert.equal(ctx.btnComprobarGuardado.textContent, "Comprobar ahora");

  // El SDK puede devolver la escritura LOCAL aún pendiente: no cuenta.
  servidor = { exists: () => true, metadata: { hasPendingWrites: true }, data: () => ({ batchId: "lote-1" }) };
  await ctx.comprobarGuardadoAhora();
  assert.ok(ctx.registroIncierto, "una escritura local pendiente no es confirmación");
  assert.equal(ctx.avisoInciertoMsg.textContent, ctx.MSG.sinConfirmar);

  // Documento de otro lote (no debería pasar con IDs aleatorios): no cuenta.
  servidor = { exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ batchId: "otro" }) };
  await ctx.comprobarGuardadoAhora();
  assert.ok(ctx.registroIncierto);

  servidor = { exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ batchId: "lote-1" }) };
  await ctx.comprobarGuardadoAhora();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(reg.toasts.length, 1);
  assert.deepEqual(reg.qrs, [["117700", "117900"]]);
  assert.equal(ctx.btnRegistrar.disabled, false);

  // Llega después la confirmación del commit: no duplica toast, QR ni marcas.
  c.lista[0].resolve();
  await tick(); await tick();
  assert.deepEqual([reg.toasts.length, reg.qrs.length, reg.marcados.length, reg.loads], [1, 1, 1, 1]);
  assert.equal(reg.commits, 1, "nunca se reintentó la escritura");
});

await testAsync("sin conexión al comprobar → sigue bloqueado y pide revisar la conexión", async () => {
  const c = controlado();
  const { ctx, reg, registrar } = cliente({
    commitImpl: c.impl,
    leerVale: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); },
  });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  await ctx.comprobarGuardadoAhora();
  assert.deepEqual(reg.lecturas, ["AUTO1", "AUTO1"], "una lectura + el reintento de lectura de siempre");
  assert.ok(ctx.registroIncierto);
  assert.equal(ctx.btnRegistrar.disabled, true);
  assert.equal(ctx.avisoInciertoMsg.textContent, ctx.MSG.sinLectura);
  assert.equal(reg.commits, 1);
  c.lista[0].reject(new Error("rechazado"));
  await tick(); await tick();
  assert.equal(ctx.registroIncierto, null);
  assert.equal(ctx.btnRegistrar.disabled, false);
});

await testAsync("si el commit se resuelve mientras se comprueba, el éxito se procesa una sola vez", async () => {
  const c = controlado();
  const lectura = Promise.withResolvers();
  const { ctx, reg, registrar } = cliente({ commitImpl: c.impl, leerVale: () => lectura.promise });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  const comprobando = ctx.comprobarGuardadoAhora();
  assert.equal(ctx.btnComprobarGuardado.disabled, true);
  assert.match(ctx.btnComprobarGuardado.innerHTML, /Comprobando…/);
  await ctx.comprobarGuardadoAhora(); // doble toque: se ignora
  assert.equal(reg.lecturas.length, 1);
  c.lista[0].resolve();
  await tick(); await tick();
  lectura.resolve({ exists: () => true, metadata: { hasPendingWrites: false }, data: () => ({ batchId: "lote-1" }) });
  await comprobando;
  assert.deepEqual([reg.toasts.length, reg.qrs.length, reg.marcados.length], [1, 1, 1]);
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(ctx.btnComprobarGuardado.disabled, false);
});

await testAsync("si el commit se rechaza mientras se comprueba, el aviso no reaparece", async () => {
  const c = controlado();
  const lectura = Promise.withResolvers();
  const { ctx, registrar } = cliente({ commitImpl: c.impl, leerVale: () => lectura.promise });
  registrar(["117700", "117900"]);
  await ctx.doSave();
  const comprobando = ctx.comprobarGuardadoAhora();
  c.lista[0].reject(new Error("rechazado"));
  await tick(); await tick();
  lectura.resolve({ exists: () => false });
  await comprobando;
  assert.equal(ctx.avisoIncierto.hidden, true);
  assert.equal(ctx.registroIncierto, null);
  assert.match(ctx.formError.textContent, /No se pudieron guardar los vales: rechazado/);
});

// ===========================================================================
console.log("\n== Fuente: guardias y ausencia de reintentos de escritura ==");
// ===========================================================================

await test("el submit de #btn-registrar no reserva con un guardado incierto", () => {
  const i = app.indexOf('valeForm.addEventListener("submit"');
  const envio = app.slice(i, app.indexOf("/* Comprueba el inventario y RESERVA", i));
  const guardia = envio.indexOf("registroIncierto");
  assert.ok(guardia !== -1 && guardia < envio.indexOf("revisarInventario("), "el guardia va antes de reservar");
});

await test("«Comprobar ahora» sólo lee: getDocFromServer con withRetry, sin onSnapshot ni escrituras", () => {
  const src = extraerFuncion(appCode, "async function comprobarGuardadoAhora(");
  assert.match(src, /withRetry\(\(\) => getDocFromServer\(doc\(db, COLLECTION, reg\.valeIds\[0\]\)\)\)/);
  for (const prohibido of [/onSnapshot/, /\.commit\(/, /commitConTiempo/, /writeBatch/, /doSave/, /setDoc|updateDoc/]) {
    assert.doesNotMatch(src, prohibido);
  }
  const vigilar = extraerFuncion(appCode, "function vigilarRegistroIncierto(");
  assert.doesNotMatch(vigilar, /\.commit\(|commitConTiempo|writeBatch|setTimeout|setInterval/);
});

await test("index.html trae el aviso y su botón, ocultos al arrancar", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /<div id="guardado-incierto"[^>]*role="status"[^>]*hidden>/);
  assert.match(html, /<button type="button" id="btn-comprobar-guardado"[^>]*>Comprobar ahora<\/button>/);
});

await esperar(0);
console.log(process.exitCode ? "\n❌ Hay fallos" : `\n✅ ${pass} comprobaciones OK`);
