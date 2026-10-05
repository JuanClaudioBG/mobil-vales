// ============================================================================
//  Verificación de la anulación frente a una conexión mala
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO (las rutas son relativas):
//
//      node tests/verify-anular-conexion.mjs
//
//  Sólo Node, sin dependencias ni framework, como el resto de tests/.
//
//  El fallo que se cierra aquí: existeFolio() devolvía false ante CUALQUIER
//  error de lectura, así que un fallo de red se confundía con "ese folio ya no
//  existe". Al anular, el vale quedaba marcado como anulado y el folio se
//  quedaba en 'asignado' PARA SIEMPRE, apuntando a un vale anulado. Esa
//  combinación no se puede deshacer desde la aplicación (un vale anulado ya no
//  ofrece Anular, y Aprobar sólo pasa de 'revision_requerida' a 'disponible'),
//  así que había que arreglarla a mano en la consola de Firebase.
//
//  Se comprueba que:
//   1. existeFolio lee del servidor, reintenta y LANZA en vez de tragarse el
//      error;
//   2. si esa lectura falla, anularVale NO escribe nada;
//   3. la tabla de Admin tampoco puede salir vacía por una conexión mala;
//   4. las escrituras tienen tiempo de espera, NO se reintentan, y cuando el
//      tiempo se agota el mensaje pide COMPROBAR en vez de repetir.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";

import { withTimeout, withRetry } from "../js/utils.js";

if (!fs.existsSync("js/app.js")) {
  console.error(
    "Ejecuta este script desde la raíz del repo: node tests/verify-anular-conexion.mjs"
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

// Los comentarios NOMBRAN las APIs que se quieren evitar ("en vez de getDoc"),
// así que el análisis estático va sobre el código SIN comentarios.
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const appCode = soloCodigo(app);
const invCode = soloCodigo(inv);

/* Extrae una función equilibrando llaves, para poder EVALUARLA con
   dependencias simuladas en vez de limitarse a buscar texto. Quita el `export`
   inicial: `new Function` no admite declaraciones de módulo. */
function extraerFuncion(src, firma) {
  const inicio = src.indexOf(firma);
  assert.ok(inicio !== -1, `no se encontró la función: ${firma}`);
  const abre = src.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < src.length; i++) {
    if (src[i] === "{") nivel++;
    else if (src[i] === "}") {
      nivel--;
      if (nivel === 0) return src.slice(inicio, i + 1).replace(/^export\s+/, "");
    }
  }
  throw new Error(`función sin cerrar: ${firma}`);
}

// ===========================================================================
console.log("\n== 1. existeFolio ya no se traga los errores ==");
// ===========================================================================

const existeFolioSrc = extraerFuncion(invCode, "export async function existeFolio(");

test("lee del servidor y con reintento", () => {
  assert.match(existeFolioSrc, /withRetry\(/);
  assert.match(existeFolioSrc, /getDocFromServer\(/);
  assert.ok(
    !/\bgetDoc\(/.test(existeFolioSrc),
    "getDoc() se conforma con la caché local, que en esta app está vacía"
  );
});

test("no queda ningún catch que devuelva false", () => {
  assert.ok(
    !/catch/.test(existeFolioSrc),
    "tragarse el error es justo lo que convertía 'sin red' en 'no existe'"
  );
});

function construirExisteFolio({ lanza, existe }) {
  const fabrica = new Function(
    "withRetry",
    "getDocFromServer",
    "inventarioDocRef",
    `${existeFolioSrc}; return existeFolio;`
  );
  return fabrica(
    withRetry,
    async () => {
      if (lanza) throw Object.assign(new Error("Connection failed."), { code: "unavailable" });
      return { exists: () => existe };
    },
    (f) => ({ folio: f })
  );
}

await testAsync("un folio presente devuelve true", async () => {
  assert.equal(await construirExisteFolio({ existe: true })("117765"), true);
});

await testAsync("un folio BORRADO devuelve false (no es un error)", async () => {
  // Distinguir "no está" de "no se pudo leer" es justamente el objetivo.
  assert.equal(await construirExisteFolio({ existe: false })("117765"), false);
});

await testAsync("si no se puede leer, LANZA (no devuelve false)", async () => {
  const existeFolio = construirExisteFolio({ lanza: true });
  await assert.rejects(() => existeFolio("117765"), /Connection failed/);
});

// ===========================================================================
console.log("\n== 2. anularVale no anula si no puede leer el inventario ==");
// ===========================================================================

const anularSrc = extraerFuncion(appCode, "async function anularVale(");

/* Evalúa la anularVale REAL con todo simulado, y DEVUELVE lo que escribió.
   `escenario` decide qué hace la comprobación del folio y el commit. */
function construirAnular(escenario) {
  const registro = { updates: [], commits: 0, alertas: [], toasts: [], recargas: 0 };
  const batch = {
    update: (ref, datos) => registro.updates.push({ ref, datos }),
  };
  const fabrica = new Function(
    "requestAdminPin", "existeFolio", "writeBatch", "doc", "serverTimestamp",
    "inventarioDocRef", "camposDevolucion", "commitConTiempo", "refrescarInventario",
    "showToast", "loadVales", "formatFolio", "alert", "db", "COLLECTION", "console",
    `${anularSrc}; return anularVale;`
  );
  const anularVale = fabrica(
    async () => escenario.pin !== false,
    async () => {
      if (escenario.lecturaFalla) throw new Error("Connection failed.");
      return escenario.folioExiste !== false;
    },
    () => batch,
    (_db, _col, id) => ({ tipo: "vale", id }),
    () => "TS",
    (f) => ({ tipo: "inventario", folio: f }),
    () => ({ status: "disponible", asignadoA: null, asignadoEn: null, batchId: null }),
    async () => {
      registro.commits++;
      if (escenario.commitFalla) {
        return { ok: false, err: new Error("boom"), incierto: Boolean(escenario.incierto) };
      }
      return { ok: true };
    },
    async () => {},
    (m) => registro.toasts.push(m),
    async () => registro.recargas++,
    (f) => String(f),
    (m) => registro.alertas.push(m),
    {}, "vales",
    { error: () => {}, warn: () => {}, log: () => {} }
  );
  return { anularVale, registro };
}

const MENSAJE = "No se pudo anular, revisa tu conexión e intenta de nuevo";

await testAsync("lectura del folio caída ⇒ NI UNA escritura", async () => {
  const { anularVale, registro } = construirAnular({ lecturaFalla: true });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.equal(registro.commits, 0, "no debe llegar a confirmar el lote");
  assert.equal(registro.updates.length, 0, "no debe preparar ninguna escritura");
  assert.deepEqual(registro.alertas, [MENSAJE]);
  assert.deepEqual(registro.toasts, [], "no debe decir que se anuló");
});

await testAsync("el vale NO se marca anulado si no se pudo leer el folio", async () => {
  const { anularVale, registro } = construirAnular({ lecturaFalla: true });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  const tocaVale = registro.updates.some((u) => u.ref.tipo === "vale");
  assert.equal(tocaVale, false, "este era EXACTAMENTE el fallo: se anulaba igual");
});

await testAsync("camino normal: anula el vale y devuelve el folio en UN lote", async () => {
  const { anularVale, registro } = construirAnular({ folioExiste: true });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.equal(registro.commits, 1);
  assert.equal(registro.updates.length, 2, "el vale y el folio, juntos");
  const vale = registro.updates.find((u) => u.ref.tipo === "vale");
  const folio = registro.updates.find((u) => u.ref.tipo === "inventario");
  assert.equal(vale.datos.anulado, true);
  assert.equal(folio.datos.status, "disponible");
  assert.match(registro.toasts[0], /devuelto al inventario/);
  assert.deepEqual(registro.alertas, []);
});

await testAsync("folio realmente borrado: anula el vale y no toca inventario", async () => {
  // Comportamiento histórico que hay que conservar (folios de pruebas viejas).
  const { anularVale, registro } = construirAnular({ folioExiste: false });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.equal(registro.commits, 1);
  assert.equal(registro.updates.length, 1);
  assert.equal(registro.updates[0].ref.tipo, "vale");
  assert.deepEqual(registro.toasts, ["✅ Vale anulado"]);
});

await testAsync("vale sin folio: ni se comprueba el inventario", async () => {
  const { anularVale, registro } = construirAnular({ lecturaFalla: true });
  await anularVale({ id: "v1", nombre: "Karen", folio: null });
  assert.equal(registro.commits, 1, "sin folio no hay nada que leer");
  assert.equal(registro.updates.length, 1);
});

await testAsync("si el commit falla, no se anuncia como anulado", async () => {
  const { anularVale, registro } = construirAnular({ folioExiste: true, commitFalla: true });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.deepEqual(registro.alertas, [MENSAJE]);
  assert.deepEqual(registro.toasts, []);
  assert.equal(registro.recargas, 0);
});

await testAsync("si el commit AGOTA EL TIEMPO, el mensaje pide comprobar", async () => {
  /* Agotar el tiempo no cancela la escritura: puede haber llegado igual.
     Decir "inténtalo de nuevo" invitaría a repetir una anulación que quizá ya
     ocurrió. */
  const { anularVale, registro } = construirAnular({
    folioExiste: true, commitFalla: true, incierto: true,
  });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.equal(registro.alertas.length, 1);
  assert.match(registro.alertas[0], /Puede que SÍ se haya anulado/);
  assert.ok(
    !/intenta de nuevo/.test(registro.alertas[0]),
    "no se debe invitar a repetir una escritura que pudo llegar"
  );
});

await testAsync("si se cancela el PIN no pasa nada", async () => {
  const { anularVale, registro } = construirAnular({ pin: false });
  await anularVale({ id: "v1", nombre: "Karen", folio: "117765" });
  assert.equal(registro.commits, 0);
  assert.deepEqual(registro.alertas, []);
});

// ===========================================================================
console.log("\n== 3. La tabla de Admin no puede salir vacía por la conexión ==");
// ===========================================================================

test("cargarTodos lee del servidor y con reintento", () => {
  const cargarTodos = extraerFuncion(invCode, "async function cargarTodos(");
  assert.match(cargarTodos, /withRetry\(/);
  assert.match(cargarTodos, /getDocsFromServer\(inventarioRef\)/);
  assert.ok(
    !/\bgetDocs\(/.test(cargarTodos),
    "con getDocs() una conexión mala pintaba la tabla VACÍA en vez de avisar"
  );
});

test("sigue trayendo y ordenando lo mismo: la tabla no cambia", () => {
  const cargarTodos = extraerFuncion(invCode, "async function cargarTodos(");
  assert.match(cargarTodos, /todos = snap\.docs\.map/);
  assert.match(cargarTodos, /todos\.sort\(/);
  assert.match(cargarTodos, /todosCargados = true/);
  // Y se sigue cargando sólo al abrir la pestaña.
  assert.match(appCode, /if \(target === "inventario"\) renderInventarioAdmin\(\);/);
});

test("el botón «Actualizar» del inventario no se come los fallos", () => {
  /* Era `cargarTodos(true).then(renderInventario)`, sin catch. Con getDocs()
     la lectura nunca fallaba (se resolvía con la caché), así que no se notaba;
     leyendo del servidor sí puede fallar, y el rechazo se habría perdido
     dejando la tabla callada. Ahora pasa por quien sí pinta el error. */
  assert.match(invCode, /refreshBtn\.addEventListener\("click", \(\) => renderInventarioAdmin\(true\)\)/);
  assert.ok(
    !/cargarTodos\(true\)\.then\(/.test(invCode),
    "un .then() pelado se traga el fallo"
  );
  // Y sigue forzando la recarga, no devolviendo la lista cacheada.
  const render = extraerFuncion(invCode, "export async function renderInventarioAdmin(");
  assert.match(render, /renderInventarioAdmin\(force = false\)/);
  assert.match(render, /cargarTodos\(force\)/);
});

test("el error de carga se sigue mostrando en la sección de Admin", () => {
  const render = extraerFuncion(invCode, "export async function renderInventarioAdmin(");
  assert.match(render, /catch/);
  assert.match(render, /showError\(/);
});

// ===========================================================================
console.log("\n== 4. Escrituras: con tiempo de espera y SIN reintento ==");
// ===========================================================================

test("withTimeout marca sus errores para poder distinguirlos", () => {
  const u = fs.readFileSync("js/utils.js", "utf8");
  assert.match(u, /err\.esTimeout = true/);
});

await testAsync("un error de servidor NO queda marcado como tiempo agotado", async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(Object.assign(new Error("x"), { code: "unavailable" })), 500),
    (e) => e.esTimeout === undefined && e.code === "unavailable"
  );
});

await testAsync("el tiempo agotado sí queda marcado", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 30),
    (e) => e.esTimeout === true
  );
});

const commitSrc = extraerFuncion(appCode, "async function commitConTiempo(");

test("commitConTiempo pone tiempo de espera y NO reintenta", () => {
  assert.match(commitSrc, /withTimeout\(batch\.commit\(\)\)/);
  assert.ok(
    !/withRetry/.test(commitSrc),
    "reintentar una escritura puede duplicar vales: si el primer intento llegó " +
      "y sólo se perdió la respuesta, el segundo crea otro registro"
  );
  assert.equal(
    (commitSrc.match(/\.commit\(\)/g) || []).length,
    1,
    "una sola llamada a commit()"
  );
  assert.match(commitSrc, /incierto: Boolean\(err && err\.esTimeout\)/);
});

await testAsync("commitConTiempo distingue ok / fallo / incierto", async () => {
  const fabrica = new Function("withTimeout", `${commitSrc}; return commitConTiempo;`);
  const commitConTiempo = fabrica(withTimeout);

  assert.deepEqual(await commitConTiempo({ commit: async () => {} }), { ok: true });

  const servidor = await commitConTiempo({
    commit: async () => { throw Object.assign(new Error("denied"), { code: "permission-denied" }); },
  });
  assert.equal(servidor.ok, false);
  assert.equal(servidor.incierto, false, "un no del servidor es concluyente");

  // Tiempo agotado: se simula con la misma marca que pone withTimeout, para no
  // tener que esperar los 30 s reales dentro del test.
  const colgado = await commitConTiempo({
    commit: async () => { throw Object.assign(new Error("tarde"), { esTimeout: true }); },
  });
  assert.equal(colgado.ok, false);
  assert.equal(colgado.incierto, true, "hay que avisar de que pudo guardarse igual");
});

test("doSave y anularVale confirman a través de commitConTiempo", () => {
  const doSave = extraerFuncion(appCode, "async function doSave(");
  assert.match(doSave, /commitConTiempo\(batch\)/);
  assert.ok(!/await batch\.commit\(\)/.test(doSave), "ya no confirma a pelo");
  assert.match(doSave, /commit\.ok/);

  assert.match(anularSrc, /commitConTiempo\(batch\)/);
  assert.ok(!/await batch\.commit\(\)/.test(anularSrc), "ya no confirma a pelo");
});

test("al guardar, el tiempo agotado avisa de que puede haberse guardado", () => {
  const doSave = extraerFuncion(appCode, "async function doSave(");
  assert.match(doSave, /incierto/);
  assert.match(app, /Puede que los vales SÍ se hayan/);
  assert.match(app, /revisa el historial antes de volver a/);
});

test("las importaciones del PDF siguen sin tocarse", () => {
  // Fuera de alcance: no se ha cambiado el lote de importación.
  const importar = extraerFuncion(invCode, "async function importarPdf(");
  assert.match(importar, /await batch\.commit\(\);/);
});

// ===========================================================================
console.log("\n== 5. Nada fuera de alcance ==");
// ===========================================================================

test("no se tocaron las reglas ni los índices", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync("firestore.indexes.json", "utf8")), {
    indexes: [],
    fieldOverrides: [],
  });
});

test("el repo sigue sin dependencias", () => {
  assert.ok(!fs.existsSync("package.json"));
  assert.ok(!fs.existsSync("node_modules"));
});

console.log(`\n✅ ${pass} comprobaciones OK`);
