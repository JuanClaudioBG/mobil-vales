// ============================================================================
//  Verificación del Excel: Dashboard, hojas de mes, Histórico y Detalle
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO (las rutas son relativas):
//
//      node tests/verify-excel-dashboard.mjs
//
//  Sólo Node, sin dependencias ni framework: el proyecto no tiene paso de
//  build y se publica tal cual en GitHub Pages, así que este archivo no se
//  carga desde index.html ni afecta a la app.
//
//  ExcelJS NO se instala para probar: se sustituye por un doble mínimo (más
//  abajo) que registra lo que el código escribe en cada celda. Así se verifica
//  el libro completo —orden de hojas, KPIs, tabla de personas de cada mes—
//  sin descargar 930 KB ni añadir una dependencia al repo.
//
//  La regla que gobierna todo el archivo: NINGUNA cifra puede inventarse.
//  Todo sale del mismo conjunto de vales que se exporta.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

const {
  computeExcelMetrics, metricasDelMes, filasDetalle, filasHistorico,
  valesPorMes, filasDelMes, construirLibro, nombreHojaMes, selloDatosAl,
  SIN_NOMBRE, SIN_CATEGORIA, SIN_FECHA,
} = await import(path.join(RAIZ, "js/excel-export.js"));
// Los cortocircuitos "sin datos" de las gráficas ocurren ANTES de tocar el
// canvas, así que se pueden probar desde Node.
const { graficaMeses, graficaDonutCategorias } = await import(path.join(RAIZ, "js/excel-charts.js"));

let fallos = 0;
function ok(nombre, condicion, detalle) {
  if (condicion) { console.log("  ✓ " + nombre); return; }
  fallos++;
  console.log("  ✗ " + nombre + (detalle ? "\n      " + detalle : ""));
}
const eq = (nombre, a, b) =>
  ok(nombre, JSON.stringify(a) === JSON.stringify(b),
     "obtenido: " + JSON.stringify(a) + "\n      esperado: " + JSON.stringify(b));

// ---------------------------------------------------------------------------
//  Juego de datos: anulados, sin fecha, sin nombre, sin categoría, empates y
//  un mes cuyo importe activo es 0. Son justo los casos donde las cifras
//  suelen discrepar entre hojas.
// ---------------------------------------------------------------------------
const HOY = new Date(2026, 8, 11, 10, 15); // 11/09/2026 10:15 (con hora: el
                                           // sello de frescura la imprime)
const d = (y, m, dia) => new Date(y, m - 1, dia);
const vale = (o) => ({
  nombre: "Ana", categoria: "Empleado", monto: 200, fecha: d(2026, 9, 3),
  registradoPor: "Karen", folio: null, anulado: false, notas: "", ...o,
});
const VALES = [
  // Septiembre 2026 (mes en curso)
  vale({ nombre: "Ana", monto: 1000, folio: "10001" }),
  vale({ nombre: "Beto", monto: 300, anulado: true }),
  vale({ nombre: "Beto", monto: 200, categoria: "Socio" }),
  // Agosto 2026
  vale({ nombre: "Ana", monto: 500, fecha: d(2026, 8, 9) }),
  vale({ nombre: "Cruz", monto: 1000, fecha: d(2026, 8, 2), anulado: true, categoria: "Familia" }),
  vale({ nombre: "Cruz", monto: 500, fecha: d(2026, 8, 4), categoria: "Familia" }),
  vale({ nombre: "", categoria: "", monto: 300, fecha: d(2026, 8, 6) }),   // sin nombre ni categoría
  // Julio 2026: empate exacto de importe entre dos personas y dos categorías
  vale({ nombre: "Dora", monto: 500, fecha: d(2026, 7, 5), categoria: "Familia" }),
  vale({ nombre: "Elmo", monto: 500, fecha: d(2026, 7, 6), categoria: "Socio" }),
  // Junio 2026: único vale activo, con importe 0 -> no puede haber dona
  vale({ nombre: "Ana", monto: 0, fecha: d(2026, 6, 1) }),
  // Fuera de la ventana de 12 meses, pero cuenta en los totales
  vale({ nombre: "Ana", monto: 200, fecha: d(2024, 5, 1) }),
  // Sin ninguna fecha utilizable
  vale({ nombre: "Fito", monto: 300, fecha: null, categoria: "Socio" }),
];
const M = computeExcelMetrics(VALES, HOY);
const MESES = valesPorMes(VALES);
const RESUMEN = new Map(MESES.map(([k, vs]) => [k, metricasDelMes(vs)]));

// ---------------------------------------------------------------------------
//  Doble mínimo de ExcelJS (lo justo para construirLibro)
// ---------------------------------------------------------------------------
function ExcelJSFalso() {
  class Celda { constructor() { this.value = null; } }
  class Fila {
    constructor() { this.celdas = new Map(); this.height = null; }
    getCell(c) {
      if (!this.celdas.has(c)) this.celdas.set(c, new Celda());
      return this.celdas.get(c);
    }
  }
  class Hoja {
    constructor(nombre) {
      this.name = nombre; this.filas = new Map(); this.columnas = new Map();
      this.rowCount = 0; this.views = []; this.autoFilter = null; this.imagenes = [];
    }
    getRow(n) {
      if (!this.filas.has(n)) this.filas.set(n, new Fila());
      if (n > this.rowCount) this.rowCount = n;
      return this.filas.get(n);
    }
    getColumn(n) {
      if (!this.columnas.has(n)) this.columnas.set(n, { width: null });
      return this.columnas.get(n);
    }
    addRow(valores) {
      const fila = this.getRow(this.rowCount + 1);
      valores.forEach((v, i) => { fila.getCell(i + 1).value = v; });
      return fila;
    }
    mergeCells() { /* la fusión no cambia los valores que nos interesan */ }
    addImage(id, ancla) { this.imagenes.push({ id, ancla }); }
    celda(r, c) { return this.getRow(r).getCell(c).value; }
    // Texto de toda la hoja, para buscar marcas que no deberían estar.
    texto() {
      const out = [];
      for (const fila of this.filas.values()) {
        for (const cel of fila.celdas.values()) if (cel.value != null) out.push(String(cel.value));
      }
      return out.join("\n");
    }
    // Fila donde empieza la tabla de personas de una hoja de mes.
    filaTablaPersonas() {
      for (let r = 1; r <= this.rowCount; r++) {
        if (this.celda(r, 1) === "Nombre" && this.celda(r, 2) === "Categoría") return r;
      }
      return -1;
    }
  }
  class Workbook {
    constructor() { this.worksheets = []; this.imagenes = []; }
    addWorksheet(nombre) { const h = new Hoja(nombre); this.worksheets.push(h); return h; }
    getWorksheet(nombre) { return this.worksheets.find((h) => h.name === nombre); }
    addImage(img) { this.imagenes.push(img); return this.imagenes.length - 1; }
  }
  return { Workbook };
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";
// Renderizador falso con la MISMA regla que el de verdad: sin importe, no hay
// imagen. Así el libro de prueba reproduce el caso del mes vacío.
const renderFalso = ({ meses }) => ({
  meses: PNG,
  porMes: Object.fromEntries(meses.map(([k, r]) => [k, r.importe > 0 ? PNG : null])),
});
const LIBRO = construirLibro(ExcelJSFalso(), VALES, { generado: HOY, render: renderFalso });
const hojas = LIBRO.worksheets.map((h) => h.name);
const DASH = LIBRO.getWorksheet("Dashboard");
const DET = LIBRO.getWorksheet("Detalle");
const HIST = LIBRO.getWorksheet("Histórico");

const activosRef = VALES.filter((v) => !v.anulado);
const delMesRef = (y, mes) =>
  activosRef.filter((v) => v.fecha && v.fecha.getFullYear() === y && v.fecha.getMonth() === mes - 1);
const suma = (lista) => lista.reduce((a, v) => a + v.monto, 0);

// ===========================================================================
console.log("\n1. Ninguna cifra inventada: todo sale del conjunto exportado");
ok("cada mes de la serie coincide con un recálculo independiente",
   M.serieMeses.every((m) => {
     const [y, mm] = m.key.split("-").map(Number);
     return m.importe === suma(delMesRef(y, mm)) && m.count === delMesRef(y, mm).length;
   }));
ok("un mes sin actividad vale 0, nunca un importe inventado",
   M.serieMeses.filter((m) => m.importe === 0).length > 0 &&
   M.serieMeses.every((m) => m.importe === 0 || delMesRef(...m.key.split("-").map(Number)).length > 0));
ok("el resumen mensual sólo lista meses que existen en los datos",
   M.resumenMeses.every((x) => x.label === SIN_FECHA || delMesRef(...x.key.split("-").map(Number)).length > 0));
eq("sólo hay hoja de los meses con vales activos",
   hojas.slice(2, -1), MESES.map(([k]) => {
     const MES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
     const [y, m] = k.split("-").map(Number);
     return MES[m - 1] + " " + y;
   }));
ok("no se crea hoja de un mes sin vales (p. ej. May 2026)", !hojas.includes("May 2026"));
ok("el libro de producción no lleva la marca de muestra",
   !LIBRO.worksheets.some((h) => /SINT[ÉE]TIC|SOLO QA/i.test(h.texto())));
ok("la marca de QA sólo aparece si se pide explícitamente", (() => {
   const qa = construirLibro(ExcelJSFalso(), VALES, { generado: HOY, etiquetaQA: "DATOS SINTÉTICOS — SOLO QA" });
   return /DATOS SINTÉTICOS — SOLO QA/.test(qa.getWorksheet("Dashboard").texto());
})());

console.log("\n2. Los KPI del Dashboard salen del conjunto exportado");
eq("vales activos", M.activos, activosRef.length);
eq("importe total", M.importeTotal, suma(activosRef));
eq("registrados", M.registrados, VALES.length);
eq("anulados", M.anulados, VALES.filter((v) => v.anulado).length);
eq("tasa de anulación", M.tasaAnulacion, VALES.filter((v) => v.anulado).length / VALES.length);
eq("importe del mes en curso", M.mes.actualImporte, suma(delMesRef(2026, 9)));
eq("KPI «vales activos» escrito en la hoja", DASH.celda(6, 2), M.activos);
eq("KPI «importe total» escrito en la hoja", DASH.celda(6, 4), M.importeTotal);
eq("KPI «vales anulados» escrito en la hoja", DASH.celda(10, 2), M.anulados);
eq("KPI «importe del mes» escrito en la hoja", DASH.celda(10, 4), M.mes.actualImporte);
ok("el subtítulo declara el alcance y la fecha de corte",
   String(DASH.celda(3, 2)) === "Histórico completo · Datos al 11/09/2026 10:15", JSON.stringify(DASH.celda(3, 2)));
eq("el Dashboard sólo incrusta UNA gráfica", DASH.imagenes.length, 1);

console.log("\n3. Los KPI de cada mes salen SÓLO de ese mes");
for (const [clave, resumen] of RESUMEN) {
  const [y, mm] = clave.split("-").map(Number);
  const propios = delMesRef(y, mm);
  eq(`${clave}: total de vales`, resumen.count, propios.length);
  eq(`${clave}: importe del mes`, resumen.importe, suma(propios));
}
ok("ningún mes incluye importe de otro mes",
   [...RESUMEN.values()].reduce((a, r) => a + r.importe, 0) === M.importeTotal - M.sinFecha.importe);
const AGO = LIBRO.getWorksheet("Ago 2026");
// Las KPI del mes bajan una fila respecto al diseño original: debajo del
// título va ahora el sello de frescura (fila 3).
eq("hoja Ago 2026: KPI total de vales", AGO.celda(6, 1), RESUMEN.get("2026-08").count);
eq("hoja Ago 2026: KPI importe del mes", AGO.celda(6, 3), RESUMEN.get("2026-08").importe);
eq("hoja Ago 2026: KPI top persona", AGO.celda(10, 1), RESUMEN.get("2026-08").topPersona.nombre);
eq("hoja Ago 2026: KPI categoría principal", AGO.celda(10, 3), RESUMEN.get("2026-08").categoriaPrincipal.categoria);
ok("el título de la hoja nombra el mes", String(AGO.celda(2, 1)) === "AGOSTO 2026", JSON.stringify(AGO.celda(2, 1)));

// --- Frescura: el libro es una FOTO, y cada hoja lo dice ---------------------
// Sin esto, un libro descargado hace días se compara contra un Dashboard de
// hoy y el mes EN CURSO parece descuadrado cuando sólo ha seguido creciendo.
console.log("\n3b. Sello de frescura en Dashboard y hojas de mes");
const SELLO = "Datos al 11/09/2026 10:15";
ok("el Dashboard lleva el sello con hora", String(DASH.celda(3, 2)).endsWith(SELLO));
for (const [clave] of RESUMEN) {
  const hoja = LIBRO.getWorksheet(nombreHojaMes(clave));
  ok(`hoja ${nombreHojaMes(clave)}: sello bajo el título`,
     String(hoja.celda(3, 1)) === SELLO, JSON.stringify(hoja.celda(3, 1)));
  ok(`hoja ${nombreHojaMes(clave)}: la pestaña NO lleva la fecha de corte`,
     !hoja.name.includes("Datos al") && hoja.name === nombreHojaMes(clave), hoja.name);
}
eq("el sello se construye con la hora de generación", selloDatosAl(HOY), SELLO);

console.log("\n4. La dona cuadra con el total activo del mes");
for (const [clave, resumen] of RESUMEN) {
  eq(`${clave}: suma de categorías == importe del mes`,
     resumen.categorias.reduce((a, c) => a + c.importe, 0), resumen.importe);
  eq(`${clave}: suma de vales por categoría == vales del mes`,
     resumen.categorias.reduce((a, c) => a + c.count, 0), resumen.count);
}

console.log("\n5. Los porcentajes de categoría suman como deben");
for (const [clave, resumen] of RESUMEN) {
  const total = resumen.categorias.reduce((a, c) => a + c.pct, 0);
  ok(`${clave}: los porcentajes suman 1 (o 0 si no hay importe)`,
     resumen.importe === 0 ? total === 0 : Math.abs(total - 1) < 1e-9);
}
ok("los porcentajes se calculan sin redondear",
   RESUMEN.get("2026-08").categorias[0].pct ===
   RESUMEN.get("2026-08").categorias[0].importe / RESUMEN.get("2026-08").importe);

console.log("\n6. Top persona");
eq("Ago 2026: top persona", [RESUMEN.get("2026-08").topPersona.nombre, RESUMEN.get("2026-08").topPersona.importe],
   ["Ana", 500]);
ok("es quien más importe activo tiene en el mes", [...RESUMEN.entries()].every(([clave, r]) => {
  const [y, mm] = clave.split("-").map(Number);
  const porNombre = new Map();
  for (const v of delMesRef(y, mm)) {
    const k = (v.nombre || "").trim() || SIN_NOMBRE;
    porNombre.set(k, (porNombre.get(k) || 0) + v.monto);
  }
  const mejor = Math.max(...porNombre.values());
  return r.topPersona.importe === mejor;
}));
// Julio tiene un empate exacto: Dora (Familia) y Elmo (Socio), $500 cada uno.
eq("empate resuelto por orden alfabético", RESUMEN.get("2026-07").topPersona.nombre, "Dora");
ok("los anulados no pueden ganar el top",
   RESUMEN.get("2026-08").topPersona.nombre !== "Cruz");

console.log("\n7. Categoría principal");
// Ago 2026: Empleado y Familia empatan a $500 con un vale cada uno, así que
// decide el orden alfabético. (El vale de $1000 de Familia está anulado.)
eq("Ago 2026: categoría principal (empate -> alfabético)",
   RESUMEN.get("2026-08").categoriaPrincipal.categoria, "Empleado");
ok("es la de mayor importe del mes", [...RESUMEN.values()].every((r) =>
   r.categorias.length === 0 || r.categoriaPrincipal.importe === Math.max(...r.categorias.map((c) => c.importe))));
eq("empate de categorías resuelto por orden alfabético",
   RESUMEN.get("2026-07").categoriaPrincipal.categoria, "Familia");

console.log("\n8. Categoría ausente");
ok(`se etiqueta como ${SIN_CATEGORIA}`,
   RESUMEN.get("2026-08").categorias.some((c) => c.categoria === SIN_CATEGORIA));
ok("no se descarta su importe",
   RESUMEN.get("2026-08").categorias.find((c) => c.categoria === SIN_CATEGORIA).importe === 300);
ok(`el nombre ausente se etiqueta como ${SIN_NOMBRE}`,
   RESUMEN.get("2026-08").topPersona !== null &&
   filasDetalle(VALES).some((f) => f.nombre === SIN_NOMBRE && f.categoria === SIN_CATEGORIA));

console.log("\n9. Un mes sin importe activo no dibuja una dona falsa");
const JUN = RESUMEN.get("2026-06");
eq("Jun 2026 existe como hoja pero con importe 0", JUN.importe, 0);
eq("la dona devuelve null (no se dibuja nada)", graficaDonutCategorias(JUN.categorias), null);
eq("la gráfica de meses también se niega a dibujar ceros",
   graficaMeses([{ key: "2026-01", label: "Ene 2026", importe: 0, count: 0 }]), null);
eq("la hoja del mes vacío no incrusta imagen", LIBRO.getWorksheet("Jun 2026").imagenes.length, 0);
ok("y escribe un vacío explícito",
   /no tiene importe activo/i.test(LIBRO.getWorksheet("Jun 2026").texto()));
eq("los meses con importe sí incrustan su dona", AGO.imagenes.length, 1);

console.log("\n10. La tabla por persona de cada mes no cambió");
for (const [clave, delMes] of MESES) {
  const MES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const [y, m] = clave.split("-").map(Number);
  const hoja = LIBRO.getWorksheet(MES[m - 1] + " " + y);
  const cab = hoja.filaTablaPersonas();
  const esperadas = filasDelMes(delMes);
  const leidas = [];
  for (let r = cab + 1; r < cab + 1 + esperadas.length; r++) {
    leidas.push({ nombre: hoja.celda(r, 1), categoria: hoja.celda(r, 2),
                  count: hoja.celda(r, 3), total: hoja.celda(r, 4) });
  }
  eq(`${clave}: filas de la tabla por persona`, leidas, esperadas);
  eq(`${clave}: cabecera de siempre`,
     [1, 2, 3, 4].map((c) => hoja.celda(cab, c)), ["Nombre", "Categoría", "Vales", "Total"]);
  const filaTotal = cab + 1 + esperadas.length;
  eq(`${clave}: fila TOTAL literal (no fórmula)`,
     [hoja.celda(filaTotal, 1), hoja.celda(filaTotal, 3), hoja.celda(filaTotal, 4)],
     ["TOTAL", esperadas.reduce((a, f) => a + f.count, 0), esperadas.reduce((a, f) => a + f.total, 0)]);
  ok(`${clave}: el área de insights va ARRIBA de la tabla`, cab > 10);
}

console.log("\n11. Histórico intacto");
// Oráculo: la implementación que vivía en app.js antes de esta función.
function historicoPrevio(vales) {
  const map = new Map();
  for (const v of vales.filter((x) => !x.anulado)) {
    const k = v.nombre;
    if (k == null) continue;
    const agg = map.get(k) || { count: 0, total: 0 };
    agg.count += 1; agg.total += Number(v.monto) || 0;
    map.set(k, agg);
  }
  return [...map.entries()]
    .map(([nombre, agg]) => ({ nombre, count: agg.count, total: agg.total }))
    .sort((a, b) => b.total - a.total);
}
eq("filas del Histórico", filasHistorico(VALES), historicoPrevio(VALES));
eq("cabecera de siempre", [1, 2, 3].map((c) => HIST.celda(1, c)), ["Nombre", "Vales", "Total"]);
ok("empieza en la fila 1: no se le añadió ningún dashboard", HIST.celda(1, 1) === "Nombre");
eq("sigue excluyendo anulados",
   filasHistorico(VALES).reduce((a, r) => a + r.total, 0), M.importeTotal);
eq("fila TOTAL literal",
   [HIST.celda(HIST.rowCount, 1), HIST.celda(HIST.rowCount, 3)], ["TOTAL", M.importeTotal]);
eq("el Histórico no incrusta gráficas", HIST.imagenes.length, 0);

console.log("\n12. Detalle intacto");
const det = filasDetalle(VALES);
eq("una fila por vale persistido", det.length, VALES.length);
eq("filas escritas en la hoja", DET.rowCount - 1, VALES.length);
eq("columnas", [...DET.getRow(1).celdas.values()].map((c) => c.value),
   ["Nombre", "Categoría", "Monto", "Fecha del vale", "Registrado por", "Folio", "Estado", "Notas"]);
ok("incluye activos y anulados",
   det.filter((f) => f.estado === "ANULADO").length === VALES.filter((v) => v.anulado).length &&
   det.filter((f) => f.estado === "ACTIVO").length === activosRef.length);
ok("cabecera inmovilizada", JSON.stringify(DET.views) === JSON.stringify([{ state: "frozen", ySplit: 1 }]));
ok("autofiltro sobre todo el rango",
   DET.autoFilter && DET.autoFilter.to.row === VALES.length + 1 && DET.autoFilter.to.column === 8);
eq("importe del Dashboard == suma de los ACTIVO del Detalle",
   M.importeTotal, det.filter((f) => f.estado === "ACTIVO").reduce((a, f) => a + f.monto, 0));
ok("los vales sin fecha siguen presentes", det.some((f) => f.fecha === null));
eq("el Detalle es la última hoja", hojas[hojas.length - 1], "Detalle");

console.log("\n13. El código QR sigue sin exportarse");
const fuente = leer("js/excel-export.js") + leer("js/excel-charts.js");
const codigo = fuente.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
ok("los módulos de Excel no mencionan qrCode", !/qrCode/i.test(codigo));
ok("valesParaExcel() no copia qrCode ni batchId", (() => {
  const app = leer("js/app.js");
  const i = app.indexOf("function valesParaExcel()");
  return i > 0 && !/qrCode|batchId/.test(app.slice(i, app.indexOf("\n}", i)));
})());
ok("ninguna fila del Detalle expone un campo de QR",
   det.every((f) => !Object.keys(f).some((k) => /qr|batch/i.test(k))));
ok("ninguna celda del libro contiene un código COMBUSA", (() => {
  const conQr = VALES.map((v, i) => ({ ...v, qrCode: "COMBUSA-" + i, batchId: "lote-" + i }));
  const libro = construirLibro(ExcelJSFalso(), conQr, { generado: HOY });
  return !libro.worksheets.some((h) => /COMBUSA|lote-/.test(h.texto()));
})());

console.log("\n14. Los anulados quedan fuera del dinero activo de cada mes");
ok("hay anulados repartidos en varios meses", VALES.filter((v) => v.anulado).length >= 2);
for (const [clave, resumen] of RESUMEN) {
  const [y, mm] = clave.split("-").map(Number);
  const anuladosDelMes = VALES.filter((v) => v.anulado && v.fecha &&
    v.fecha.getFullYear() === y && v.fecha.getMonth() === mm - 1);
  eq(`${clave}: importe sin anulados`, resumen.importe, suma(delMesRef(y, mm)));
  ok(`${clave}: los ${anuladosDelMes.length} anulados no aparecen en ninguna categoría`,
     resumen.categorias.reduce((a, c) => a + c.count, 0) === delMesRef(y, mm).length);
}
ok("tampoco entran en la tabla por persona del mes",
   MESES.every(([, vs]) => vs.every((v) => !v.anulado)));

console.log("\n15. Sin dependencias nuevas");
ok("el repo sigue sin package.json", !fs.existsSync(path.join(RAIZ, "package.json")));
ok("el repo sigue sin node_modules", !fs.existsSync(path.join(RAIZ, "node_modules")));
eq("única URL remota: ExcelJS 4.4.0 fijado",
   [...new Set([...fuente.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]))],
   ["https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"]);
eq("sólo imports relativos del propio repo",
   [...new Set([...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]))].sort(),
   ["./excel-charts.js", "./utils.js"]);
ok("ExcelJS se sigue cargando bajo demanda",
   /function cargarExcelJs/.test(fuente) && !/^\s*import .*exceljs/im.test(fuente));
ok("no se añadió ninguna librería de gráficas ni de compresión",
   !/chart\.js|d3|pako|jszip|canvas-/i.test(fuente));

console.log(
  fallos === 0
    ? `\n✅ Excel verificado: ${hojas.length} hojas (${MESES.length} meses), sin discrepancias.`
    : `\n❌ ${fallos} comprobación(es) fallaron.`
);
process.exit(fallos ? 1 : 0);
