// ============================================================================
//  Gráficas estáticas para el Excel
// ============================================================================
//  ExcelJS 4.4.0 no sabe crear gráficas nativas (lo comprobamos: su bundle no
//  trae ni una referencia a chartSpace), pero sí sabe incrustar imágenes. Aquí
//  se dibujan en un <canvas> DESPRENDIDO del documento y se devuelven como PNG.
//
//  Son INSTANTÁNEAS: no se recalculan si alguien edita el libro. Por eso cada
//  gráfica va acompañada en su hoja por la tabla con sus números exactos.
//
//  Reglas de este módulo:
//   · paleta clara FIJA — nunca se leen las variables CSS del tema oscuro de
//     la app, que sobre papel blanco resultan ilegibles;
//   · dimensiones explícitas (nada de clientWidth: el canvas no está en el DOM);
//   · UN SOLO canvas, reutilizado por todas las gráficas del libro y liberado
//     al final: un libro con muchos meses no puede retener un lienzo por mes;
//   · las gráficas de mes son deliberadamente pequeñas: se dibuja una por hoja
//     y un histórico largo acumularía peso rápidamente.
// ============================================================================
import { money } from "./utils.js";

// --- Paleta de exportación (clara, pensada para papel blanco) ---------------
const ROJO = "#e31e24";        // rojo Spectro
const TINTA = "#1f2430";
const SUAVE = "#6b7280";
const RETICULA = "#e3e6ea";
const EJE = "#c2c8d0";
const FONDO = "#ffffff";
// Mismos tonos que los badges de la app, en su versión saturada.
const COLOR_CATEGORIA = {
  Empleado: "#3aa0ff",
  Familia: "#22c98e",
  Socio: "#7c4dff",
};
const COLOR_OTRO = "#b0b8c4";

const FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const fuente = (px, peso) => `${peso ? peso + " " : ""}${px}px ${FUENTE}`;

/* Tamaño lógico (px CSS) de cada gráfica.
   `meses` es la única grande: va sola en el Dashboard.
   `donutMes` es pequeña a propósito: se repite una vez por cada mes. */
/* `escala` es el sobremuestreo con el que se dibuja cada gráfica. La del
   Dashboard va a 2× porque es grande y sale una sola vez; las donas de mes van
   a 1,5× a propósito: se repite una por hoja y a 2× cada PNG pesaba ~40-50 KB,
   que en un histórico largo son cientos de KB de más. A 1,5× siguen viéndose
   nítidas al 100 % de zoom. */
export const TAM = {
  meses: { width: 496, height: 280, escala: 2 },
  donutMes: { width: 336, height: 188, escala: 1.5 },
};
const MAX_PIXELES = 2_200_000; // tope de seguridad en memoria

/* Un único canvas desprendido, reutilizado por todas las gráficas del libro.
   No se añade nunca al documento. */
let lienzo = null;
function contexto(w, h, escalaPedida = 2) {
  const escala = Math.min(escalaPedida, Math.sqrt(MAX_PIXELES / (w * h)));
  if (!lienzo) lienzo = document.createElement("canvas");
  lienzo.width = Math.round(w * escala);
  lienzo.height = Math.round(h * escala);
  const ctx = lienzo.getContext("2d");
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.fillStyle = FONDO;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "middle";
  return ctx;
}
const alPng = () => lienzo.toDataURL("image/png");

/* Libera los píxeles del canvas. En iOS el backing store no se recupera solo
   y un libro con muchos meses dibuja muchas veces sobre el mismo lienzo. */
export function liberarLienzo() {
  if (!lienzo) return;
  lienzo.width = 0;
  lienzo.height = 0;
  lienzo = null;
}

// Techo "bonito" para el eje: 1/2/2.5/5 × 10^n por encima del máximo real.
function techo(max) {
  if (max <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  for (const paso of [1, 2, 2.5, 5, 10]) if (max <= paso * exp) return paso * exp;
  return 10 * exp;
}

// --- 1. Importe por mes (barras verticales) — única gráfica del Dashboard ---
export function graficaMeses(serie) {
  const { width: w, height: h } = TAM.meses;
  // Sin importe en ninguno de los meses no se dibuja nada: una gráfica de
  // ceros sugeriría que hubo actividad plana, y no la hubo.
  if (!serie.length || serie.every((m) => !m.importe)) return null;

  const ctx = contexto(w, h, TAM.meses.escala);
  const padL = 72, padR = 14, padT = 16, padB = 40;
  const ancho = w - padL - padR;
  const alto = h - padT - padB;
  const max = techo(Math.max(...serie.map((m) => m.importe)));

  // Retícula + eje Y en importes.
  ctx.textAlign = "right";
  ctx.font = fuente(10);
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(padT + alto - (alto * i) / 4) + 0.5;
    ctx.strokeStyle = i === 0 ? EJE : RETICULA;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + ancho, y);
    ctx.stroke();
    ctx.fillStyle = SUAVE;
    ctx.fillText(money(Math.round((max / 4) * i)), padL - 8, y);
  }

  const hueco = ancho / serie.length;
  const barra = Math.min(30, hueco * 0.62);
  serie.forEach((m, i) => {
    const x = padL + hueco * i + (hueco - barra) / 2;
    const altoBarra = (m.importe / max) * alto;
    // Un mes sin actividad se queda sin barra (importe 0), nunca con una falsa.
    if (altoBarra > 0) {
      ctx.fillStyle = ROJO;
      ctx.fillRect(x, padT + alto - altoBarra, barra, altoBarra);
    }
    const anio = m.key.slice(0, 4);
    ctx.textAlign = "center";
    ctx.fillStyle = SUAVE;
    ctx.font = fuente(10);
    ctx.fillText(m.label.split(" ")[0], x + barra / 2, padT + alto + 14);
    // El año sólo se escribe cuando cambia, para no repetirlo doce veces.
    if (i === 0 || serie[i - 1].key.slice(0, 4) !== anio) {
      ctx.font = fuente(9, "600");
      ctx.fillStyle = TINTA;
      ctx.fillText(anio, x + barra / 2, padT + alto + 28);
    }
  });
  return alPng();
}

// --- 2. Dona de importe por categoría — una por hoja de mes ------------------
/* `filas` son las categorías del mes con { categoria, count, importe, pct }.
   Devuelve null si no hay importe: la hoja escribe entonces un vacío honesto
   en vez de una dona inventada. */
export function graficaDonutCategorias(filas, tam = TAM.donutMes) {
  const total = filas.reduce((a, f) => a + f.importe, 0);
  if (!total) return null;

  const { width: w, height: h } = tam;
  const ctx = contexto(w, h, tam.escala || 2);
  const cx = 82, cy = h / 2, rExt = 66, rInt = 40;

  let ang = -Math.PI / 2;
  filas.forEach((f) => {
    const barrido = (f.importe / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rExt, ang, ang + barrido);
    ctx.arc(cx, cy, rInt, ang + barrido, ang, true);
    ctx.closePath();
    ctx.fillStyle = COLOR_CATEGORIA[f.categoria] || COLOR_OTRO;
    ctx.fill();
    // Con una sola categoría no hay nada que separar: el círculo va completo.
    if (filas.length > 1) {
      ctx.strokeStyle = FONDO;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ang += barrido;
  });

  // Importe del mes al centro de la dona.
  ctx.textAlign = "center";
  ctx.fillStyle = TINTA;
  ctx.font = fuente(14, "700");
  ctx.fillText(money(total), cx, cy - 5);
  ctx.fillStyle = SUAVE;
  ctx.font = fuente(9);
  ctx.fillText("del mes", cx, cy + 11);

  // Leyenda: categoría, porcentaje e importe.
  const x = 172;
  const salto = Math.min(30, (h - 20) / Math.max(filas.length, 1));
  let y = cy - ((filas.length - 1) * salto) / 2;
  ctx.textAlign = "left";
  for (const f of filas) {
    ctx.fillStyle = COLOR_CATEGORIA[f.categoria] || COLOR_OTRO;
    ctx.fillRect(x, y - 5, 10, 10);
    ctx.fillStyle = TINTA;
    ctx.font = fuente(11, "600");
    ctx.fillText(`${f.categoria}  ${(f.pct * 100).toFixed(1)}%`, x + 17, y - 1);
    ctx.fillStyle = SUAVE;
    ctx.font = fuente(9);
    ctx.fillText(`${money(f.importe)} · ${f.count} vales`, x + 17, y + 11);
    y += salto;
  }
  return alPng();
}

/* Dibuja TODAS las gráficas del libro sobre el mismo lienzo y lo libera.
   Devuelve { meses, porMes: { "YYYY-MM": png|null } }. Un null significa
   «este mes no tiene importe»: la hoja no incrusta imagen. */
export function renderGraficas({ metrics, meses }) {
  try {
    const porMes = {};
    for (const [clave, resumen] of meses) {
      porMes[clave] = graficaDonutCategorias(resumen.categorias);
    }
    return { meses: graficaMeses(metrics.serieMeses), porMes };
  } finally {
    liberarLienzo();
  }
}
