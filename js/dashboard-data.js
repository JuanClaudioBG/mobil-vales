// ============================================================================
//  Dashboard: motor de filtros y agregaciones (funciones PURAS)
// ============================================================================
//  Sin DOM ni Firebase: reciben registros ya normalizados por app.js
//  ({ id, nombre, categoria, monto, date, anulado, folio }) y
//  devuelven datos. Todos los widgets del dashboard consumen el MISMO
//  resultado de filterDashboardVales(), así nunca hay dos poblaciones distintas.
//
//  Área NO existe en los documentos de `vales` (ver hasOnlyAllowedFields() en
//  firestore.rules), por eso no hay dimensión de área en el filtro.
//  TODO: filtro Área — requiere un campo real `area` en los vales; no derivar
//        el área histórica de PERSONAS.depto.
//  TODO: filtro Unidad — pendiente de producto
// ============================================================================

// "YYYY-MM-DD" de una fecha en hora local.
export function isoDay(d) {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// "YYYY-MM" de una fecha en hora local.
export function isoMonth(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Preset de mes → rango canónico { dateFrom, dateTo } (ambos inclusivos).
export function monthRange(key) {
  const [y, m] = key.split("-").map(Number);
  return { dateFrom: isoDay(new Date(y, m - 1, 1)), dateTo: isoDay(new Date(y, m, 0)) };
}

// Si el rango coincide exactamente con un mes calendario devuelve "YYYY-MM".
export function rangeMonthKey(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return null;
  const key = dateFrom.slice(0, 7);
  const r = monthRange(key);
  return r.dateFrom === dateFrom && r.dateTo === dateTo ? key : null;
}

export const EMPTY_FILTERS = Object.freeze({ persona: "", tipo: "", dateFrom: "", dateTo: "" });

// Filtro único del dashboard. AND entre campos con valor; vacío = sin filtrar.
// Incluye anulados: cada agregación decide (siempre los excluye de montos).
// `ignorePeriod` sólo lo usa la serie mensual, que necesita meses de contexto
// alrededor del periodo con las MISMAS dimensiones.
export function filterDashboardVales(records, filters, { ignorePeriod = false } = {}) {
  const { persona, tipo, dateFrom, dateTo } = { ...EMPTY_FILTERS, ...filters };
  return records.filter((r) => {
    if (persona && r.nombre !== persona) return false;
    if (tipo && r.categoria !== tipo) return false;
    if (ignorePeriod || (!dateFrom && !dateTo)) return true;
    if (!r.date) return false; // sin fecha no puede pertenecer a un periodo
    const day = isoDay(r.date);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });
}

const amountOf = (r) => {
  const n = Number(r.monto);
  return Number.isFinite(n) ? n : 0;
};

export function activeOnly(records) {
  return records.filter((r) => !r.anulado);
}

// KPIs del periodo: sólo vales activos.
export function calculateDashboardMetrics(filtered) {
  const active = activeOnly(filtered);
  const byTipo = new Map();
  let total = 0;
  for (const r of active) {
    const amount = amountOf(r);
    total += amount;
    const agg = byTipo.get(r.categoria) || { count: 0, total: 0 };
    agg.count += 1;
    agg.total += amount;
    byTipo.set(r.categoria, agg);
  }
  return {
    count: active.length,
    total,
    annulledCount: filtered.length - active.length,
    byTipo, // categoria → { count, total }
  };
}

// Ranking de solicitantes: importe desc → nº de vales desc → alfabético.
export function aggregateTopRequesters(filtered) {
  const map = new Map();
  for (const r of activeOnly(filtered)) {
    const name = r.nombre || "Sin nombre";
    const agg = map.get(name) || { name, total: 0, count: 0 };
    agg.total += amountOf(r);
    agg.count += 1;
    map.set(name, agg);
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name, "es")
  );
}

// Filas del detalle de un solicitante (activos, más reciente primero).
export function requesterDetailRows(filtered, name) {
  return activeOnly(filtered)
    .filter((r) => (r.nombre || "Sin nombre") === name)
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
}

// Meses de la gráfica: los que cubre el periodo, mínimo 6 (hacia atrás desde
// el mes final) y máximo 12 (los últimos). Sin periodo: 6 meses hasta `today`.
export function chartMonths(dateFrom, dateTo, today = new Date()) {
  const end = dateTo ? new Date(dateTo.slice(0, 7) + "-01T00:00:00") : new Date(today.getFullYear(), today.getMonth(), 1);
  let start = dateFrom ? new Date(dateFrom.slice(0, 7) + "-01T00:00:00") : end;
  const span = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
  const n = Math.min(12, Math.max(6, span));
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(isoMonth(new Date(end.getFullYear(), end.getMonth() - i, 1)));
  return months;
}

// ¿El mes "YYYY-MM" se cruza con el periodo activo?
export function monthInPeriod(key, dateFrom, dateTo) {
  const r = monthRange(key);
  return (!dateTo || r.dateFrom <= dateTo) && (!dateFrom || r.dateTo >= dateFrom);
}

// Serie mensual apilada. `dimensionFiltered` = mismas dimensiones sin periodo.
// Segmentos: los solicitantes de `segmentNames` y el resto como "Otros".
export function aggregateMonthlySeries(dimensionFiltered, months, segmentNames) {
  const keys = new Set(months);
  const segs = new Set(segmentNames);
  const rows = new Map(months.map((m) => [m, { month: m, total: 0, count: 0, bySegment: new Map() }]));
  for (const r of activeOnly(dimensionFiltered)) {
    if (!r.date) continue;
    const key = isoMonth(r.date);
    if (!keys.has(key)) continue;
    const row = rows.get(key);
    const amount = amountOf(r);
    const seg = segs.has(r.nombre) ? r.nombre : OTROS;
    row.total += amount;
    row.count += 1;
    row.bySegment.set(seg, (row.bySegment.get(seg) || 0) + amount);
  }
  return months.map((m) => rows.get(m));
}

export const OTROS = "Otros";
