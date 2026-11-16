// ============================================================================
//  Robustez del arranque, de la recarga del historial y del QR tras guardar
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-robustez.mjs
//
//  A diferencia de las demás pruebas, que extraen funciones sueltas, ésta
//  evalúa el js/app.js REAL Y COMPLETO, de la primera línea a la última, dentro
//  de un contexto de `vm`: los `import` se sustituyen por dobles (SDK de
//  Firebase e inventario simulados; utils.js y dashboard-data.js son los
//  reales) y el DOM es un doble mínimo sembrado con los `id` y los `hidden` de
//  index.html. Hace falta así porque parte de lo que se comprueba es que el
//  módulo TERMINA de cargar.
//
//  Cubre:
//    a) el QR se abre antes de que termine loadVales() (lectura lenta);
//    b) isSafeToReload() es false con el modal del QR abierto, y una versión
//       nueva no recarga la página encima de él;
//    c) con sessionStorage que lanza, el módulo carga y pide el PIN;
//    d) dos loadVales() cruzadas: gana la más reciente aunque la vieja
//       responda después.
//
//  No toca la red ni Firestore: ninguna lectura sale de este proceso. Nombres,
//  folios y PIN son ficticios.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import * as utils from "../js/utils.js";
import * as dashboardData from "../js/dashboard-data.js";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-robustez.mjs");
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const appCode = soloCodigo(app);

let pass = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log("  ok   " + name);
    pass++;
  } catch (e) {
    console.log("  FAIL " + name + "\n       " + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(condicion, queEspera) {
  for (let i = 0; i < 400; i++) {
    if (condicion()) return;
    await esperar(5);
  }
  throw new Error("no llegó a cumplirse: " + queEspera);
}
/* ¿La promesa termina sola, sin que nadie resuelva la lectura pendiente? */
const terminaSola = (promesa) =>
  Promise.race([promesa.then(() => "termina"), esperar(60).then(() => "sigue esperando")]);

const rechazosSinAtender = [];
process.on("unhandledRejection", (motivo) => rechazosSinAtender.push(motivo));
// utils.js (el real) avisa por consola de cada «primer intento fallido». Aquí
// los fallos son simulados a propósito: no deben ensuciar la salida.
console.warn = () => {};

// --- El módulo, sin sus `import` ---------------------------------------------
// Cada import se cambia por los mismos saltos de línea que ocupaba: así los
// números de línea de un error siguen siendo los de js/app.js.
const RE_IMPORT = /^import\s[\s\S]*?\sfrom\s+"[^"]+";/gm;
const importados = [];
const codigoModulo = app.replace(RE_IMPORT, (sentencia) => {
  const nombres = sentencia.slice(sentencia.indexOf("{") + 1, sentencia.indexOf("}"));
  for (const n of nombres.split(",")) if (n.trim()) importados.push(n.trim());
  return sentencia.replace(/[^\n]/g, "");
});
assert.ok(importados.length > 40, "no se reconocieron los import de js/app.js");
assert.doesNotMatch(codigoModulo, /^\s*import\s[^(]/m, "quedó un import estático sin sustituir");
const guion = new vm.Script(codigoModulo, { filename: "js/app.js" });

// --- DOM mínimo ---------------------------------------------------------------
class Nodo {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.style = { setProperty() {} };
    this.parentElement = null;
    this.offsetHeight = 0;
    this.listeners = {};
    this._html = "";
    this._sub = new Map();
    this._clases = new Set();
    const clases = this._clases;
    this.classList = {
      add: (c) => clases.add(c),
      remove: (c) => clases.delete(c),
      contains: (c) => clases.has(c),
      toggle: (c, on) => {
        const poner = on === undefined ? !clases.has(c) : Boolean(on);
        if (poner) clases.add(c);
        else clases.delete(c);
        return poner;
      },
    };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get options() { return (this._options ??= [new Nodo()]); }
  addEventListener(tipo, fn) { (this.listeners[tipo] ??= []).push(fn); }
  /* Dispara los listeners REALES que registró la app. */
  disparar(tipo, evento = {}) {
    const ev = { preventDefault() {}, target: this, key: "", ...evento };
    return Promise.all((this.listeners[tipo] || []).map((fn) => fn(ev)));
  }
  appendChild(hijo) { hijo.parentElement = this; this.children.push(hijo); return hijo; }
  replaceChildren(...hijos) { this.children = hijos; }
  querySelector(sel) {
    if (!this._sub.has(sel)) this._sub.set(sel, new Nodo());
    return this._sub.get(sel);
  }
  querySelectorAll() { return []; }
  closest() { return new Nodo(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  focus() {}
  reset() {}
  remove() {}
  before() {} // js/app.js inserta el aviso de «inventario vacío» antes de #form-error
  scrollIntoView() {}
  click() { return this.disparar("click"); }
}

/* Un Nodo por cada `id` de index.html, con el `hidden` que trae la etiqueta:
   el estado inicial es el de la página real (modales cerrados, PIN a la
   vista, #app-screen oculto). Un id que no esté en el HTML devuelve null,
   igual que en el navegador. */
function crearDocumento() {
  const porId = new Map();
  for (const m of html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]+)"[^>]*>/g)) {
    const nodo = new Nodo(m[1]);
    nodo.hidden = /\shidden(?=[\s>=/])/.test(m[0]);
    porId.set(m[1], nodo);
  }
  porId.get("loading").textContent = "Conectando con la base de datos…";
  const tabs = ["registro", "dashboard", "admin", "inventario"].map((vista) => {
    const tab = new Nodo();
    tab.dataset.view = vista;
    return tab;
  });
  return {
    porId,
    hidden: false,
    body: new Nodo("body"),
    documentElement: new Nodo("html"),
    listeners: {},
    addEventListener(tipo, fn) { (this.listeners[tipo] ??= []).push(fn); },
    querySelector: (sel) => (sel.startsWith("#") ? porId.get(sel.slice(1)) ?? null : null),
    querySelectorAll: (sel) => (sel === ".tab" ? tabs : []),
    createElement: () => new Nodo(),
  };
}

// --- Almacenamientos de sesión ------------------------------------------------
function almacenamientoNormal(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => void datos.set(k, String(v)),
  };
}
const bloqueado = () => {
  const err = new Error("The operation is insecure.");
  err.name = "SecurityError";
  throw err;
};
// El objeto existe pero cada operación lanza (modos privados antiguos).
const almacenamientoQueLanza = () => ({ getItem: bloqueado, setItem: bloqueado });
// Ni siquiera se puede acceder a `sessionStorage` (cookies bloqueadas).
const ACCESO_LANZA = Symbol("el acceso a sessionStorage lanza");

// --- Datos ficticios ----------------------------------------------------------
const PIN = "0000";
const CONFIG = {
  firebaseConfig: { projectId: "demo-vales" },
  ACCESS_PIN: PIN,
  ADMIN_PIN: "1111",
  COLLECTION: "vales",
  CATEGORIAS: ["Empleado", "Familia", "Socio"],
  MONTOS: [200, 300, 500, 1000],
  INVENTARIO_MONTOS: [200, 300, 500, 1000],
  DEPARTAMENTOS: ["Pruebas"],
  PERSONAS: [
    { nombre: "Persona Uno", categoria: "Empleado", depto: "Pruebas" },
    { nombre: "Persona Dos", categoria: "Familia", depto: "Pruebas" },
  ],
};

const vale = (id, dia, extra = {}) => ({
  id,
  data: () => ({
    nombre: "Persona Uno",
    categoria: "Empleado",
    monto: 200,
    registradoPor: "Operador ficticio",
    fechaVale: new Date(2026, 10, dia, 12),
    anulado: false,
    folio: "9000" + id,
    ...extra,
  }),
});
const instantanea = (...docs) => ({ docs });

const valeGuardado = (folio, monto) => ({
  nombre: "Persona Uno",
  categoria: "Empleado",
  monto,
  fechaStr: "2026-11-16",
  qrCode: `COMBUSA-${folio}`,
  folio,
  vencimiento: null,
  qrImageBase64: null,
});
const registroGuardado = () => ({
  batchId: "lote-ficticio",
  valeIds: ["V1", "V2"],
  items: [200, 500],
  base: { nombre: "Persona Uno", categoria: "Empleado", registradoPor: "Operador ficticio", fechaValeStr: "2026-11-16" },
  savedVales: [valeGuardado("900001", 200), valeGuardado("900002", 500)],
  asignados: [],
});

// --- Cargar la app ------------------------------------------------------------
/* Evalúa js/app.js entero en un contexto nuevo. Devuelve el contexto (`app`,
   con las funciones del módulo), el DOM, y las LECTURAS de vales en vuelo:
   cada getDocsFromServer() queda pendiente hasta que la prueba la resuelve o
   la rechaza a mano, que es lo que permite cruzar respuestas. */
function cargarApp({ almacenamiento = almacenamientoNormal(), versiones = ["prueba-1"] } = {}) {
  const documento = crearDocumento();
  const el = (id) => {
    const nodo = documento.porId.get(id);
    assert.ok(nodo, `index.html no tiene #${id}`);
    return nodo;
  };
  const lecturas = [];
  const reg = { inventarioIniciado: 0, recargas: 0, intervalos: [], qrAbiertoAlLeer: [] };
  const temporizador = (fn, ms, ...resto) => {
    const t = setTimeout(fn, ms, ...resto);
    t.unref?.(); // el toast y demás adornos no retienen el proceso
    return t;
  };

  const ctx = {
    // SDK de Firebase: nada sale de este proceso.
    initializeApp: () => ({}),
    initializeFirestore: () => ({}),
    collection: () => ({ coleccion: "vales" }),
    doc: () => ({}),
    getDocFromServer: async () => { throw new Error("lectura no prevista en esta prueba"); },
    getDocsFromServer: () =>
      new Promise((resolve, reject) => {
        reg.qrAbiertoAlLeer.push(!documento.porId.get("qr-modal").hidden);
        lecturas.push({ resolve, reject });
      }),
    serverTimestamp: () => "ahora",
    writeBatch: () => { throw new Error("esta prueba no escribe"); },
    Timestamp: { fromDate: (d) => d },

    ...CONFIG,

    // utils.js y dashboard-data.js REALES. Sólo se acortan las esperas del
    // reintento (30 s y 2,5 s en producción) para que la prueba no tarde.
    ...utils,
    withRetry: (leer, opciones = {}) => utils.withRetry(leer, { ms: 1500, delayMs: 5, ...opciones }),
    ...dashboardData,

    // inventario.js simulado (importa el SDK por URL; aquí no interviene).
    initInventario: () => { reg.inventarioIniciado++; },
    ensurePool: async () => {},
    renderInventarioAdmin: async () => {},
    montoRequiereInventario: () => true,
    inventarioIlegible: () => false,
    inventarioEnUso: () => true,
    stockDisponible: () => 0,
    stockConsultado: () => null,
    reservarFolios: async () => ({ picks: [], faltantes: {}, error: null }),
    inventarioDocRef: (folio) => ({ folio }),
    camposAsignacion: () => ({}),
    camposDevolucion: () => ({}),
    asignacionDeFolio: async () => ({ existe: false }),
    qrImagenDeFolio: async () => ({ ok: false }),
    refrescarInventario: async () => {},
    refrescarExistencias: () => {},
    marcarAsignadosLocal: () => {},
    formatFolio: (folio) => String(folio),

    // Navegador.
    document: documento,
    location: { href: "http://localhost/", reload: () => { reg.recargas++; } },
    fetch: async () => ({
      ok: true,
      json: async () => ({ version: versiones.length > 1 ? versiones.shift() : versiones[0] }),
    }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    setInterval: (fn) => reg.intervalos.push(fn),
    clearInterval() {},
    setTimeout: temporizador,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    navigator: { onLine: true },
    alert: (msg) => { throw new Error("alert inesperado: " + msg); },
    crypto: webcrypto,
    URL,
    console: { ...console, warn() {}, error() {} }, // los fallos simulados no ensucian la salida
  };
  for (const nombre of importados) {
    assert.ok(nombre in ctx, `js/app.js importa «${nombre}» y esta prueba no lo simula`);
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  if (almacenamiento === ACCESO_LANZA) {
    vm.runInContext(
      `Object.defineProperty(globalThis, "sessionStorage", {
         get() { const e = new Error("The operation is insecure."); e.name = "SecurityError"; throw e; },
       });`,
      ctx
    );
  } else {
    ctx.sessionStorage = almacenamiento;
  }

  guion.runInContext(ctx); // ← js/app.js, de la primera línea a la última

  const leer = (expresion) => vm.runInContext(expresion, ctx); // let/const del módulo
  const estado = () => ({
    vales: leer("allVales").map((v) => v.id),
    filas: el("vales-body").children.length,
    contador: el("total-count").textContent,
    cargando: !el("loading").hidden,
    avisoLento: el("loading").classList.contains("loading--slow"),
    error: !el("app-error").hidden,
    botones: [el("btn-actualizar").disabled, el("btn-dash-actualizar").disabled],
  });
  return { app: ctx, el, leer, estado, lecturas, reg, documento, almacenamiento };
}

/* App ya dentro (PIN puesto) y con la carga inicial resuelta sin vales. */
async function appEnUso(opciones) {
  const c = cargarApp(opciones);
  c.el("pin-input").value = PIN;
  await c.el("pin-form").disparar("submit");
  assert.equal(c.lecturas.length, 1, "entrar lanza la carga inicial");
  c.lecturas[0].resolve(instantanea());
  await hasta(() => !c.estado().cargando, "la carga inicial");
  return c;
}

const pinALaVista = (c) => !c.el("pin-screen").hidden && c.el("app-screen").hidden;
const cargaCompleta = (c) =>
  // Lo ÚLTIMO que hace el módulo es registrar estos listeners y botones: si
  // la evaluación se cortara a medias, no existirían.
  (c.el("vale-form").listeners.submit || []).length === 1 &&
  c.el("denoms").children.length === CONFIG.MONTOS.length &&
  (c.el("btn-excel").listeners.click || []).length === 1 &&
  typeof c.app.catSlug === "function";

// ============================================================================
console.log("\n== a) El QR se abre antes de que termine loadVales() ==");
// ============================================================================

await test("completarRegistro() abre el QR y NO espera a la recarga del historial", async () => {
  const c = await appEnUso();
  const fin = c.app.completarRegistro(registroGuardado());
  assert.equal(await terminaSola(fin), "termina", "se quedó esperando a loadVales()");

  assert.equal(c.el("qr-modal").hidden, false, "el QR ya está a la vista");
  assert.equal(c.el("qr-nombre").textContent, "Persona Uno");
  assert.equal(c.el("qr-code").textContent, "Folio: 900001");
  assert.equal(c.el("qr-progress").textContent, "Vale 1 de 2");
  // …con la lectura todavía en vuelo y el historial sin tocar.
  assert.equal(c.lecturas.length, 2, "la recarga se lanzó");
  assert.deepEqual(c.estado().vales, []);
  assert.equal(c.estado().cargando, true);
});

await test("el orden es QR primero, lectura después", async () => {
  const c = await appEnUso();
  await c.app.completarRegistro(registroGuardado());
  // qrAbiertoAlLeer anota si el modal ya estaba abierto al EMPEZAR cada lectura.
  assert.deepEqual(c.reg.qrAbiertoAlLeer, [false, true]);
});

await test("cuando la lectura lenta por fin llega, el historial se pinta y el QR sigue abierto", async () => {
  const c = await appEnUso();
  await c.app.completarRegistro(registroGuardado());
  c.lecturas[1].resolve(instantanea(vale("1", 15), vale("2", 16)));
  await hasta(() => !c.estado().cargando, "la recarga tras guardar");
  assert.deepEqual(c.estado().vales, ["2", "1"]); // más reciente primero
  assert.equal(c.estado().filas, 2);
  assert.equal(c.el("qr-modal").hidden, false);
  assert.deepEqual(c.estado().botones, [false, false]);
});

await test("si esa recarga falla, el QR sigue abierto y el error lo muestra loadVales()", async () => {
  const c = await appEnUso();
  await c.app.completarRegistro(registroGuardado());
  c.lecturas[1].reject(new Error("red caída (simulada)"));
  await hasta(() => c.lecturas.length === 3, "el reintento de lectura");
  c.lecturas[2].reject(new Error("red caída (simulada)"));
  await hasta(() => c.estado().error, "el error de carga");
  assert.equal(c.el("qr-modal").hidden, false, "el QR es la única copia del vale recién emitido");
  assert.match(c.el("app-error").textContent, /cargar el historial/);
});

await test("guardado que llega tarde (tiempo agotado): al confirmarse abre el QR sin esperar la recarga", async () => {
  // Es el camino donde estaba el hueco: aquí `saving` ya es false, así que
  // mientras se esperaba a loadVales() nada impedía recargar la página.
  const c = await appEnUso();
  let confirmar;
  const commitPendiente = new Promise((r) => (confirmar = r));
  const registro = registroGuardado();
  c.app.vigilarRegistroIncierto(registro, commitPendiente);
  assert.equal(c.el("guardado-incierto").hidden, false);
  assert.equal(c.el("qr-modal").hidden, true);
  assert.equal(c.app.isSafeToReload(), true, "sin datos a medias ni commits contados en esta simulación");

  confirmar();
  await hasta(() => !c.el("qr-modal").hidden, "el QR tras el commit tardío");
  assert.equal(c.el("guardado-incierto").hidden, true);
  assert.equal(c.leer("registroIncierto"), null);
  assert.equal(c.lecturas.length, 2, "la recarga sigue en vuelo");
  assert.equal(c.estado().cargando, true);
  assert.equal(c.app.isSafeToReload(), false, "con el QR abierto no se recarga");
});

await test("completarRegistro() ya no espera a loadVales() en el código", () => {
  const i = appCode.indexOf("async function completarRegistro(");
  const cuerpo = appCode.slice(i, appCode.indexOf("function falloRegistroIncierto(", i));
  assert.doesNotMatch(cuerpo, /await\s+loadVales\(/);
  assert.ok(cuerpo.indexOf("openQrModal(reg.savedVales)") < cuerpo.indexOf("loadVales()"), "QR antes que la recarga");
});

// ============================================================================
console.log("\n== b) isSafeToReload() con el modal del QR abierto ==");
// ============================================================================

await test("en reposo es true; con el QR abierto es false; al cerrarlo vuelve a true", async () => {
  const c = await appEnUso();
  assert.equal(c.app.isSafeToReload(), true, "punto de partida: nada a medias");
  c.app.openQrModal([valeGuardado("900001", 200)]);
  assert.equal(c.el("qr-modal").hidden, false);
  assert.equal(c.app.isSafeToReload(), false);
  c.app.closeQrModal();
  assert.equal(c.app.isSafeToReload(), true);
});

await test("es false justo después de guardar, mientras el historial aún se recarga", async () => {
  const c = await appEnUso();
  await c.app.completarRegistro(registroGuardado());
  assert.equal(c.estado().cargando, true);
  assert.equal(c.app.isSafeToReload(), false);
});

await test("una versión nueva NO recarga encima del QR; recarga sola al cerrarlo", async () => {
  const c = await appEnUso({ versiones: ["prueba-1", "prueba-2"] });
  await hasta(() => c.leer("knownAppVersion") === "prueba-1", "la primera lectura de version.json");
  await c.app.completarRegistro(registroGuardado()); // QR abierto, recarga en vuelo

  await c.app.checkAppVersion(); // el servidor ya anuncia «prueba-2»
  assert.equal(c.leer("updatePendiente"), true, "la versión nueva se detectó");
  assert.equal(c.reg.recargas, 0, "no se recarga con el QR a la vista");
  assert.equal(c.el("update-banner").hidden, false, "se avisa y se espera");

  const vigilante = c.reg.intervalos.at(-1); // el setInterval de tryAutoReload
  vigilante();
  vigilante();
  assert.equal(c.reg.recargas, 0, "sigue sin recargar mientras el QR esté abierto");

  c.app.closeQrModal();
  vigilante();
  assert.equal(c.reg.recargas, 1, "cerrado el QR, se actualiza sin preguntar");
});

// ============================================================================
console.log("\n== c) sessionStorage que lanza: el módulo carga y pide el PIN ==");
// ============================================================================

for (const [caso, crear] of [
  ["el acceso a sessionStorage lanza (cookies bloqueadas)", () => ACCESO_LANZA],
  ["getItem/setItem lanzan (modo privado antiguo)", almacenamientoQueLanza],
]) {
  await test(`${caso}: el módulo termina de cargar y muestra el PIN`, () => {
    const c = cargarApp({ almacenamiento: crear() }); // lanzaría aquí si la evaluación se cortara
    assert.ok(cargaCompleta(c), "el módulo se evaluó hasta la última línea");
    assert.ok(pinALaVista(c), "pide el PIN");
    assert.equal(c.lecturas.length, 0, "sin PIN no se lee nada");
    assert.equal(c.reg.inventarioIniciado, 0);
  });

  await test(`${caso}: con el PIN correcto se entra y la app funciona`, async () => {
    const c = cargarApp({ almacenamiento: crear() });
    c.el("pin-input").value = "9999";
    await c.el("pin-form").disparar("submit");
    assert.ok(pinALaVista(c), "un PIN incorrecto no entra");
    assert.equal(c.el("pin-error").hidden, false);

    c.el("pin-input").value = PIN;
    await c.el("pin-form").disparar("submit"); // unlock() no debe lanzar al guardar
    assert.equal(c.el("pin-screen").hidden, true);
    assert.equal(c.el("app-screen").hidden, false);
    assert.equal(c.reg.inventarioIniciado, 1, "el inventario se conecta");
    assert.equal(c.lecturas.length, 1, "y se cargan los vales");
    c.lecturas[0].resolve(instantanea(vale("1", 15)));
    await hasta(() => !c.estado().cargando, "la carga inicial");
    assert.deepEqual(c.estado().vales, ["1"]);
    assert.equal(c.estado().error, false);
  });

  await test(`${caso}: se pide el PIN en CADA carga`, async () => {
    const almacenamiento = crear();
    const primera = cargarApp({ almacenamiento });
    primera.el("pin-input").value = PIN;
    await primera.el("pin-form").disparar("submit");
    assert.equal(primera.el("app-screen").hidden, false);
    const segunda = cargarApp({ almacenamiento }); // «recargar la página»
    assert.ok(pinALaVista(segunda));
    assert.equal(segunda.lecturas.length, 0);
  });
}

await test("con almacenamiento normal nada cambia: entrar lo recuerda y la siguiente carga no pide PIN", async () => {
  const almacenamiento = almacenamientoNormal();
  const primera = cargarApp({ almacenamiento });
  assert.ok(pinALaVista(primera));
  primera.el("pin-input").value = PIN;
  await primera.el("pin-form").disparar("submit");
  assert.equal(almacenamiento.datos.get("vales_unlocked"), "1");

  // La segunda carga entra sola: unlock() y loadVales() corren DURANTE la
  // evaluación del módulo, antes de llegar a la línea donde se define
  // loadVales. Si el contador de solicitudes se declarase allí, esto lanzaría.
  const segunda = cargarApp({ almacenamiento });
  assert.ok(cargaCompleta(segunda));
  assert.equal(segunda.el("pin-screen").hidden, true);
  assert.equal(segunda.el("app-screen").hidden, false);
  assert.equal(segunda.lecturas.length, 1);
  assert.equal(segunda.reg.inventarioIniciado, 1);
});

await test("ya no queda ningún acceso a sessionStorage sin try/catch", () => {
  // Todos los usos viven en funciones que los envuelven.
  const usos = [...appCode.matchAll(/sessionStorage\./g)].map((m) => m.index);
  assert.equal(usos.length, 4, "se esperaban 4 usos (desbloqueo y sello de recarga)");
  for (const i of usos) {
    const antes = appCode.slice(0, i);
    const tryAbierto = antes.lastIndexOf("try {");
    assert.ok(tryAbierto > antes.lastIndexOf("catch ("), "uso de sessionStorage fuera de un try");
    assert.ok(tryAbierto > antes.lastIndexOf("\nfunction "), "el try es el de su propia función");
  }
});

// ============================================================================
console.log("\n== d) Dos loadVales() cruzadas: gana la más reciente ==");
// ============================================================================

const VIEJA = () => instantanea(vale("1", 10));
const NUEVA = () => instantanea(vale("1", 10, { anulado: true }), vale("2", 12), vale("3", 14));

await test("la vieja responde DESPUÉS: no pisa los datos de la más reciente", async () => {
  const c = await appEnUso();
  const primera = c.app.loadVales(); // lectura 1 (se queda atrás)
  const segunda = c.app.loadVales(); // lectura 2 (la más reciente)
  assert.deepEqual(c.estado().botones, [true, true]);

  c.lecturas[2].resolve(NUEVA());
  await segunda;
  const trasLaNueva = c.estado();
  assert.deepEqual(trasLaNueva.vales, ["3", "2", "1"]);
  assert.equal(trasLaNueva.contador, "2", "vigentes: el vale 1 ya figura anulado");
  assert.deepEqual(trasLaNueva.botones, [false, false]);
  assert.equal(trasLaNueva.cargando, false);

  c.lecturas[1].resolve(VIEJA()); // llega tarde, con el vale 1 todavía «activo»
  await primera;
  assert.deepEqual(c.estado(), trasLaNueva, "la respuesta vieja se descartó sin tocar nada");
  assert.equal(c.leer("allVales").find((v) => v.id === "1").anulado, true);
});

await test("la vieja responde ANTES: se descarta y los botones siguen bloqueados hasta la reciente", async () => {
  const c = await appEnUso();
  const primera = c.app.loadVales();
  const segunda = c.app.loadVales();

  c.lecturas[1].resolve(VIEJA());
  await primera;
  const enEspera = c.estado();
  assert.deepEqual(enEspera.vales, [], "no se pinta una respuesta ya superada");
  assert.equal(enEspera.filas, 0);
  assert.deepEqual(enEspera.botones, [true, true], "la carga reciente sigue en curso");
  assert.equal(enEspera.cargando, true);

  c.lecturas[2].resolve(NUEVA());
  await segunda;
  assert.deepEqual(c.estado().vales, ["3", "2", "1"]);
  assert.deepEqual(c.estado().botones, [false, false]);
  assert.equal(c.estado().cargando, false);
});

await test("la vieja FALLA después: ni error rojo ni aviso de conexión lenta sobre datos ya cargados", async () => {
  const c = await appEnUso();
  const primera = c.app.loadVales();
  const segunda = c.app.loadVales();
  c.lecturas[2].resolve(NUEVA());
  await segunda;
  const trasLaNueva = c.estado();

  c.lecturas[1].reject(new Error("red caída (simulada)"));
  await hasta(() => c.lecturas.length === 4, "el reintento de la carga vieja");
  assert.deepEqual(c.estado(), trasLaNueva, "su reintento no vuelve a mostrar «Conexión lenta»");
  c.lecturas[3].reject(new Error("red caída (simulada)"));
  await primera; // se descarta en silencio: no lanza
  assert.deepEqual(c.estado(), trasLaNueva);
  assert.equal(c.el("loading").textContent, "Conectando con la base de datos…");
});

await test("la reciente falla y la vieja llega después con datos: manda la reciente (su error)", async () => {
  const c = await appEnUso();
  const primera = c.app.loadVales();
  const segunda = c.app.loadVales();
  c.lecturas[2].reject(new Error("red caída (simulada)"));
  await hasta(() => c.lecturas.length === 4, "el reintento de la carga reciente");
  c.lecturas[3].reject(new Error("red caída (simulada)"));
  await segunda;
  assert.equal(c.estado().error, true);
  assert.deepEqual(c.estado().botones, [false, false], "se puede pulsar «Actualizar»");

  c.lecturas[1].resolve(VIEJA());
  await primera;
  assert.deepEqual(c.estado().vales, [], "la vieja no asigna allVales");
  assert.equal(c.estado().error, true, "ni borra el error de la más reciente");
});

await test("tres seguidas: sólo la última pinta, llegue en el orden que llegue", async () => {
  const c = await appEnUso();
  const cargas = [c.app.loadVales(), c.app.loadVales(), c.app.loadVales()];
  c.lecturas[2].resolve(instantanea(vale("7", 11)));
  c.lecturas[3].resolve(NUEVA());
  c.lecturas[1].resolve(VIEJA());
  await Promise.all(cargas);
  assert.deepEqual(c.estado().vales, ["3", "2", "1"]);
  assert.deepEqual(c.estado().botones, [false, false]);
  assert.equal(c.leer("solicitudVales"), 4, "inicial + tres");
});

await test("una carga sola se comporta como siempre, con su aviso de reintento", async () => {
  const c = await appEnUso();
  const carga = c.app.loadVales();
  assert.equal(c.estado().cargando, true);
  assert.deepEqual(c.estado().botones, [true, true]);

  c.lecturas[1].reject(new Error("red caída (simulada)"));
  await hasta(() => c.lecturas.length === 3, "el reintento");
  assert.equal(c.el("loading").textContent, "Conexión lenta, reintentando…");
  assert.equal(c.estado().avisoLento, true);
  assert.equal(c.estado().error, false, "todavía no es un error");

  c.lecturas[2].resolve(NUEVA());
  await carga;
  assert.deepEqual(c.estado().vales, ["3", "2", "1"]);
  assert.equal(c.estado().avisoLento, false);
  assert.equal(c.el("loading").textContent, "Conectando con la base de datos…");
  assert.equal(c.estado().cargando, false);
  assert.deepEqual(c.estado().botones, [false, false]);
});

await test("loadVales() sigue con lectura puntual del servidor y un reintento; sin onSnapshot", () => {
  const i = appCode.indexOf("async function loadVales(");
  const cuerpo = appCode.slice(i, appCode.indexOf("for (const btn of refreshButtons) btn.addEventListener", i));
  assert.match(cuerpo, /withRetry\(\(\) => getDocsFromServer\(valesRef\)/);
  assert.equal((cuerpo.match(/getDocsFromServer\(/g) || []).length, 1);
  assert.match(cuerpo, /mensajeError\(err, "cargar el historial"\)/);
  assert.doesNotMatch(appCode, /onSnapshot/);
});

// ============================================================================
await esperar(20);
await test("ninguna promesa quedó rechazada sin atender", () => {
  assert.deepEqual(rechazosSinAtender.map(String), []);
});

console.log(process.exitCode ? "\n❌ Hay fallos" : `\n✅ ${pass} comprobaciones OK`);
// Varias pruebas dejan a propósito una lectura simulada sin responder (es la
// «lectura lenta»). Se sale aquí para no esperar a que agoten su tiempo.
process.exit(process.exitCode || 0);
