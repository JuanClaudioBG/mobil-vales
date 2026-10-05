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

// ============================================================================
//  Red: tiempos de espera y reintento
// ============================================================================
//  En iPhone con datos móviles (5G con señal débil) el stream de Firestore se
//  queda a veces "a medias": no falla, simplemente no progresa. Antes bastaba
//  con eso para pintar el error rojo. Ahora cada lectura dispone de más tiempo
//  y de UN reintento automático; el error sólo se muestra si el reintento
//  también falla.
// ============================================================================

// Margen por lectura. Eran 15 s, demasiado justo para una red móvil lenta.
export const FIRESTORE_TIMEOUT_MS = 30_000;

/* Rechaza si la promesa no se resuelve dentro de `ms` (evita cuelgues
   indefinidos). El temporizador se cancela en cuanto la promesa termina, así
   que una lectura rápida no deja un setTimeout vivo detrás. */
export function withTimeout(promise, ms = FIRESTORE_TIMEOUT_MS) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Tiempo de espera agotado al conectar con Firestore")),
        ms
      );
    }),
  ]);
}

/* Pausa antes del reintento. NO es un adorno: cuando el SDK de Firestore se
   da por desconectado, las lecturas "desde el servidor" fallan AL INSTANTE
   —devuelven ese veredicto de memoria sin tocar la red—, así que un reintento
   inmediato falla siempre y no sirve de nada. Esta pausa le da tiempo a
   restablecer su canal, que es lo que hace útil al reintento justo en el caso
   que nos importa: la red móvil que va y viene. Medido contra la app real. */
export const RETRY_DELAY_MS = 2_500;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ejecuta `leer()` con tiempo de espera y, si falla, lo reintenta UNA vez tras
   una pausa breve. `leer` tiene que ser una función (no una promesa ya
   lanzada): el reintento necesita empezar una lectura nueva.

   `onRetry` se llama justo antes de esa pausa —es donde la interfaz avisa
   "Conexión lenta, reintentando…"— y `onSettled` al terminar, haya salido bien
   o mal, para poder retirar ese aviso. Si el segundo intento también falla, el
   error se propaga tal cual y lo muestra quien llama. */
export async function withRetry(leer, { onRetry, onSettled, ms, delayMs } = {}) {
  try {
    return await withTimeout(leer(), ms);
  } catch (primerError) {
    console.warn("[vales] primer intento fallido, se reintenta:", primerError);
    if (onRetry) onRetry();
    try {
      await dormir(delayMs ?? RETRY_DELAY_MS);
      return await withTimeout(leer(), ms);
    } finally {
      if (onSettled) onSettled();
    }
  }
}
