// ============================================================================
//  Comparación por solicitante vs mes anterior (js/dashboard-data.js)
// ============================================================================
//  Ejecutar DESDE LA RAÍZ DEL REPO:
//
//      node tests/verify-dashboard-comparacion.mjs
//
//  Sólo Node, sin dependencias. compareWithPrevious() es pura: recibe dos
//  rankings de aggregateTopRequesters() y no toca DOM ni Firebase.
// ============================================================================
import assert from "node:assert/strict";
import {
  EMPTY_FILTERS, monthRange, filterDashboardVales, aggregateTopRequesters,
  compareWithPrevious,
} from "../js/dashboard-data.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("  ✓", name); };
const d = (s) => new Date(s + "T12:00:00");
const v = (nombre, categoria, monto, fecha, extra = {}) =>
  ({ id: `${nombre}-${fecha}-${monto}`, nombre, categoria, monto, date: d(fecha), anulado: false, ...extra });

const data = [
  // Octubre (mes anterior)
  v("Sube", "Empleado", 500, "2026-10-03"),
  v("Baja", "Empleado", 1000, "2026-10-04"),
  v("Baja", "Empleado", 500, "2026-10-20"),
  v("Igual", "Familia", 300, "2026-10-05"),
  v("Se fue", "Empleado", 200, "2026-10-06"),
  v("Sólo anulado", "Empleado", 1000, "2026-10-07", { anulado: true }),
  v("Otro tipo", "Socio", 500, "2026-10-08"),
  // Noviembre (mes actual)
  v("Sube", "Empleado", 500, "2026-11-03"),
  v("Sube", "Empleado", 700, "2026-11-10"),
  v("Baja", "Empleado", 200, "2026-11-04"),
  v("Igual", "Familia", 300, "2026-11-05"),
  v("Nueva", "Familia", 1000, "2026-11-06"),
  v("Sólo anulado", "Empleado", 200, "2026-11-07"),
  v("Otro tipo", "Socio", 500, "2026-11-08"),
];
const rank = (key, extra = {}) =>
  aggregateTopRequesters(filterDashboardVales(data, { ...EMPTY_FILTERS, ...extra, ...monthRange(key) }));

console.log("Dashboard — comparación vs mes anterior");
const cmp = compareWithPrevious(rank("2026-11"), rank("2026-10"));

ok("sube: diferencia positiva en pesos", () => {
  assert.deepEqual(cmp.get("Sube"), { trend: "up", diff: 700, previous: 500 });
});
ok("baja: diferencia negativa en pesos", () => {
  assert.deepEqual(cmp.get("Baja"), { trend: "down", diff: -1300, previous: 1500 });
});
ok("igual: mismo importe", () => {
  assert.deepEqual(cmp.get("Igual"), { trend: "same", diff: 0, previous: 300 });
});
ok("nuevo: sin importe el mes anterior", () => {
  assert.deepEqual(cmp.get("Nueva"), { trend: "new", diff: 1000, previous: 0 });
});
ok("nuevo: el mes anterior sólo tuvo anulados ($0 activo)", () => {
  assert.equal(cmp.get("Sólo anulado").trend, "new");
});
ok("ya no aparece: quien sólo estuvo el mes anterior no tiene entrada", () => {
  assert.equal(cmp.has("Se fue"), false);
  assert.deepEqual([...cmp.keys()].sort(), ["Baja", "Igual", "Nueva", "Otro tipo", "Sube", "Sólo anulado"].sort());
});
ok("mismos filtros: con Tipo=Familia sólo compara Familia", () => {
  const fam = compareWithPrevious(rank("2026-11", { tipo: "Familia" }), rank("2026-10", { tipo: "Familia" }));
  assert.deepEqual([...fam.keys()].sort(), ["Igual", "Nueva"]);
  assert.equal(fam.get("Igual").trend, "same");
});
ok("rankings vacíos", () => {
  assert.equal(compareWithPrevious([], rank("2026-10")).size, 0);
  assert.equal(compareWithPrevious(rank("2026-11"), []).get("Sube").trend, "new");
});
ok("no muta las entradas", () => {
  const cur = rank("2026-11"), prev = rank("2026-10");
  const snap = JSON.stringify([cur, prev]);
  compareWithPrevious(cur, prev);
  assert.equal(JSON.stringify([cur, prev]), snap);
});

console.log(`\n${n} comprobaciones OK`);
