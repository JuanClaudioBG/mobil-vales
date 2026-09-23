// ============================================================================
//  Utilidades compartidas entre módulos
// ============================================================================

// Formato de moneda de la app: $1,000
export function money(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX");
}

// Escapa texto antes de insertarlo con innerHTML.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "YYYY-MM-DD" de hoy (para inputs date y comparación de vencimientos).
export function todayInput() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// ============================================================================
//  Fechas
// ============================================================================

/* Convierte a Date el valor de un campo de fecha, o null si no hay fecha
   utilizable. Acepta Timestamp de Firestore (se detecta por su método
   .toDate(), no con `instanceof`, para que este módulo siga sin depender de
   Firebase y se pueda probar desde Node), Date, número y cadena.

   Devuelve null —y no un Date inválido— ante una cadena que no se puede
   interpretar. Esto es lo que mantiene viva la cadena de respaldo de
   valeDate(): `new Date("marzo")` produce un Date INVÁLIDO, que es truthy, y
   con el `||` de la cadena cortocircuitaría el respaldo dejando el vale con
   una fecha inutilizable en vez de pasar al siguiente campo. */
export function toValidDate(valor) {
  if (!valor) return null;
  const d = typeof valor.toDate === "function" ? valor.toDate()
    : valor instanceof Date ? valor
    : new Date(valor);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

/* Fecha efectiva de un vale para reportes, filtros y agregaciones.
   Regla canónica, la MISMA en el Dashboard y en el Excel:

       fechaVale  →  fecha (vales antiguos)  →  createdAt

   Un campo ilegible no interrumpe la cadena: se pasa al siguiente. Si ninguno
   sirve el vale queda SIN FECHA (null) y cada consumidor decide qué hacer con
   él; nunca se le inventa una. */
export function valeDate(v) {
  return toValidDate(v.fechaVale) || toValidDate(v.fecha) || toValidDate(v.createdAt);
}
