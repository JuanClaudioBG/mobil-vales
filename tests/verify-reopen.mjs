// ============================================================================
//  Verificación focalizada de "reabrir un vale ya emitido"
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO (las rutas son relativas):
//
//      node tests/verify-reopen.mjs
//
//  Sólo Node, sin dependencias ni framework: el proyecto no tiene paso de
//  build y se publica tal cual en GitHub Pages, así que este archivo no se
//  carga desde index.html ni afecta a la app.
//
//  Comprueba dos cosas:
//   1. que el camino de reapertura NO escribe ni emite nada (análisis
//      estático sobre el código, ignorando los comentarios);
//   2. que valeParaModal() reconstruye el vale guardado tal cual (se evalúa
//      el código real con dependencias simuladas: en Node no hay DOM).
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-reopen.mjs");
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const inv = fs.readFileSync("js/inventario.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

let pass = 0;
const test = (name, fn) => {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; }
};
// Los comentarios NOMBRAN las APIs prohibidas ("no llama a makeQrCode()"), así
// que el análisis estático se hace sobre el código sin comentarios.
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const slice = (src, from, to) => {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  assert.ok(i >= 0 && j > i, "no se encontró el bloque " + from.slice(0, 40));
  return src.slice(i, j);
};

// Bloques bajo prueba.
const reopenSrc = slice(app, "//  Reabrir un vale YA EMITIDO", "// --- PIN de administrador");
const render = slice(app, "async function renderQrVale()", "// Pinta la imagen real del QR");
const lookupSrc = slice(inv, "export async function qrImagenDeFolio", "// Recarga el inventario tras devolver");
const reopen = soloCodigo(reopenSrc);
const lookup = soloCodigo(lookupSrc);

console.log("\n== Sintaxis (ESM) ==");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "valessyn-"));
for (const f of ["js/app.js", "js/inventario.js", "js/utils.js"]) {
  test("parsea " + f, () => {
    const dst = path.join(tmp, path.basename(f) + ".mjs");
    fs.writeFileSync(dst, fs.readFileSync(f));
    execFileSync(process.execPath, ["--check", dst]);
  });
}

console.log("\n== 4 / 6. Camino de reapertura: cero escrituras y cero emisión ==");
const PROHIBIDO = ["writeBatch", "setDoc", "addDoc", "updateDoc", "deleteDoc", "batch.set",
  "batch.update", "tomarFolios", "makeQrCode", "camposAsignacion", "camposDevolucion",
  "marcarAsignadosLocal", "serverTimestamp"];
for (const id of PROHIBIDO) {
  test("valeParaModal/Ver no usa " + id, () => assert.ok(!reopen.includes(id)));
  test("qrImagenDeFolio no usa " + id, () => assert.ok(!lookup.includes(id)));
}
test("la búsqueda de imagen sólo lee (getDoc)", () => {
  assert.ok(lookup.includes("getDoc(inventarioDocRef("));
  // Única API de Firestore permitida aquí: getDoc (+ la referencia al doc).
  const llamadas = [...lookup.matchAll(/\b(\w*Docs?|\w*DocRef)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(llamadas)].sort(), ["getDoc", "inventarioDocRef"]);
});
test("anularVale sólo se enlaza en el botón Anular, no al reabrir", () => {
  const verPath = slice(reopenSrc, "async function abrirValeExistente", "// Celda de acciones");
  assert.ok(!verPath.includes("anularVale"));
});

console.log("\n== 6. Vale anulado: sin Descargar ni Compartir ==");
test("el modal marca ANULADO y oculta las acciones", () => {
  assert.match(render, /qrAnulado\.hidden = !anulado/);
  assert.match(render, /qrShareActions\.hidden = anulado/);
  assert.match(render, /qrHint\.hidden = anulado/);
});
test("los manejadores de Descargar/Compartir salen si está anulado", () => {
  assert.match(render, /qrDownload\.onclick = \(\) => \{\s*\n\s*if \(anulado\) return;/);
  assert.match(render, /qrShare\.onclick = async \(\) => \{\s*\n\s*if \(anulado\) return;/);
});
test("index.html trae el aviso y los contenedores con id", () => {
  for (const id of ['id="qr-anulado"', 'id="qr-hint"', 'id="qr-share-actions"'])
    assert.ok(html.includes(id), "falta " + id);
});

console.log("\n== 2 / 8. Nunca se dibuja un QR falso para un vale con folio ==");
test("sin imagen y con folio se muestra texto, no un QR generado", () => {
  const i = render.indexOf("if (v.qrImageBase64)");
  const j = render.indexOf("} else if (v.folio) {", i);
  const k = render.indexOf("} else if (window.QRCode) {", i);
  assert.ok(j > i && k > j, "la rama del folio debe ir ANTES de la del QR generado");
});

console.log("\n== 1 / 2 / 3 / 7 / 8. Comportamiento de valeParaModal ==");
// Se evalúa el bloque real con dependencias simuladas (no hay DOM en node).
const stubEl = () => ({
  className: "", textContent: "", title: "", type: "", disabled: false,
  hijos: [], addEventListener() {}, appendChild(c) { this.hijos.push(c); },
});
let imagenRes = { ok: true, imagen: "BASE64REAL" };
const mod = new Function(
  "valeDate", "qrImagenDeFolio", "document", "openQrModal", "alert", "anularVale",
  reopenSrc + "\nreturn { sePuedeReabrir, fechaValeInputStr, valeParaModal, celdaAcciones };"
)(
  (v) => (v.fechaVale ? new Date(v.fechaVale) : null),
  async () => imagenRes,
  { createElement: stubEl },
  () => {}, () => {}, () => {}
);

const activoGenerado = {
  id: "a1", nombre: "Ana", categoria: "Empleado", monto: 500, fechaVale: "2026-08-20T12:00:00",
  qrCode: "SPECTRO-FUEL-2026-A3K9XM2P", anulado: false,
};
const activoFolio = {
  id: "a2", nombre: "Luis", categoria: "Familia", monto: 300, fechaVale: "2026-08-21T12:00:00",
  qrCode: "COMBUSA-1052", folio: "1052", vencimiento: "2026-12-31", anulado: false,
};
const anulado = { ...activoFolio, id: "a3", anulado: true };
const legacy = { id: "a4", nombre: "Old", categoria: "Empleado", monto: 200, fechaVale: "2024-01-05T12:00:00" };

test("1. vale activo con QR generado se reconstruye desde qrCode", async () => {
  const m = await mod.valeParaModal(activoGenerado);
  assert.equal(m.qrCode, "SPECTRO-FUEL-2026-A3K9XM2P");
  assert.equal(m.folio, null);
  assert.equal(m.qrImageBase64, null); // lo dibuja qrcode.js desde qrCode
  assert.equal(m.anulado, false);
  assert.equal(m.fechaStr, "2026-08-20");
});
test("2. vale activo con folio trae la imagen del inventario", async () => {
  imagenRes = { ok: true, imagen: "BASE64REAL" };
  const m = await mod.valeParaModal(activoFolio);
  assert.equal(m.qrImageBase64, "BASE64REAL");
  assert.equal(m.avisoQr, null);
});
test("3. el código/folio/vencimiento se conservan exactamente", async () => {
  const m = await mod.valeParaModal(activoFolio);
  assert.equal(m.qrCode, activoFolio.qrCode);
  assert.equal(m.folio, activoFolio.folio);
  assert.equal(m.vencimiento, activoFolio.vencimiento);
  assert.equal(m.monto, activoFolio.monto);
  assert.equal(m.nombre, activoFolio.nombre);
});
test("5. el vale anulado se puede ver y llega marcado", async () => {
  const m = await mod.valeParaModal(anulado);
  assert.equal(m.anulado, true);
  assert.equal(m.folio, "1052");
});
test("7. vale antiguo sin qrCode ni folio no ofrece Ver", () => {
  assert.equal(mod.sePuedeReabrir(legacy), false);
  assert.equal(mod.sePuedeReabrir(activoGenerado), true);
  const celda = mod.celdaAcciones(legacy, { conAnular: true });
  const textos = celda.hijos[0].hijos.map((b) => b.textContent);
  assert.deepEqual(textos, ["Anular"]);
});
test("3b. Ver va antes que Anular en los vales activos", () => {
  const celda = mod.celdaAcciones(activoGenerado, { conAnular: true });
  assert.deepEqual(celda.hijos[0].hijos.map((b) => b.textContent), ["Ver", "Anular"]);
});
test("5b. el vale anulado sólo ofrece Ver", () => {
  const celda = mod.celdaAcciones(anulado, { conAnular: false });
  assert.deepEqual(celda.hijos[0].hijos.map((b) => b.textContent), ["Ver"]);
});
test("8a. folio sin imagen: aviso, sin QR y sin reemplazo", async () => {
  imagenRes = { ok: false, motivo: "no-existe" };
  const m = await mod.valeParaModal(activoFolio);
  assert.equal(m.qrImageBase64, null);
  assert.match(m.avisoQr, /ya no está en el inventario/);
  assert.equal(m.folio, "1052"); // el folio original se conserva
});
test("8b. fallo de lectura: mensaje distinto de 'no existe'", async () => {
  imagenRes = { ok: false, motivo: "error" };
  const m = await mod.valeParaModal(activoFolio);
  assert.match(m.avisoQr, /conexión/);
  assert.doesNotMatch(m.avisoQr, /ya no está en el inventario/);
});

// Los tests async se encadenan al final para que el resumen salga después.
await new Promise((r) => setTimeout(r, 50));
console.log(`\n${pass} comprobaciones OK${process.exitCode ? " — CON FALLOS" : ""}`);
