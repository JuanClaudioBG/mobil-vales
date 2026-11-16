// ============================================================================
//  Verificación de folios: visibles y buscables, tratados como identificadores
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-folios.mjs
//
//  Sólo Node, sin dependencias (igual que el resto de tests/).
//
//  Regla del archivo: un folio es un IDENTIFICADOR, no una cantidad. No pasa
//  por Number(): no pierde ceros iniciales y dos folios distintos nunca
//  coinciden por una conversión numérica.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import { folioDe, coincideBusqueda } from "../js/utils.js";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-folios.mjs");
  process.exit(1);
}

let n = 0;
const ok = (nombre, fn) => { fn(); n++; console.log("  ✓", nombre); };

const vales = [
  { nombre: "Karen", folio: "117765" },
  { nombre: "Héctor", folio: "117766" },
  { nombre: "Quiroz", folio: "007765" },   // ceros iniciales
  { nombre: "Andrea", folio: "7765" },
  { nombre: "Lorena" },                     // antiguo: sin folio
  { nombre: "Erick 117", folio: null },     // antiguo, con dígitos en el nombre
  { nombre: "Alex", folio: 117800 },        // por si algún documento lo guardó como número
];
const buscar = (q) => vales.filter((v) => coincideBusqueda(v, q)).map((v) => v.nombre);

console.log("\n== folioDe ==");
ok("devuelve la cadena guardada, sin espacios", () => {
  assert.equal(folioDe({ folio: " 117765 " }), "117765");
  assert.equal(folioDe({ folio: 117800 }), "117800");
});
ok("conserva los ceros iniciales", () => assert.equal(folioDe({ folio: "007765" }), "007765"));
ok("sin folio ⇒ cadena vacía (no 'undefined' ni 'null')", () => {
  for (const v of [{}, { folio: null }, { folio: "" }, { folio: "  " }, null, undefined]) {
    assert.equal(folioDe(v), "");
  }
});

console.log("\n== Búsqueda por nombre o folio ==");
ok("vacía: no filtra nada", () => {
  assert.equal(buscar("").length, vales.length);
  assert.equal(buscar("   ").length, vales.length);
});
ok("por nombre, sin distinguir mayúsculas (como antes)", () => {
  assert.deepEqual(buscar("kar"), ["Karen"]);
  assert.deepEqual(buscar("LORENA"), ["Lorena"]);
});
ok("por folio exacto", () => assert.deepEqual(buscar("117766"), ["Héctor"]));
ok("por folio parcial, mientras se teclea", () => {
  assert.deepEqual(buscar("1177"), ["Karen", "Héctor"]);
});
ok("acepta el folio como viene en el papel: con coma, espacio o «folio»", () => {
  assert.deepEqual(buscar("117,765"), ["Karen"]);
  assert.deepEqual(buscar("117 765"), ["Karen"]);
  assert.deepEqual(buscar("Folio 117765"), ["Karen"]);
  assert.deepEqual(buscar("folio: 117,765"), ["Karen"]);
});
ok("ceros iniciales: «007765» no es «7765»", () => {
  assert.deepEqual(buscar("007765"), ["Quiroz"]);
  assert.deepEqual(buscar("0077"), ["Quiroz"]);
  // «7765» sí aparece dentro de los tres folios que lo contienen: es búsqueda
  // por texto, y no se descarta ninguno por una conversión.
  assert.deepEqual(buscar("7765"), ["Karen", "Quiroz", "Andrea"]);
});
ok("sin conversiones numéricas: «1e5» o «117765.0» no son un folio", () => {
  assert.deepEqual(buscar("1e5"), []);
  assert.deepEqual(buscar("0x1cc45"), []);
});
ok("un vale sin folio no coincide con una búsqueda por folio, y no rompe", () => {
  assert.ok(!buscar("117765").includes("Lorena"));
  assert.deepEqual(buscar("lorena"), ["Lorena"]);
});
ok("dígitos en el nombre siguen encontrándose por nombre", () => {
  assert.deepEqual(buscar("erick 117"), ["Erick 117"]);
  // «117» coincide con ese nombre Y con los folios que lo contienen.
  assert.deepEqual(buscar("117"), ["Karen", "Héctor", "Erick 117", "Alex"]);
});
ok("folio guardado como número también se encuentra", () => assert.deepEqual(buscar("117800"), ["Alex"]));

console.log("\n== Presentación en Historial y Admin ==");
const app = fs.readFileSync("js/app.js", "utf8");
const inv = fs.readFileSync("js/inventario.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

ok("el folio se pinta en las filas de Historial y de Admin", () => {
  const filas = app.match(/<td(?: class="hist-nombre")?>\$\{escapeHtml\(v\.nombre\)\}\$\{folioHtml\(v\)\}<\/td>/g) || [];
  assert.equal(filas.length, 2, "una vez en renderHistorial y otra en renderAdmin");
});
ok("folioHtml: escapa, no convierte a número y cubre los vales sin folio", () => {
  const i = app.indexOf("function folioHtml(");
  const fuente = app.slice(i, app.indexOf("\n}\n", i) + 2);
  // formatFolio REAL (publicado en 52a99d5): coma de miles como en el PDF,
  // agrupando el texto, sin perder ceros iniciales.
  const fi = inv.indexOf("export function formatFolio(");
  const formatFolio = new Function(
    `${inv.slice(fi, inv.indexOf("\n}\n", fi) + 2).replace(/^export\s+/, "")}; return formatFolio;`
  )();
  const folioHtml = new Function("folioDe", "escapeHtml", "formatFolio", `${fuente}; return folioHtml;`)(
    folioDe, (s) => String(s).replace(/</g, "&lt;"), formatFolio
  );
  assert.equal(folioHtml({ folio: "007765" }), '<span class="folio-sub">Folio 007,765</span>');
  assert.equal(folioHtml({ folio: "117765" }), '<span class="folio-sub">Folio 117,765</span>');
  assert.match(folioHtml({}), /Sin folio/);
  assert.match(folioHtml({ folio: "<b>" }), /&lt;b>/);
  assert.ok(!/Number\(|toLocaleString/.test(fuente));
});
ok("los dos buscadores usan coincideBusqueda y respetan los demás filtros", () => {
  const i = app.indexOf("function renderHistorial(");
  const historial = app.slice(i, app.indexOf("// ====", i));
  assert.match(historial, /coincideBusqueda\(v, busqueda\)/);
  assert.match(historial, /if \(cat && v\.categoria !== cat\) return false;/);
  assert.match(historial, /if \(mes && monthKey\(valeDate\(v\)\) !== mes\) return false;/);
  assert.match(app, /allVales\.filter\(\(v\) => coincideBusqueda\(v, busqueda\)\)/);
  assert.match(html, /id="filtro-nombre"[^>]*placeholder="Nombre o folio…"/);
  assert.match(html, /id="admin-buscar"[^>]*placeholder="Nombre o folio…"/);
});
ok("formatFolio no convierte el folio en número (agrupa el texto)", () => {
  const i = inv.indexOf("export function formatFolio(");
  // Sin comentarios: el propio comentario explica que NO usa Number().
  const fuente = inv.slice(i, inv.indexOf("\n}\n", i) + 2).replace(/\/\/.*$/gm, "");
  assert.ok(!/Number\(|toLocaleString/.test(fuente));
});

console.log(`\n✅ ${n} comprobaciones de folios OK\n`);
