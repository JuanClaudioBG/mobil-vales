// ============================================================================
//  Verificación de claridad de alcance y de la cadena de fechas
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-scope-clarity.mjs
//
//  Sólo Node, sin dependencias ni framework (igual que el resto de tests: el
//  proyecto no tiene paso de build).
//
//  Cubre la auditoría de septiembre 2026, que encontró que Dashboard y Excel
//  SÍ cuadran y que lo que confunde es el ALCANCE de cada vista:
//
//    A) Dashboard y Excel resuelven el mismo mes al MISMO conjunto de vales.
//    B-D) la cadena fechaVale → fecha → createdAt sobrevive a fechas ilegibles.
//    E) lo que el Top oculta más lo que muestra es el total del periodo.
//    F) el aviso de vista filtrada sólo aparece con Persona y/o Tipo.
//
//  Regla del archivo: ninguna cifra esperada se escribe a mano si puede
//  derivarse del juego de datos.
// ============================================================================
import {
  EMPTY_FILTERS, monthRange, filterDashboardVales, activeOnly,
  aggregateTopRequesters, filterScopeLabel, topHiddenSummary,
} from "../js/dashboard-data.js";
import { valeDate, toValidDate } from "../js/utils.js";
import { valesPorMes, monthKey } from "../js/excel-export.js";

let fallos = 0;
const ok = (nombre, condicion, detalle) => {
  if (condicion) { console.log("  ✓ " + nombre); return; }
  fallos++;
  console.log("  ✗ " + nombre + (detalle ? "\n      " + detalle : ""));
};
const eq = (nombre, a, b) =>
  ok(nombre, JSON.stringify(a) === JSON.stringify(b),
     "obtenido: " + JSON.stringify(a) + "\n      esperado: " + JSON.stringify(b));

// Doble mínimo del Timestamp de Firestore: lo único que el código le pide es
// .toDate(), así que no hace falta traer Firebase para probar la cadena.
const ts = (iso) => ({ toDate: () => new Date(iso) });

// ---------------------------------------------------------------------------
//  Juego de datos ÚNICO, en crudo: es el que alimenta a las DOS vistas, igual
//  que en la app (allVales). Incluye lo que rompe reconciliaciones: anulados,
//  vales al filo del mes, un vale de agosto registrado en septiembre y un vale
//  sin ninguna fecha utilizable.
// ---------------------------------------------------------------------------
const CRUDO = [
  { id: "s1", nombre: "Juanjo",  categoria: "Empleado", monto: 1000, fechaVale: ts("2026-09-01T06:00:00Z"), createdAt: ts("2026-09-01T16:00:00Z") },
  { id: "s2", nombre: "Juanjo",  categoria: "Empleado", monto: 500,  fechaVale: ts("2026-09-30T06:00:00Z"), createdAt: ts("2026-09-30T16:00:00Z") },
  { id: "s3", nombre: "Lorena",  categoria: "Familia",  monto: 1000, fechaVale: ts("2026-09-15T06:00:00Z"), createdAt: ts("2026-09-15T16:00:00Z") },
  { id: "s4", nombre: "Ana",     categoria: "Empleado", monto: 800,  fechaVale: ts("2026-09-15T06:00:00Z"), createdAt: ts("2026-09-15T16:00:00Z") },
  { id: "s5", nombre: "Beto",    categoria: "Empleado", monto: 700,  fechaVale: ts("2026-09-20T06:00:00Z"), createdAt: ts("2026-09-20T16:00:00Z") },
  { id: "s6", nombre: "Carla",   categoria: "Familia",  monto: 600,  fechaVale: ts("2026-09-21T06:00:00Z"), createdAt: ts("2026-09-21T16:00:00Z") },
  { id: "s7", nombre: "Diego",   categoria: "Empleado", monto: 300,  fechaVale: ts("2026-09-22T06:00:00Z"), createdAt: ts("2026-09-22T16:00:00Z") },
  { id: "s8", nombre: "Elena",   categoria: "Socio",    monto: 200,  fechaVale: ts("2026-09-23T06:00:00Z"), createdAt: ts("2026-09-23T16:00:00Z") },
  // Anulado DENTRO de septiembre: nunca suma en ninguna de las dos vistas.
  { id: "s9", nombre: "Juanjo",  categoria: "Empleado", monto: 5000, fechaVale: ts("2026-09-10T06:00:00Z"), createdAt: ts("2026-09-10T16:00:00Z"), anulado: true },
  // Vale de AGOSTO registrado en septiembre: manda la fecha del vale, no la de
  // registro. Si alguna vista usara createdAt, este vale delataría la fuga.
  { id: "a1", nombre: "Lorena",  categoria: "Familia",  monto: 900,  fechaVale: ts("2026-08-28T06:00:00Z"), createdAt: ts("2026-09-02T16:00:00Z") },
  { id: "a2", nombre: "Juanjo",  categoria: "Empleado", monto: 400,  fechaVale: ts("2026-08-31T06:00:00Z"), createdAt: ts("2026-08-31T16:00:00Z") },
  // Legacy: sólo `fecha`, como los vales más antiguos de producción.
  { id: "l1", nombre: "Histórico", categoria: "Empleado", monto: 250, fecha: ts("2026-09-05T06:00:00Z") },
  // Fechas ilegibles: antes de endurecer toDate() estos vales se quedaban con
  // un Date inválido y desaparecían del periodo sin avisar.
  { id: "f1", nombre: "Rescate", categoria: "Empleado", monto: 350, fechaVale: "marzo", fecha: ts("2026-09-07T06:00:00Z") },
  { id: "f2", nombre: "Rescate", categoria: "Empleado", monto: 150, fechaVale: "", fecha: "sin fecha", createdAt: ts("2026-09-08T16:00:00Z") },
  { id: "f3", nombre: "Perdido", categoria: "Empleado", monto: 999, fechaVale: "ayer", fecha: "nunca", createdAt: "jamás" },
];

// Las dos normalizaciones de la app (app.js: dashRecords() y valesParaExcel()).
// Comparten valeDate(): ése es justamente el punto.
const dashRecords = CRUDO.map((v) => ({
  id: v.id, nombre: v.nombre || "", categoria: v.categoria || "",
  monto: v.monto, date: valeDate(v), anulado: Boolean(v.anulado),
}));
const valesExcel = CRUDO.map((v) => ({
  id: v.id, nombre: v.nombre, categoria: v.categoria,
  monto: Number(v.monto) || 0, fecha: valeDate(v), anulado: !!v.anulado,
}));

const SEP = { ...EMPTY_FILTERS, ...monthRange("2026-09") };
const importe = (arr, campo = "monto") => arr.reduce((s, r) => s + (Number(r[campo]) || 0), 0);

// ---------------------------------------------------------------------------
console.log("\nA. Dashboard y Excel resuelven septiembre al MISMO conjunto");
// ---------------------------------------------------------------------------
const dashSep = activeOnly(filterDashboardVales(dashRecords, SEP));
const excelSep = (valesPorMes(valesExcel).find(([k]) => k === "2026-09") || ["2026-09", []])[1];

const ids = (arr) => arr.map((r) => r.id).sort();
eq("mismo conjunto de ids", ids(dashSep), ids(excelSep));
eq("mismo conteo", dashSep.length, excelSep.length);
eq("mismo importe", importe(dashSep), importe(excelSep));
ok("ninguna vista se queda sola con un vale",
   ids(dashSep).join() === ids(excelSep).join(),
   "dashboard-only: " + ids(dashSep).filter((i) => !ids(excelSep).includes(i)) +
   " | excel-only: " + ids(excelSep).filter((i) => !ids(dashSep).includes(i)));
ok("el anulado de septiembre no entra en ninguna de las dos",
   !ids(dashSep).includes("s9") && !ids(excelSep).includes("s9"));
ok("el vale de agosto registrado en septiembre queda en AGOSTO en ambas",
   !ids(dashSep).includes("a1") && monthKey(valesExcel.find((v) => v.id === "a1").fecha) === "2026-08");
ok("el vale sin ninguna fecha utilizable no se cuela en el mes",
   !ids(dashSep).includes("f3") && !ids(excelSep).includes("f3"));

// ---------------------------------------------------------------------------
console.log("\nB–D. La cadena fechaVale → fecha → createdAt sobrevive a basura");
// ---------------------------------------------------------------------------
const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);
eq("B) fechaVale ilegible + fecha válida → usa fecha",
   dia(valeDate(CRUDO.find((v) => v.id === "f1"))), "2026-09-07");
eq("C) fechaVale y fecha ilegibles + createdAt válido → usa createdAt",
   dia(valeDate(CRUDO.find((v) => v.id === "f2"))), "2026-09-08");
eq("D) las tres ilegibles → el vale queda SIN FECHA (null), no con un Date inválido",
   valeDate(CRUDO.find((v) => v.id === "f3")), null);
ok("D) sin fecha el vale sigue existiendo: sólo no pertenece a ningún mes",
   monthKey(valesExcel.find((v) => v.id === "f3").fecha) === null &&
   valesExcel.some((v) => v.id === "f3"));
eq("una cadena ilegible ya no devuelve un Date inválido", toValidDate("marzo"), null);
ok("toValidDate conserva una fecha válida intacta",
   toValidDate("2026-09-15T06:00:00Z").getTime() === new Date("2026-09-15T06:00:00Z").getTime());
ok("un Timestamp se sigue convirtiendo por su .toDate()",
   toValidDate(ts("2026-09-15T06:00:00Z")).getTime() === new Date("2026-09-15T06:00:00Z").getTime());
eq("un campo ausente sigue siendo null (sin cambio de comportamiento)", toValidDate(undefined), null);

// ---------------------------------------------------------------------------
console.log("\nE. El resumen del Top colapsado cuadra con el total del periodo");
// ---------------------------------------------------------------------------
const TOP_VISIBLE = 5; // el mismo corte que usa app.js
const ranking = aggregateTopRequesters(filterDashboardVales(dashRecords, SEP));
const visibles = ranking.slice(0, TOP_VISIBLE);
const oculto = topHiddenSummary(ranking, visibles);
ok("hay solicitantes fuera del top 5 en este juego de datos", ranking.length > TOP_VISIBLE);
eq("cuenta exacta de solicitantes ocultos", oculto.hiddenCount, ranking.length - visibles.length);
eq("visible + oculto = importe total de solicitantes",
   visibles.reduce((s, r) => s + r.total, 0) + oculto.hiddenTotal,
   ranking.reduce((s, r) => s + r.total, 0));
eq("visible + oculto = total de vales activos del periodo",
   visibles.reduce((s, r) => s + r.count, 0) + oculto.hiddenVales, dashSep.length);
eq("el importe oculto cuadra con el KPI del periodo",
   visibles.reduce((s, r) => s + r.total, 0) + oculto.hiddenTotal, importe(dashSep));

// Con el detalle abierto sobre alguien fuera del top 5, esa fila pasa a
// visible: restar una constante lo contaría dos veces.
const fuera = ranking[ranking.length - 1];
const conSeleccionado = [...visibles, fuera];
const ocultoConSel = topHiddenSummary(ranking, conSeleccionado);
eq("con el seleccionado visible, el oculto se recalcula (no se resta una constante)",
   ocultoConSel.hiddenCount, ranking.length - conSeleccionado.length);
eq("y sigue reconciliando",
   conSeleccionado.reduce((s, r) => s + r.total, 0) + ocultoConSel.hiddenTotal,
   ranking.reduce((s, r) => s + r.total, 0));

// Se recalcula al cambiar filtros y periodo: no es una cifra congelada.
const sepEmpleado = { ...SEP, tipo: "Empleado" };
const rankEmp = aggregateTopRequesters(filterDashboardVales(dashRecords, sepEmpleado));
const ocultoEmp = topHiddenSummary(rankEmp, rankEmp.slice(0, TOP_VISIBLE));
ok("con otro filtro el oculto cambia y sigue cuadrando",
   rankEmp.slice(0, TOP_VISIBLE).reduce((s, r) => s + r.total, 0) + (ocultoEmp ? ocultoEmp.hiddenTotal : 0)
     === rankEmp.reduce((s, r) => s + r.total, 0));
const rankAgo = aggregateTopRequesters(filterDashboardVales(dashRecords, { ...EMPTY_FILTERS, ...monthRange("2026-08") }));
eq("en un periodo con pocos solicitantes no hay nada oculto",
   topHiddenSummary(rankAgo, rankAgo.slice(0, TOP_VISIBLE)), null);
eq("con el Top completo tampoco hay nada oculto", topHiddenSummary(ranking, ranking), null);

// ---------------------------------------------------------------------------
console.log("\nF. El aviso de vista filtrada aparece sólo cuando toca");
// ---------------------------------------------------------------------------
eq("sin filtros: no hay aviso", filterScopeLabel(EMPTY_FILTERS), null);
eq("sólo periodo: tampoco (el periodo ya se ve en su selector)",
   filterScopeLabel(SEP), null);
eq("sólo persona", filterScopeLabel({ ...SEP, persona: "Juanjo" }),
   "Vista filtrada · Persona: Juanjo");
eq("sólo tipo", filterScopeLabel({ ...SEP, tipo: "Empleado" }),
   "Vista filtrada · Tipo: Empleado");
eq("persona y tipo", filterScopeLabel({ ...SEP, persona: "Juanjo", tipo: "Empleado" }),
   "Vista filtrada · Persona: Juanjo · Tipo: Empleado");
// El aviso describe una vista que REALMENTE es parcial.
const filtrado = activeOnly(filterDashboardVales(dashRecords, { ...SEP, tipo: "Empleado" }));
ok("cuando hay aviso, el KPI es de verdad menor que el total del periodo",
   filterScopeLabel({ ...SEP, tipo: "Empleado" }) !== null && importe(filtrado) < importe(dashSep));
ok("cuando no hay aviso, el KPI ES el total del periodo",
   filterScopeLabel(SEP) === null && importe(activeOnly(filterDashboardVales(dashRecords, SEP))) === importe(dashSep));

// ---------------------------------------------------------------------------
console.log(
  fallos === 0
    ? `\n✅ Alcance y fechas verificados: septiembre cuadra en ambas vistas (${dashSep.length} vales, $${importe(dashSep)}).`
    : `\n❌ ${fallos} comprobación(es) fallaron.`
);
process.exit(fallos === 0 ? 0 : 1);
