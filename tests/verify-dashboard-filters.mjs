// ============================================================================
//  Verificación del motor de filtros del Dashboard (js/dashboard-data.js)
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-dashboard-filters.mjs
//
//  Sólo Node, sin dependencias. El módulo es puro (sin DOM ni Firebase), así
//  que se importa tal cual. Regla: la MISMA población filtrada alimenta KPIs,
//  Top, detalle y gráfica; los anulados nunca suman.
// ============================================================================
import assert from "node:assert/strict";
import {
  EMPTY_FILTERS, monthRange, rangeMonthKey, filterDashboardVales,
  calculateDashboardMetrics, aggregateTopRequesters, requesterDetailRows,
  chartMonths, monthInPeriod, aggregateMonthlySeries,
  orderChartRequesters, assignRequesterColors, REQUESTER_PALETTE,
} from "../js/dashboard-data.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };
const d = (s) => new Date(s + "T12:00:00");
const v = (nombre, categoria, monto, fecha, extra = {}) =>
  ({ id: `${nombre}-${fecha}-${monto}`, nombre, categoria, monto, date: fecha ? d(fecha) : null, anulado: false, ...extra });

const data = [
  v("Juanjo", "Empleado", 500, "2026-09-01"),
  v("Juanjo", "Empleado", 500, "2026-09-30"),
  v("Juanjo", "Empleado", 1000, "2026-09-15", { anulado: true }),
  v("Lorena", "Familia", 1000, "2026-09-10"),
  v("Operaciones (General)", "Empleado", 300, "2026-09-12"),
  v("Operaciones (General)", "Empleado", 700, "2026-09-12"),
  v("Eugenio Galán", "Socio", 200, "2026-08-31"),
  v("Lorena", "Familia", 500, "2026-08-02"),
  v("Sin fecha", "Empleado", 200, null),
];
const sep = { ...EMPTY_FILTERS, ...monthRange("2026-09") };

console.log("Dashboard — motor de filtros");

ok("monthRange / rangeMonthKey (preset ↔ rango)", () => {
  assert.deepEqual(monthRange("2026-09"), { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
  assert.deepEqual(monthRange("2028-02"), { dateFrom: "2028-02-01", dateTo: "2028-02-29" });
  assert.equal(rangeMonthKey("2026-09-01", "2026-09-30"), "2026-09");
  assert.equal(rangeMonthKey("2026-09-01", "2026-09-29"), null);
  assert.equal(rangeMonthKey("", "2026-09-30"), null);
});

ok("sin filtros: todo, incluidos sin fecha", () => {
  assert.equal(filterDashboardVales(data, EMPTY_FILTERS).length, data.length);
});

ok("periodo inclusivo en ambos extremos; sin fecha queda fuera", () => {
  const r = filterDashboardVales(data, sep);
  assert.equal(r.length, 6);
  assert.ok(r.every((x) => x.date && x.date.getMonth() === 8));
});

ok("un filtro (persona)", () => {
  const r = filterDashboardVales(data, { ...sep, persona: "Juanjo" });
  assert.equal(r.length, 3);
});

ok("AND de varios filtros (tipo + persona + periodo)", () => {
  assert.equal(filterDashboardVales(data, { ...sep, tipo: "Familia", persona: "Lorena" }).length, 1);
  assert.equal(filterDashboardVales(data, { ...sep, tipo: "Familia", persona: "Juanjo" }).length, 0);
});

ok("rango personalizado cruzando meses", () => {
  const r = filterDashboardVales(data, { ...EMPTY_FILTERS, dateFrom: "2026-08-31", dateTo: "2026-09-01" });
  assert.deepEqual(r.map((x) => x.nombre).sort(), ["Eugenio Galán", "Juanjo"]);
});

ok("KPIs excluyen anulados", () => {
  const m = calculateDashboardMetrics(filterDashboardVales(data, sep));
  assert.equal(m.count, 5);
  assert.equal(m.total, 3000);
  assert.equal(m.annulledCount, 1);
  assert.deepEqual(m.byTipo.get("Empleado"), { count: 4, total: 2000 });
  assert.deepEqual(m.byTipo.get("Familia"), { count: 1, total: 1000 });
  assert.equal(m.byTipo.get("Socio"), undefined);
});

ok("cero resultados → ceros limpios (sin NaN)", () => {
  const f = filterDashboardVales(data, { ...sep, persona: "Nadie" });
  const m = calculateDashboardMetrics(f);
  assert.equal(m.count, 0);
  assert.equal(m.total, 0);
  assert.deepEqual(aggregateTopRequesters(f), []);
});

ok("Top: importe desc → vales desc → alfabético", () => {
  const top = aggregateTopRequesters(filterDashboardVales(data, sep));
  // Juanjo 1000 (2), Lorena 1000 (1), Operaciones 1000 (2) → empate de importe
  assert.deepEqual(top.map((t) => [t.name, t.total, t.count]), [
    ["Juanjo", 1000, 2],
    ["Operaciones (General)", 1000, 2],
    ["Lorena", 1000, 1],
  ]);
});

ok("detalle = misma población, sólo activos, más reciente primero", () => {
  const rows = requesterDetailRows(filterDashboardVales(data, sep), "Juanjo");
  assert.deepEqual(rows.map((r) => r.monto), [500, 500]);
  assert.ok(rows[0].date > rows[1].date);
  const top = aggregateTopRequesters(filterDashboardVales(data, sep)).find((t) => t.name === "Juanjo");
  assert.equal(rows.reduce((s, r) => s + r.monto, 0), top.total);
});

ok("ventana de la gráfica: mín. 6, máx. 12 meses", () => {
  assert.deepEqual(chartMonths("2026-09-01", "2026-09-30"),
    ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.equal(chartMonths("2025-01-01", "2026-09-30").length, 12);
  assert.equal(chartMonths("2025-01-01", "2026-09-30").at(-1), "2026-09");
  assert.equal(chartMonths("2026-01-10", "2026-09-05").length, 9);
  assert.ok(monthInPeriod("2026-09", "2026-09-10", "2026-10-02"));
  assert.ok(!monthInPeriod("2026-08", "2026-09-10", "2026-10-02"));
});

ok("serie mensual: meses continuos, un segmento por solicitante, sin Otros ni anulados", () => {
  const months = chartMonths(sep.dateFrom, sep.dateTo);
  const dims = filterDashboardVales(data, sep, { ignorePeriod: true });
  const s = aggregateMonthlySeries(dims, months);
  assert.equal(s.length, 6);
  assert.equal(s[0].total, 0); // abril: cero, no inventado
  const sepRow = s.at(-1);
  assert.equal(sepRow.total, 3000);
  assert.deepEqual([...sepRow.bySegment.keys()].sort(), ["Juanjo", "Lorena", "Operaciones (General)"]);
  assert.equal(sepRow.bySegment.get("Juanjo"), 1000); // el anulado no suma
  assert.ok(s.every((m) => !m.bySegment.has("Otros")));
  const ago = s.at(-2);
  assert.deepEqual([...ago.bySegment.entries()].sort(), [["Eugenio Galán", 200], ["Lorena", 500]]);
  for (const m of s) assert.equal([...m.bySegment.values()].reduce((a, b) => a + b, 0), m.total);
});

ok("orden de segmentos: periodo (importe → vales → nombre) y luego resto de la ventana", () => {
  const period = aggregateTopRequesters(filterDashboardVales(data, sep));
  const windowR = aggregateTopRequesters(filterDashboardVales(data, { dateFrom: "2026-04-01", dateTo: "2026-09-30" }));
  assert.deepEqual(orderChartRequesters(period, windowR),
    ["Juanjo", "Operaciones (General)", "Lorena", "Eugenio Galán"]);
});

ok("colores fijos: sin grises, sin repetir, independientes de filtros", () => {
  const dir = ["Eugenio Galán", "Juan Jr", "Andrea", "Lorena", "Juanjo"];
  const a = assignRequesterColors(dir, ["Zeta", "Lorena", "Alfa"]);
  const b = assignRequesterColors(dir, ["Alfa", "Zeta"]);
  assert.equal(a.get("Lorena"), b.get("Lorena"));
  assert.equal(a.get("Alfa"), REQUESTER_PALETTE[5]); // históricos: tras el directorio, alfabético
  assert.equal(a.get("Zeta"), REQUESTER_PALETTE[6]);
  assert.equal(new Set(REQUESTER_PALETTE).size, REQUESTER_PALETTE.length);
  for (const hex of REQUESTER_PALETTE) {
    // Saturación HSL: ningún gris ni tono apagado para solicitantes.
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl), l = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    assert.ok(sat >= 0.5, `${hex} parece gris (s=${sat.toFixed(2)})`);
  }
  const many = assignRequesterColors([], Array.from({ length: 40 }, (_, i) => "P" + String(i).padStart(2, "0")));
  assert.equal(new Set(many.values()).size, 40);
});

ok("gráfica respeta dimensiones (persona) igual que los KPIs", () => {
  const f = { ...sep, persona: "Lorena" };
  const s = aggregateMonthlySeries(filterDashboardVales(data, f, { ignorePeriod: true }), chartMonths(f.dateFrom, f.dateTo));
  const kpi = calculateDashboardMetrics(filterDashboardVales(data, f));
  assert.equal(s.at(-1).total, kpi.total);
  assert.equal(s.at(-2).total, 500);
});

console.log(`\n${n} verificaciones OK`);
