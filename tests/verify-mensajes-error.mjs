// ============================================================================
//  Mensajes de error para el encargado (mensajeError de js/utils.js)
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:   node tests/verify-mensajes-error.mjs
//  Sólo Node, sin dependencias. Prueba la función real y, sobre el fuente,
//  que los avisos de tiempo agotado no cambiaron y que el error técnico sigue
//  yendo a console.error.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import { mensajeError } from "../js/utils.js";

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
const conCodigo = (code) => Object.assign(new Error("texto técnico del SDK"), { code });

/* navigator.onLine sólo existe en el navegador; aquí se simula para probar
   los dos casos y se restaura al terminar. */
function conNavegador(onLine, fn) {
  const previo = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine }, configurable: true });
  try {
    fn();
  } finally {
    if (previo) Object.defineProperty(globalThis, "navigator", previo);
    else delete globalThis.navigator;
  }
}

const SIN_RED = "Sin conexión con el servidor. Revisa tu señal e inténtalo de nuevo.";
const CONCURRENCIA =
  "Otro celular cambió estos datos al mismo tiempo. Pulsa «Actualizar» e inténtalo de nuevo.";

console.log("\n== Traducción por código ==");

test("permission-denied", () => {
  assert.equal(
    mensajeError(conCodigo("permission-denied"), "anular el vale"),
    "No tienes permiso para anular el vale o el registro cambió. Pulsa «Actualizar» e " +
      "inténtalo de nuevo; si sigue, avisa al administrador."
  );
});
test("unavailable", () => assert.equal(mensajeError(conCodigo("unavailable"), "x"), SIN_RED));
test("deadline-exceeded", () => assert.equal(mensajeError(conCodigo("deadline-exceeded"), "x"), SIN_RED));
test("lectura con tiempo agotado (esTimeout, sin código) = sin red", () => {
  const err = Object.assign(new Error("Tiempo de espera agotado"), { esTimeout: true });
  assert.equal(mensajeError(err, "cargar el historial"), SIN_RED);
});
test("sin red en el navegador (navigator.onLine === false) y error sin código", () => {
  conNavegador(false, () => assert.equal(mensajeError(new Error("Failed to fetch"), "x"), SIN_RED));
});
test("con red y error sin código: genérico, sin paréntesis", () => {
  conNavegador(true, () =>
    assert.equal(mensajeError(new Error("boom"), "importar el PDF"), "No se pudo importar el PDF. Inténtalo de nuevo.")
  );
});
test("un código conocido manda sobre navigator.onLine", () => {
  conNavegador(false, () =>
    assert.match(mensajeError(conCodigo("permission-denied"), "abrir el vale"), /^No tienes permiso para abrir el vale/)
  );
});
test("failed-precondition", () => assert.equal(mensajeError(conCodigo("failed-precondition"), "x"), CONCURRENCIA));
test("aborted", () => assert.equal(mensajeError(conCodigo("aborted"), "x"), CONCURRENCIA));
test("otro código: genérico + código entre paréntesis al final", () => {
  assert.equal(
    mensajeError(conCodigo("invalid-argument"), "guardar el registro"),
    "No se pudo guardar el registro. Inténtalo de nuevo. (invalid-argument)"
  );
  assert.equal(
    mensajeError(conCodigo("resource-exhausted"), "cargar el inventario"),
    "No se pudo cargar el inventario. Inténtalo de nuevo. (resource-exhausted)"
  );
});
test("prefijo «firestore/» del código también se reconoce", () => {
  assert.equal(mensajeError(conCodigo("firestore/unavailable"), "x"), SIN_RED);
  assert.match(mensajeError(conCodigo("firestore/internal"), "x"), /\(internal\)$/);
});
test("err nulo, texto suelto o código no textual no rompen", () => {
  conNavegador(true, () => {
    assert.equal(mensajeError(null, "abrir el vale"), "No se pudo abrir el vale. Inténtalo de nuevo.");
    assert.equal(mensajeError("algo", "abrir el vale"), "No se pudo abrir el vale. Inténtalo de nuevo.");
    assert.equal(mensajeError({ code: 500 }, "abrir el vale"), "No se pudo abrir el vale. Inténtalo de nuevo.");
  });
});
test("nunca muestra el texto técnico del SDK", () => {
  for (const code of ["permission-denied", "unavailable", "aborted", "internal"]) {
    assert.doesNotMatch(mensajeError(conCodigo(code), "x"), /texto técnico/);
  }
});

console.log("\n== Uso en app.js e inventario.js ==");
const app = fs.readFileSync("js/app.js", "utf8");
const inv = fs.readFileSync("js/inventario.js", "utf8");

test("ya no se pide desplegar reglas en los mensajes", () => {
  assert.doesNotMatch(app, /despliega las reglas/i);
  assert.doesNotMatch(inv, /despliega las reglas/i);
});
test("cada mensaje visible usa mensajeError con su acción", () => {
  for (const accion of ["cargar el historial", "guardar el registro", "abrir el vale"]) {
    assert.ok(app.includes(`mensajeError(err, "${accion}")`), accion);
  }
  assert.ok(app.includes('mensajeError(commit.err, "anular el vale")'), "anular, rechazo concluyente");
  assert.equal((app.match(/mensajeError\(err, "anular el vale"\)/g) || []).length, 2, "anular: lectura previa y excepción");
  for (const accion of ["importar el PDF", "cargar el inventario"]) {
    assert.ok(inv.includes(`mensajeError(err, "${accion}")`), accion);
  }
  assert.ok(inv.includes("showError(mensajeImportacion(err));"), "la importación pasa por mensajeImportacion");
  assert.ok(inv.includes("mensajeError(err, `aprobar el folio ${formatFolio(folio)}`)"));
});
test("los avisos de tiempo agotado / guardado incierto siguen EXACTAMENTE igual", () => {
  for (const texto of [
    '"Se agotó el tiempo al anular. Puede que SÍ se haya anulado: " +\n' +
      '            "pulsa «Actualizar» y compruébalo antes de volver a intentarlo."',
    '"⏳ El guardado está tardando más de lo normal y sigue en curso. Puede que " +',
    '"Todavía no aparece confirmado en el servidor y el guardado sigue en curso. " +',
    '"No pudimos comprobar: revisa tu conexión. El guardado sigue en curso; no " +',
  ]) {
    assert.ok(app.includes(texto), texto.slice(0, 50));
  }
  // El aviso incierto de anular va ANTES de mensajeError: no se traduce.
  assert.match(app, /commit\.incierto\s*\?\s*"Se agotó el tiempo al anular[\s\S]*?:\s*mensajeError\(commit\.err, "anular el vale"\)/);
});
test("el error técnico completo sigue yendo a console.error", () => {
  const sitios = [
    [app, /console\.error\("Error al cargar los vales:", err\);\s*showAppError\(mensajeError/],
    [app, /console\.error\("\[vales\] no se pudo reabrir el vale:", err\);\s*alert\(mensajeError/],
    [app, /console\.error\("Error al comprobar el vale antes de anular:", err\);\s*alert\(mensajeError/],
    [app, /console\.error\("Error al anular:", commit\.err\);/],
    [app, /console\.error\("Error al anular:", err\);\s*alert\(mensajeError/],
    [app, /console\.error\("Error al guardar:", err\);\s*mostrarErrorGuardado\(err\)/],
    [inv, /console\.error\("\[inventario\] importación:", err\);/],
    [inv, /console\.error\("\[inventario\] carga:", err\);\s*showError\(mensajeError/],
    [inv, /console\.error\("\[inventario\] aprobación:", err\);/],
  ];
  for (const [src, re] of sitios) assert.match(src, re);
});

console.log("\n== Importar PDF: Firestore vs. errores del propio PDF ==");
/* Se evalúa la mensajeImportacion() REAL de inventario.js (el módulo importa
   el SDK desde gstatic y no se puede cargar en Node). */
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
const mensajeImportacion = new Function(
  "mensajeError",
  `${extraerFuncion(inv, "function mensajeImportacion(")}; return mensajeImportacion;`
)(mensajeError);

test("error del PDF/lector sin código: su mensaje tal cual", () => {
  const texto = "No se pudo cargar jsQR desde la CDN. Revisa la conexión e inténtalo de nuevo.";
  assert.equal(mensajeImportacion(new Error(texto)), texto);
  assert.equal(mensajeImportacion(new Error("Invalid PDF structure.")), "Invalid PDF structure.");
});
test("error de Firestore al guardar el lote: mensajeError", () => {
  assert.equal(
    mensajeImportacion(conCodigo("permission-denied")),
    "No tienes permiso para importar el PDF o el registro cambió. Pulsa «Actualizar» e " +
      "inténtalo de nuevo; si sigue, avisa al administrador."
  );
  assert.equal(mensajeImportacion(conCodigo("unavailable")), SIN_RED);
});
test("sin código ni mensaje: genérico", () => {
  conNavegador(true, () => {
    assert.equal(mensajeImportacion(new Error("")), "No se pudo importar el PDF. Inténtalo de nuevo.");
    assert.equal(mensajeImportacion(null), "No se pudo importar el PDF. Inténtalo de nuevo.");
  });
});

console.log(process.exitCode ? "\n❌ Hay fallos" : `\n✅ ${pass} comprobaciones OK`);
