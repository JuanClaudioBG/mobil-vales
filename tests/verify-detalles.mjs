// ============================================================================
//  Detalles menores: jsQR bajo demanda, vencimiento al compartir, «—» en vez
//  de «$NaN» y mensaje del fallo al exportar a Excel
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-detalles.mjs
//
//  Sólo Node, sin dependencias. El cargador de jsQR se ejecuta de verdad
//  (js/pdf-vales.js no importa nada) con `window` y `document` simulados; las
//  funciones de js/app.js se extraen del código y se evalúan aparte, porque el
//  módulo importa el SDK desde la CDN. El recorrido completo en navegador
//  (abrir la app, importar, compartir) está en tests/verify-detalles-ui.cjs.
// ============================================================================
import fs from "node:fs";
import assert from "node:assert/strict";
import { mensajeError } from "../js/utils.js";

if (!fs.existsSync("js/app.js")) {
  console.error("Ejecuta este script desde la raíz del repo: node tests/verify-detalles.mjs");
  process.exit(1);
}

const app = fs.readFileSync("js/app.js", "utf8");
const pdf = fs.readFileSync("js/pdf-vales.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

let pass = 0;
const pendientes = [];
const test = (name, fn) => {
  pendientes.push(
    Promise.resolve()
      .then(fn)
      .then(() => { console.log("  ok   " + name); pass++; })
      .catch((e) => { console.log("  FAIL " + name + "\n       " + e.message); process.exitCode = 1; })
  );
  return pendientes[pendientes.length - 1];
};
const soloCodigo = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
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

const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
const AVISO_JSQR = "No se pudo cargar jsQR desde la CDN. Revisa la conexión e inténtalo de nuevo.";

// ---------------------------------------------------------------------------
console.log("\n== 1. jsQR bajo demanda ==");
await test("index.html ya no carga jsQR; QRCode y Chart.js siguen igual", () => {
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!scripts.some((s) => /jsqr/i.test(s)), "queda un <script> de jsQR");
  assert.deepEqual(scripts, [
    "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
    "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
    "./js/app.js",
  ]);
});
await test("pdf-vales.js usa la misma URL y versión (1.4.0)", () => {
  assert.ok(soloCodigo(pdf).includes(`"${JSQR_URL}"`));
});
await test("la validación del QR espera a loadJsQr() y no lee window.jsQR a ciegas", () => {
  const decode = soloCodigo(extraerFuncion(pdf, "async function decodeQrBase64("));
  assert.match(decode, /const jsQR = await loadJsQr\(\);/);
  assert.ok(!decode.includes("window.jsQR"));
  const api = soloCodigo(pdf.slice(pdf.indexOf("export async function extractVouchersFromPdf(")));
  assert.match(api, /await decodeQrBase64\(/);
});

/* DOM mínimo: registra cada <script> inyectado y deja que la prueba decida si
   «carga» (define window.jsQR y dispara onload) o falla (onerror). */
const head = [];
const inyectados = [];
globalThis.window = {};
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, "script");
    const s = { src: "", onload: null, onerror: null, remove() { head.splice(head.indexOf(s), 1); } };
    return s;
  },
  head: { appendChild(s) { head.push(s); inyectados.push(s); } },
};
const { loadJsQr } = await import("../js/pdf-vales.js");
const falsoJsQr = () => null;
const cargar = (s) => { window.jsQR = falsoJsQr; s.onload(); };

await test("importar el módulo no inyecta nada", () => {
  assert.equal(inyectados.length, 0);
});
await test("fallo de carga: mismo mensaje, sin código, y el <script> roto se quita", async () => {
  const p = loadJsQr();
  assert.equal(inyectados.length, 1);
  assert.equal(inyectados[0].src, JSQR_URL);
  inyectados[0].onerror();
  const err = await p.then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.message, AVISO_JSQR);
  assert.equal(err.code, undefined, "sin code: mensajeImportacion lo muestra tal cual");
  assert.equal(head.length, 0);
});
await test("el fallo no se memoriza: el siguiente intento vuelve a inyectar", async () => {
  const p = loadJsQr();
  assert.equal(inyectados.length, 2);
  // Se descargó, pero no registró window.jsQR: también cuenta como fallo.
  inyectados[1].onload();
  await assert.rejects(p, { message: AVISO_JSQR });
  assert.equal(head.length, 0);
});
await test("una sola inyección aunque se pida varias veces a la vez", async () => {
  const a = loadJsQr();
  const b = loadJsQr();
  const c = loadJsQr();
  assert.equal(inyectados.length, 3, "tres llamadas, un solo <script> nuevo");
  cargar(inyectados[2]);
  assert.deepEqual(await Promise.all([a, b, c]), [falsoJsQr, falsoJsQr, falsoJsQr]);
  assert.equal(head.length, 1);
});
await test("ya cargado: las siguientes importaciones no inyectan nada", async () => {
  assert.equal(await loadJsQr(), falsoJsQr);
  assert.equal(await loadJsQr(), falsoJsQr);
  assert.equal(inyectados.length, 3);
  assert.equal(head.length, 1);
});

// ---------------------------------------------------------------------------
console.log("\n== 2. Vencimiento al compartir ==");
const render = soloCodigo(extraerFuncion(app, "async function renderQrVale("));
await test("el texto de compartir usa el mismo «Vence: …» que el modal", () => {
  assert.match(render, /qrVence\.textContent = venceTxt;/);
  assert.match(render, /\(venceTxt \? `\\n\$\{venceTxt\}` : ""\)/);
});
await test("ya no se comparte la fecha ISO cruda", () => {
  assert.ok(!render.includes("Vence: ${v.vencimiento}"));
});
await test("el formato es el largo en español («31 de diciembre de 2026»)", () => {
  const venceTxt = new Function(
    "v", "parseDateInput",
    render.slice(render.indexOf("const venceTxt"), render.indexOf("qrVence.hidden")) + "return venceTxt;"
  );
  const parseDateInput = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  assert.equal(venceTxt({ vencimiento: "2026-12-31" }, parseDateInput), "Vence: 31 de diciembre de 2026");
  assert.equal(venceTxt({ vencimiento: null }, parseDateInput), "");
});

// ---------------------------------------------------------------------------
console.log("\n== 3. «—» en vez de «$NaN» ==");
const montoCelda = new Function(`${extraerFuncion(app, "function montoCelda(")}; return montoCelda;`)();
await test("montos válidos: igual que antes", () => {
  assert.equal(montoCelda(500), "$500");
  assert.equal(montoCelda(1000), "$" + (1000).toLocaleString("es-MX"));
  assert.equal(montoCelda(0), "$0");
  assert.equal(montoCelda("300"), "$300");
});
await test("montos que no son un número válido: «—»", () => {
  for (const malo of [NaN, undefined, null, "", "  ", "abc", "12x", {}, [], Infinity, true]) {
    assert.equal(montoCelda(malo), "—", `monto ${JSON.stringify(malo)}`);
  }
});
await test("Historial y Admin pintan el monto con montoCelda", () => {
  for (const firma of ["function renderHistorial(", "function renderAdmin("]) {
    const cuerpo = soloCodigo(extraerFuncion(app, firma));
    assert.match(cuerpo, /\$\{montoCelda\(v\.monto\)\}/, firma);
    assert.ok(!cuerpo.includes('$${Number(v.monto).toLocaleString("es-MX")}'), firma);
  }
});
await test("las sumas y el Excel no pasan por montoCelda", () => {
  assert.equal(soloCodigo(app).split("montoCelda(").length - 1, 3, "definición + 2 celdas");
});

// ---------------------------------------------------------------------------
console.log("\n== 4. Mensaje del fallo al exportar a Excel ==");
const mensajeExcel = new Function(
  "mensajeError",
  `${extraerFuncion(app, "function mensajeExcel(")}; return mensajeExcel;`
)(mensajeError);
const conCodigo = (code) => Object.assign(new Error("texto crudo en inglés del SDK"), { code });
await test("error con código: mensajeError(err, \"exportar el Excel\")", () => {
  assert.equal(mensajeExcel(conCodigo("permission-denied")), mensajeError(conCodigo("permission-denied"), "exportar el Excel"));
  assert.match(mensajeExcel(conCodigo("permission-denied")), /^No tienes permiso para exportar el Excel/);
  assert.equal(
    mensajeExcel(conCodigo("unavailable")),
    "Sin conexión con el servidor. Revisa tu señal e inténtalo de nuevo."
  );
});
await test("error sin código: conserva su mensaje (como mensajeImportacion)", () => {
  assert.equal(mensajeExcel(new Error("ExcelJS no se registró")), "ExcelJS no se registró");
});
await test("sin código ni mensaje: genérico", () => {
  assert.equal(mensajeExcel(new Error("")), "No se pudo exportar el Excel. Inténtalo de nuevo.");
  assert.equal(mensajeExcel(null), "No se pudo exportar el Excel. Inténtalo de nuevo.");
});
await test("exportExcel ya no enseña err.message crudo", () => {
  const cuerpo = soloCodigo(extraerFuncion(app, "async function exportExcel("));
  assert.match(cuerpo, /showToast\("⚠️ No se pudo generar el Excel: " \+ mensajeExcel\(err\)\);/);
  assert.ok(!cuerpo.includes("err.message"));
});

await Promise.all(pendientes);
console.log(process.exitCode ? "\n❌ Hay fallos" : `\n✅ ${pass} comprobaciones OK`);
