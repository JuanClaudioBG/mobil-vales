// ============================================================================
//  Pulido de UI: candado de «Anular», PIN encimado, inventario vacío y toasts
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-pulido.mjs
//
//  Sólo Node, sin dependencias. Se extraen de js/app.js las funciones REALES
//  (el módulo importa el SDK desde la CDN y no se puede cargar entero) y se
//  ejecutan con dobles: sin red, sin Firestore y sin DOM. El recorrido en
//  navegador está en tests/verify-pulido-ui.cjs.
//
//  Cubre:
//    1. doble toque en «Anular» → un solo PIN y un solo lote; el candado se
//       libera al terminar, también tras un error;
//    2. pedir un PIN con otro pendiente → el primero resuelve false;
//    3. inventario vacío → aviso y sin confirmación;
//    4. dos toasts seguidos → el segundo dura su tiempo completo.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-pulido.mjs");
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const appCode = soloCodigo(app);

let pass = 0;
const test = async (name, fn) => {
  try { await fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
};
function extraerFuncion(src, firma) {
  const inicio = src.indexOf(firma);
  assert.ok(inicio !== -1, `no se encontró: ${firma}`);
  let nivel = 0;
  for (let i = src.indexOf("{", inicio); i < src.length; i++) {
    if (src[i] === "{") nivel++;
    else if (src[i] === "}" && --nivel === 0) return src.slice(inicio, i + 1);
  }
  throw new Error(`sin cerrar: ${firma}`);
}
const tick = () => new Promise((r) => setImmediate(r));

const pinSrc =
  "let adminPinResolver = null;\n" +
  extraerFuncion(appCode, "function requestAdminPin(") + "\n" +
  extraerFuncion(appCode, "function settleAdminPin(");
const candadoSrc =
  "const anulacionesEnCurso = new Set();\n" + extraerFuncion(appCode, "async function anularUnaVez(");
const anularSrc = extraerFuncion(appCode, "async function anularVale(");

/* Modal de PIN real (requestAdminPin + settleAdminPin) sobre elementos falsos.
   `abiertos` cuenta cuántas veces se pidió un PIN. */
function modalPin() {
  const reg = { abiertos: 0, etiquetas: [] };
  const adminPinAction = {
    set textContent(v) { reg.abiertos++; reg.etiquetas.push(v); },
    get textContent() { return reg.etiquetas[reg.etiquetas.length - 1]; },
  };
  const adminPinModal = { hidden: true };
  const api = new Function(
    "adminPinAction", "adminPinInput", "adminPinError", "adminPinModal", "setTimeout",
    `${pinSrc}; return { requestAdminPin, settleAdminPin, pendiente: () => Boolean(adminPinResolver) };`
  )(adminPinAction, { value: "", focus() {} }, { hidden: true }, adminPinModal, () => 0);
  return { ...api, reg, adminPinModal };
}

/* anularVale() y su candado REALES, con el PIN real y todo lo demás simulado.
   `escenario.comprobar` y `escenario.commit` deciden qué pasa en cada intento. */
function construirAnular(escenario = {}) {
  const pin = modalPin();
  const reg = { lotes: 0, commits: 0, alertas: [], toasts: [], cargas: 0, comprobaciones: 0 };
  const fabrica = new Function(
    "requestAdminPin", "comprobarAntesDeAnular", "writeBatch", "commitConTiempo", "doc", "db",
    "COLLECTION", "serverTimestamp", "inventarioDocRef", "camposDevolucion", "refrescarInventario",
    "showToast", "loadVales", "alert", "mensajeError", "folioDe", "formatFolio", "console",
    `${anularSrc}\n${candadoSrc}\nreturn { anularUnaVez, enCurso: () => [...anulacionesEnCurso] };`
  );
  const api = fabrica(
    pin.requestAdminPin,
    async (vale) => {
      reg.comprobaciones++;
      if (escenario.comprobar) return escenario.comprobar(reg.comprobaciones);
      return { yaAnulado: false, devolver: true, folioAjeno: false, revisionNecesaria: false, folio: vale.folio };
    },
    () => { reg.lotes++; return { update() {} }; },
    async () => {
      reg.commits++;
      if (escenario.commit) return escenario.commit(reg.commits);
      return { ok: true };
    },
    (_, col, id) => ({ col, id }), {}, "vales", () => "TS",
    (folio) => ({ folio }), (id) => ({ status: "disponible", de: id }),
    async () => {}, (m) => reg.toasts.push(m), async () => { reg.cargas++; },
    (m) => reg.alertas.push(m), (err, accion) => `No se pudo ${accion}.`,
    (v) => v.folio || "", (f) => f, { error() {} }
  );
  return { ...api, pin, reg };
}
const VALE = { id: "v1", nombre: "Fixture", folio: "117765" };
const OTRO = { id: "v2", nombre: "Otra Fixture", folio: "117766" };

// ---------------------------------------------------------------------------
console.log("\n== 1. Candado de «Anular» ==");
await test("doble toque: un solo PIN y un solo lote", async () => {
  const c = construirAnular();
  const primero = c.anularUnaVez(VALE);
  const segundo = c.anularUnaVez(VALE); // segundo toque con el PIN aún abierto
  const tercero = c.anularUnaVez(VALE);
  assert.equal(c.pin.reg.abiertos, 1, "el PIN se pide una sola vez");
  assert.deepEqual(c.enCurso(), ["v1"]);
  await Promise.all([segundo, tercero]); // los toques ignorados terminan sin hacer nada
  assert.equal(c.pin.pendiente(), true, "el PIN del primer toque sigue esperando");
  c.pin.settleAdminPin(true);
  await primero;
  assert.equal(c.reg.lotes, 1);
  assert.equal(c.reg.commits, 1);
  assert.deepEqual(c.reg.toasts, ["✅ Vale anulado · folio 117765 devuelto al inventario"]);
  assert.deepEqual(c.enCurso(), [], "candado liberado al terminar");
});
await test("el candado dura hasta el final: un toque durante el commit también se ignora", async () => {
  let soltar;
  const c = construirAnular({ commit: () => new Promise((r) => { soltar = () => r({ ok: true }); }) });
  const primero = c.anularUnaVez(VALE);
  c.pin.settleAdminPin(true);
  await tick();
  assert.equal(c.reg.commits, 1, "el lote está en vuelo");
  await c.anularUnaVez(VALE);
  assert.equal(c.pin.reg.abiertos, 1, "no se vuelve a pedir el PIN");
  assert.equal(c.reg.lotes, 1);
  soltar();
  await primero;
  assert.deepEqual(c.enCurso(), []);
});
await test("el candado es por vale: otro vale no queda bloqueado", async () => {
  const c = construirAnular();
  const a = c.anularUnaVez(VALE);
  const b = c.anularUnaVez(OTRO); // pide su propio PIN; el de VALE se cancela (ver 2)
  assert.equal(c.pin.reg.abiertos, 2);
  await a;
  assert.deepEqual(c.enCurso(), ["v2"], "el primero se canceló y soltó su candado");
  c.pin.settleAdminPin(true);
  await b;
  assert.equal(c.reg.lotes, 1, "sólo se anuló el segundo");
  assert.deepEqual(c.enCurso(), []);
});
await test("PIN cancelado: candado liberado y se puede volver a intentar", async () => {
  const c = construirAnular();
  const primero = c.anularUnaVez(VALE);
  c.pin.settleAdminPin(false);
  await primero;
  assert.equal(c.reg.lotes, 0);
  assert.deepEqual(c.enCurso(), []);
  const otra = c.anularUnaVez(VALE);
  assert.equal(c.pin.reg.abiertos, 2);
  c.pin.settleAdminPin(true);
  await otra;
  assert.equal(c.reg.lotes, 1);
});
await test("candado liberado tras un error de lectura (no se anula y se puede reintentar)", async () => {
  const c = construirAnular({
    comprobar: (n) => {
      if (n === 1) throw Object.assign(new Error("sin red"), { code: "unavailable" });
      return { yaAnulado: false, devolver: true, folioAjeno: false, revisionNecesaria: false, folio: "117765" };
    },
  });
  const primero = c.anularUnaVez(VALE);
  c.pin.settleAdminPin(true);
  await primero;
  assert.equal(c.reg.lotes, 0, "no se escribió nada");
  assert.deepEqual(c.reg.alertas, ["No se pudo anular el vale."]);
  assert.deepEqual(c.enCurso(), [], "candado liberado tras el error");
  const reintento = c.anularUnaVez(VALE);
  assert.equal(c.pin.reg.abiertos, 2, "el reintento vuelve a pedir el PIN");
  c.pin.settleAdminPin(true);
  await reintento;
  assert.equal(c.reg.lotes, 1);
  assert.deepEqual(c.enCurso(), []);
});
await test("candado liberado tras un commit rechazado o un commit que lanza", async () => {
  const rechazado = construirAnular({ commit: () => ({ ok: false, err: { code: "permission-denied" } }) });
  let p = rechazado.anularUnaVez(VALE);
  rechazado.pin.settleAdminPin(true);
  await p;
  assert.equal(rechazado.reg.alertas.length, 1);
  assert.deepEqual(rechazado.enCurso(), []);

  const lanza = construirAnular({ commit: () => { throw new Error("fallo inesperado"); } });
  p = lanza.anularUnaVez(VALE);
  lanza.pin.settleAdminPin(true);
  await p;
  assert.equal(lanza.reg.alertas.length, 1);
  assert.deepEqual(lanza.enCurso(), []);
});
await test("si anularVale lanzara, el finally también libera", async () => {
  const api = new Function("anularVale", `${candadoSrc}; return { anularUnaVez, enCurso: () => [...anulacionesEnCurso] };`)(
    async () => { throw new Error("inesperado"); }
  );
  await assert.rejects(api.anularUnaVez(VALE), /inesperado/);
  assert.deepEqual(api.enCurso(), []);
});
await test("el botón «Anular» pasa por el candado; anularVale no cambió de firma", () => {
  assert.match(appCode, /btn\.addEventListener\("click", \(\) => anularUnaVez\(v\)\);/);
  assert.equal(appCode.split("anularVale(").length - 1, 2, "definición + la llamada del candado");
  assert.match(extraerFuncion(appCode, "async function anularUnaVez("), /finally \{\s*anulacionesEnCurso\.delete\(vale\.id\);\s*\}/);
});

// ---------------------------------------------------------------------------
console.log("\n== 2. PIN encimado ==");
await test("un PIN nuevo con otro pendiente: el primero resuelve false", async () => {
  const m = modalPin();
  let primero = "pendiente";
  const p1 = m.requestAdminPin("Acción A").then((r) => (primero = r));
  await tick();
  assert.equal(primero, "pendiente");
  const p2 = m.requestAdminPin("Acción B");
  await p1;
  assert.equal(primero, false, "el anterior queda cancelado, no colgado");
  assert.equal(m.adminPinModal.hidden, false, "el modal sigue abierto para el nuevo");
  assert.deepEqual(m.reg.etiquetas, ["Acción A", "Acción B"]);
  m.settleAdminPin(true);
  assert.equal(await p2, true, "el PIN correcto resuelve SÓLO la petición vigente");
  assert.equal(primero, false);
  assert.equal(m.pendiente(), false);
});
await test("tres seguidos: sólo el último queda pendiente", async () => {
  const m = modalPin();
  const [a, b] = [m.requestAdminPin("A"), m.requestAdminPin("B")];
  const c = m.requestAdminPin("C");
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  m.settleAdminPin(false);
  assert.equal(await c, false);
});
await test("un solo PIN: sin cambios (true al confirmar, false al cancelar)", async () => {
  const m = modalPin();
  let p = m.requestAdminPin("A");
  m.settleAdminPin(true);
  assert.equal(await p, true);
  assert.equal(m.adminPinModal.hidden, true);
  p = m.requestAdminPin("A");
  m.settleAdminPin(false);
  assert.equal(await p, false);
});

// ---------------------------------------------------------------------------
console.log("\n== 3. Inventario vacío ==");
const MSG = "No hay vales en inventario. Importa el PDF en la pestaña Inventario.";
const vacioSrc = extraerFuncion(appCode, "function inventarioVacio(");
const inventarioVacio = ({ ilegible = false, enUso = false, consultado = true }) =>
  new Function(
    "inventarioIlegible", "inventarioEnUso", "stockConsultado", "INVENTARIO_MONTOS",
    `${vacioSrc}; return inventarioVacio();`
  )(() => ilegible, () => enUso, () => (consultado ? 0 : null), [200, 300, 500, 1000]);
await test("el mensaje es el pedido", () => {
  assert.ok(appCode.includes(`"${MSG}"`));
});
await test("vacío sólo si el servidor respondió y el COUNT total es 0", () => {
  assert.equal(inventarioVacio({}), true);
  assert.equal(inventarioVacio({ enUso: true }), false, "hay vales importados (aunque estén agotados)");
  assert.equal(inventarioVacio({ consultado: false }), false, "antes de la primera respuesta no se afirma nada");
  assert.equal(inventarioVacio({ ilegible: true }), false, "si no se pudo leer, el aviso es otro");
});
await test("revisarInventario devuelve el aviso y no llega a reservar folios", async () => {
  const llamadas = { reservar: 0, ensurePool: [] };
  const revisar = (vacio) =>
    new Function(
      "ensurePool", "inventarioIlegible", "montoRequiereInventario", "stockDisponible", "reservarFolios",
      "INVENTARIO_MONTOS", "money", "inventarioVacio", "MSG_INVENTARIO_VACIO",
      `${extraerFuncion(appCode, "async function revisarInventario(")}; return revisarInventario;`
    )(
      async (o) => { llamadas.ensurePool.push(o); }, () => false, () => !vacio, () => 5,
      async (items) => { llamadas.reservar++; return { picks: items.map(() => ({ folio: "117765" })), faltantes: {}, error: null }; },
      [200, 300, 500, 1000], (n) => "$" + n, () => vacio, MSG
    );
  const r = await revisar(true)([200, 500]);
  assert.deepEqual(r, { problema: MSG }, "sin picks ⇒ el submit no abre la confirmación");
  assert.equal(llamadas.reservar, 0);
  assert.deepEqual(llamadas.ensurePool, [{ fresco: true }], "se decide con un conteo recién hecho");
  const ok = await revisar(false)([200]);
  assert.equal(ok.problema, undefined, "con inventario, todo sigue igual");
  assert.equal(llamadas.reservar, 1);
});
await test("el submit sólo abre la confirmación si no hay problema", () => {
  assert.match(appCode, /if \(revision\.problema\) \{\s*formError\.textContent = revision\.problema;\s*formError\.hidden = false;\s*return;\s*\}\s*pendingSave = \{ base, items, picks: revision\.picks \};\s*openConfirm\(/);
});
await test("«Registrar» queda bloqueado y el aviso se muestra desde que llegan los conteos", () => {
  const accion = (vacio, incierto = null) => {
    const btnRegistrar = { disabled: false, textContent: "", innerHTML: "" };
    new Function(
      "revisando", "registroIncierto", "btnRegistrar", "inventarioVacio", "cartItems", "money",
      `${extraerFuncion(appCode, "function actualizarAccionRegistro(")}; actualizarAccionRegistro();`
    )(false, incierto, btnRegistrar, () => vacio, () => [200, 500], (n) => "$" + n);
    return btnRegistrar;
  };
  assert.equal(accion(true).disabled, true);
  assert.equal(accion(false).disabled, false);
  assert.match(accion(false).textContent, /^Registrar 2 vales/);
  assert.match(accion(true, {}).innerHTML, /Verificando guardado anterior/, "el guardado incierto sigue mandando");
  const pintar = extraerFuncion(appCode, "function renderExistenciasRegistro(");
  assert.match(pintar, /avisoInventarioVacio\.hidden = !inventarioVacio\(\);\s*actualizarAccionRegistro\(\);/);
  assert.match(appCode, /onStockChange: renderExistenciasRegistro/);
});
await test("no añade consultas: sólo usa lo que inventario.js ya expone", () => {
  const cuerpo = vacioSrc.replace(/^function inventarioVacio\(\) \{/, "");
  const llamadas = [...cuerpo.matchAll(/(?<!\.)\b([A-Za-z_]\w*)\(/g)].map((m) => m[1]); // sin métodos (.some)
  assert.deepEqual([...new Set(llamadas)].sort(), ["inventarioEnUso", "inventarioIlegible", "stockConsultado"]);
  const inv = fs.readFileSync("js/inventario.js", "utf8");
  for (const f of ["inventarioEnUso", "inventarioIlegible", "stockConsultado"]) {
    assert.ok(inv.includes(`export function ${f}(`), f);
  }
});

// ---------------------------------------------------------------------------
console.log("\n== 4. Toasts seguidos ==");
/* showToast() real con un reloj manual: `avanzar(ms)` dispara los
   temporizadores vencidos, en orden. */
function toasts() {
  let ahora = 0, siguiente = 1;
  const pendientes = new Map();
  const clases = new Set();
  const toastEl = {
    textContent: "", hidden: true,
    classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) },
  };
  const src = appCode.slice(appCode.indexOf("let toastTimer = null;"), appCode.indexOf("function showToast("));
  const showToast = new Function(
    "toastEl", "setTimeout", "clearTimeout",
    `${src}${extraerFuncion(appCode, "function showToast(")}; return showToast;`
  )(
    toastEl,
    (fn, ms) => { pendientes.set(siguiente, { fn, en: ahora + ms }); return siguiente++; },
    (id) => void pendientes.delete(id)
  );
  const avanzar = (ms) => {
    const fin = ahora + ms;
    for (;;) {
      const [id, t] = [...pendientes].filter(([, x]) => x.en <= fin).sort((a, b) => a[1].en - b[1].en)[0] || [];
      if (!id) break;
      pendientes.delete(id);
      ahora = t.en;
      t.fn();
    }
    ahora = fin;
  };
  return { showToast, avanzar, toastEl, visible: () => !toastEl.hidden && clases.has("show"), pendientes };
}
await test("un toast solo: 3 s visible y oculto 300 ms después (como antes)", () => {
  const t = toasts();
  t.showToast("uno");
  t.avanzar(2999);
  assert.equal(t.visible(), true);
  t.avanzar(1);
  assert.equal(t.visible(), false, "empieza a desvanecerse a los 3 s");
  assert.equal(t.toastEl.hidden, false);
  t.avanzar(300);
  assert.equal(t.toastEl.hidden, true);
  assert.equal(t.pendientes.size, 0);
});
await test("segundo toast durante el desvanecido del primero: dura sus 3 s completos", () => {
  const t = toasts();
  t.showToast("uno");
  t.avanzar(3100); // el primero ya se está ocultando (quedan 200 ms)
  t.showToast("dos");
  assert.equal(t.pendientes.size, 1, "el ocultado pendiente del primero se canceló");
  t.avanzar(200); // aquí el ocultado del primero escondía el segundo
  assert.equal(t.toastEl.hidden, false);
  assert.equal(t.visible(), true);
  assert.equal(t.toastEl.textContent, "dos");
  t.avanzar(2799);
  assert.equal(t.visible(), true, "sigue a la vista hasta cumplir 3 s");
  t.avanzar(1);
  assert.equal(t.visible(), false);
  t.avanzar(300);
  assert.equal(t.toastEl.hidden, true);
});
await test("segundo toast con el primero aún visible: el reloj vuelve a empezar", () => {
  const t = toasts();
  t.showToast("uno");
  t.avanzar(2000);
  t.showToast("dos");
  t.avanzar(2999);
  assert.equal(t.visible(), true, "no se cierra a los 3 s del primero");
  t.avanzar(1);
  assert.equal(t.visible(), false);
});
await test("muchos toasts seguidos no dejan temporizadores sueltos", () => {
  const t = toasts();
  for (let i = 0; i < 5; i++) { t.showToast("t" + i); t.avanzar(3050); }
  assert.equal(t.pendientes.size, 1);
  t.avanzar(10000);
  assert.equal(t.pendientes.size, 0);
  assert.equal(t.toastEl.hidden, true);
});

console.log(process.exitCode ? "\n❌ Hay fallos" : `\n✅ ${pass} comprobaciones OK`);
