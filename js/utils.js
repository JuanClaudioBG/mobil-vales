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
