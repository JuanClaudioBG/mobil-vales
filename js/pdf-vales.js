// ============================================================================
//  Lectura del PDF de vales físicos de Combusa
// ============================================================================
//
//  Cada página del PDF trae una rejilla de vales. Cada vale contiene:
//
//      3 SPECTRO
//      Folio: 117,765
//      [ imagen con el código QR ]
//      $ 200.00   [logo Combusa]
//      VENCE 30 SEPTIEMBRE 2026
//
//  La rejilla NO es de tamaño fijo: el PDF de ejemplo trae 4 columnas × 5 filas
//  (20 vales) en las páginas completas y sólo 5 vales en la última. Por eso el
//  número de vales por página se DEDUCE de la posición de los textos "Folio:"
//  en lugar de asumir un número de recortes por página.
//
//  Para el QR no se recorta "a ciegas" un cuadrante de la página: se lee la
//  posición exacta de cada imagen incrustada (siguiendo la matriz de
//  transformación de la lista de operadores de PDF.js) y se renderiza sólo esa
//  región en alta resolución. Después se recortan los márgenes blancos.
//
// ============================================================================

const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Ancho (px) al que se renderiza la imagen incrustada del vale antes de
// recortar el blanco. El QR ocupa ~35% de esa imagen, así que 1100px dejan un
// QR de ~400px con los módulos bien definidos.
const RENDER_WIDTH_PX = 1100;

// Margen blanco ("quiet zone") alrededor del QR, como fracción del lado. Los
// lectores de QR lo necesitan para encontrar el código. Sólo se usa en el
// camino de respaldo (mapa de bits); con la rejilla exacta se usa QUIET_MODULES.
const QUIET_ZONE = 0.08;

// Zona de silencio de la norma QR: 4 módulos por lado.
const QUIET_MODULES = 4;

// Lados (px) que se intentan para el PNG final, de mayor a menor. Si el base64
// supera QR_MAX_BASE64 se reintenta con el siguiente (más pequeño).
const OUT_SIDES_PX = [480, 420, 360, 300];

// Tope de tamaño del base64 de cada QR (~50KB, como pide el diseño).
const QR_MAX_BASE64 = 50 * 1024;

// Un QR es cuadrado. Si el recuadro detectado se acerca a un cuadrado se
// normaliza a cuadrado exacto (el PDF de Combusa coloca una imagen de 600×300
// px en una caja de 120×66 pt, lo que estira el QR ~10% a lo alto). Si la
// proporción se sale de este rango no se toca: probablemente no es un QR.
const SQUARE_TOLERANCE = 0.25;

const RE_FOLIO = /folio\s*:?\s*([\d.,]{3,})/i;
const RE_MONTO = /^\$\s*([\d.,]+)$/;
const RE_VENCE = /vence\s+(\d{1,2})\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s+(\d{4})/i;

const MESES = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

// --- Carga de PDF.js desde la CDN (una sola vez) ----------------------------
let pdfjsPromise = null;
export function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
      resolve(window.pdfjsLib);
      return;
    }
    const script = document.createElement("script");
    script.src = PDFJS_SRC;
    script.onload = () => {
      if (!window.pdfjsLib) {
        reject(new Error("PDF.js se descargó pero no se registró (window.pdfjsLib)."));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
      resolve(window.pdfjsLib);
    };
    script.onerror = () =>
      reject(new Error("No se pudo descargar PDF.js desde la CDN. Revisa la conexión."));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// ===========================================================================
//  Geometría: posición real de cada imagen incrustada
// ===========================================================================
// PDF.js entrega la lista de operadores en espacio de usuario del PDF. Para
// saber DÓNDE se pinta cada imagen hay que seguir la matriz de transformación
// (CTM) a través de save/restore/transform: una imagen siempre se dibuja sobre
// el cuadrado unitario [0,1]×[0,1] transformado por la CTM vigente.
function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function imageRects(OPS, opList) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const rects = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, opList.argsArray[i]);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageMaskXObject ||
      fn === OPS.paintInlineImageXObject
    ) {
      const corners = [
        applyMatrix(ctm, 0, 0),
        applyMatrix(ctm, 1, 0),
        applyMatrix(ctm, 0, 1),
        applyMatrix(ctm, 1, 1),
      ];
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      rects.push({
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
      });
    }
  }
  return rects;
}

// ===========================================================================
//  Rejilla: agrupar textos e imágenes en vales
// ===========================================================================
// Agrupa valores cercanos (dentro de `tol`) y devuelve el centro de cada grupo.
function clusterCenters(values, tol) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else groups.push([v]);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

// Separación típica entre columnas (o filas) = mediana de los huecos.
function medianGap(centers) {
  if (centers.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function digitsOnly(str) {
  return String(str).replace(/\D/g, "");
}

// Caja aproximada de un texto. PDF.js da la línea base (y) y el alto de la
// fuente (h); se estima el ascendente/descendente para cubrir los glifos.
function textBox(it) {
  const h = it.h || 0;
  return { x0: it.x, x1: it.x + (it.w || 0), y0: it.y - h * 0.25, y1: it.y + h * 0.85 };
}

// La caja de la imagen del QR SE SOLAPA con otros elementos de la página (en el
// PDF de Combusa, con el logo y con el texto "$ 200.00"). Como el recorte se
// obtiene renderizando esa región de la página, hay que recortar por arriba y
// por abajo lo que invada la caja; si no, el PNG del QR saldría con el logo
// pegado debajo.
function clipToFreeRegion(rect, obstacles) {
  const rectW = rect.x1 - rect.x0;
  const rectH = rect.y1 - rect.y0;
  if (rectW <= 0 || rectH <= 0) return rect;
  const midY = (rect.y0 + rect.y1) / 2;

  let y0 = rect.y0;
  let y1 = rect.y1;
  for (const ob of obstacles) {
    // Solapamiento horizontal apreciable (>20% del ancho) y vertical.
    const overlapX = Math.min(rect.x1, ob.x1) - Math.max(rect.x0, ob.x0);
    if (overlapX <= rectW * 0.2) continue;
    if (ob.y1 <= rect.y0 || ob.y0 >= rect.y1) continue;
    if ((ob.y0 + ob.y1) / 2 < midY) y0 = Math.max(y0, ob.y1);
    else y1 = Math.min(y1, ob.y0);
  }

  // Si el recorte se come casi toda la caja, algo no cuadra: mejor dejarla
  // entera y que el recorte de blancos haga lo que pueda.
  if (y1 - y0 < rectH * 0.35) return rect;
  return { x0: rect.x0, x1: rect.x1, y0, y1 };
}

// "1,000.00" → 1000 ; "200.00" → 200
function parseMontoText(raw) {
  return Number(String(raw).replace(/,/g, ""));
}

// (30, "SEPTIEMBRE", 2026) → "2026-09-30"
function venceToIso(dia, mes, anio) {
  const key = String(mes)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  const m = MESES[key];
  if (!m) return null;
  return `${anio}-${String(m).padStart(2, "0")}-${String(Number(dia)).padStart(2, "0")}`;
}

// Empareja textos e imágenes de una página en vales.
// `items`: [{ str, x, y, w }] con x/y en espacio de usuario del PDF (y hacia
// arriba) y `w` el ancho del texto. `images`: rectángulos de imageRects().
// Devuelve los vales en orden de lectura: [{ folio, monto, vencimiento, rect }]
export function buildVoucherLayout(items, images, pageSize) {
  const anchors = [];
  const montos = [];
  const vences = [];

  for (const it of items) {
    const str = (it.str || "").trim();
    if (!str) continue;
    let m;
    if ((m = RE_FOLIO.exec(str))) {
      anchors.push({ folio: digitsOnly(m[1]), x: it.x, y: it.y, w: it.w || 0 });
    } else if ((m = RE_MONTO.exec(str))) {
      montos.push({ monto: parseMontoText(m[1]), x: it.x, y: it.y, w: it.w || 0 });
    } else if ((m = RE_VENCE.exec(str))) {
      vences.push({
        vencimiento: venceToIso(m[1], m[2], m[3]),
        x: it.x,
        y: it.y,
        w: it.w || 0,
      });
    }
  }

  // Paso de la rejilla deducido de los folios. Con una sola columna (o una sola
  // fila) el "paso" es toda la página, que es justo el comportamiento correcto.
  const colPitch =
    medianGap(clusterCenters(anchors.map((a) => a.x + a.w / 2), 6)) || pageSize.width;
  const rowPitch = medianGap(clusterCenters(anchors.map((a) => a.y), 6)) || pageSize.height;

  const vouchers = anchors.map((a) => {
    const cx = a.x + a.w / 2;
    const halfW = colPitch * 0.45;
    // Celda del vale: desde un poco por encima del folio hasta casi la
    // siguiente fila. Se evita así "robar" datos del vale de abajo.
    const yTop = a.y + rowPitch * 0.1;
    const yBottom = a.y - rowPitch * 0.8;
    const inCell = (x, y) =>
      Math.abs(x - cx) <= halfW && y <= yTop && y >= yBottom;

    // Texto más cercano por DEBAJO del folio, dentro de la celda.
    const nearestBelow = (list) =>
      list
        .filter((t) => t.y < a.y && inCell(t.x + t.w / 2, t.y))
        .sort((p, q) => q.y - p.y)[0] || null;

    const monto = nearestBelow(montos);
    const vence = nearestBelow(vences);

    // El QR es la imagen MÁS GRANDE de la celda: descarta el logo de Combusa,
    // que es mucho más pequeño y comparte celda con el QR.
    const qrImage =
      images
        .filter(
          (im) =>
            im.y1 <= a.y + 1 && inCell((im.x0 + im.x1) / 2, (im.y0 + im.y1) / 2)
        )
        .sort(
          (p, q) => (q.x1 - q.x0) * (q.y1 - q.y0) - (p.x1 - p.x0) * (p.y1 - p.y0)
        )[0] || null;

    // Todo lo demás de la página estorba al recortar el QR.
    const obstacles = qrImage
      ? images.filter((im) => im !== qrImage).concat(items.map(textBox))
      : [];

    return {
      folio: a.folio,
      monto: monto ? monto.monto : NaN,
      vencimiento: vence ? vence.vencimiento : null,
      rect: qrImage ? clipToFreeRegion(qrImage, obstacles) : null,
      x: cx,
      y: a.y,
    };
  });

  // Orden de lectura: de arriba abajo (y descendente) y de izquierda a derecha.
  // Se comparan las filas con tolerancia de media fila para que pequeñas
  // diferencias de línea base no alteren el orden.
  return vouchers.sort((p, q) => {
    if (Math.abs(q.y - p.y) > rowPitch * 0.5) return q.y - p.y;
    return p.x - q.x;
  });
}

// ===========================================================================
//  Recorte del QR en alta resolución
// ===========================================================================
// Lienzos reutilizados: un PDF de 105 vales haría 210 lienzos nuevos, lo que
// castiga la memoria en móvil. Se reaprovechan cambiándoles el tamaño.
let scratchCanvas = null;
let outCanvas = null;
function getScratch(which, width, height) {
  const ref = which === "out" ? (outCanvas ||= document.createElement("canvas"))
                              : (scratchCanvas ||= document.createElement("canvas"));
  if (ref.width !== width) ref.width = width;
  if (ref.height !== height) ref.height = height;
  return ref;
}

// Renderiza SÓLO la región `rect` de la página, a la escala indicada.
async function renderRegion(page, rect, scale) {
  const viewport = page.getViewport({ scale });
  const a = viewport.convertToViewportPoint(rect.x0, rect.y0);
  const b = viewport.convertToViewportPoint(rect.x1, rect.y1);
  const left = Math.min(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const width = Math.max(1, Math.round(Math.abs(b[0] - a[0])));
  const height = Math.max(1, Math.round(Math.abs(b[1] - a[1])));

  const canvas = getScratch("render", width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Al reutilizar el lienzo hay que borrar lo del vale anterior (si el tamaño
  // no cambió, cambiar width/height no lo limpia).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // `transform` desplaza la salida para que la región quede en el origen del
  // lienzo; PDF.js pinta el fondo en blanco por su cuenta.
  // intent: "print" NO es cosmético. Con el intent por omisión ("display")
  // PDF.js continúa el dibujado con requestAnimationFrame, que el navegador
  // FRENA (o detiene) mientras la pestaña no está visible: una importación de
  // 105 vales se quedaba prácticamente parada al cambiar de pestaña. Con
  // "print" el trabajo avanza en microtareas, sin depender de los fotogramas.
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -left, -top],
    intent: "print",
  }).promise;

  return canvas;
}

// Recuadro de los píxeles oscuros del lienzo (para quitar el blanco de sobra).
function darkBoundingBox(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Luminancia aproximada; ignora píxeles casi transparentes.
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (data[i + 3] > 32 && lum < 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

// ---------------------------------------------------------------------------
//  Rejilla exacta del QR
// ---------------------------------------------------------------------------
// Un QR es una rejilla de N×N módulos, y la imagen renderizada la trae muy
// sobremuestreada (~18 píxeles por módulo). Reconstruir la rejilla módulo a
// módulo da un QR EXACTO, y eso importa por tres motivos:
//   · sin suavizado: los módulos quedan como cuadrados de un tamaño entero de
//     píxeles, así que el código se lee mejor que el impreso en el papel;
//   · el resultado es idéntico en cualquier navegador (cada uno suaviza a su
//     manera, y eso cambiaba el PNG de 3KB a 20KB según el motor);
//   · corrige de paso el estirado del PDF (Combusa mete una imagen de 600×300
//     píxeles en una caja de 120×66 pt, lo que deforma el QR un 10%).
//
// Los QR válidos miden 21, 25, 29 … 177 módulos, siempre 17 + 4·versión.
function esTamanoQrValido(modules) {
  return (
    modules >= 21 && modules <= 177 && (modules - 17) % 4 === 0
  );
}

// Deduce cuántos módulos tiene el QR: el patrón localizador de la esquina
// superior izquierda mide exactamente 7 módulos de ancho, así que la primera
// racha de negro de la fila superior da el tamaño de un módulo.
function contarModulos(px, width, box) {
  const boxW = box.x1 - box.x0 + 1;
  const boxH = box.y1 - box.y0 + 1;
  const oscuro = (x, y) => {
    const i = (y * width + x) * 4;
    return (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 < 128;
  };

  // Se mide unas filas por debajo del borde para evitar el suavizado del canto.
  const fila = box.y0 + Math.max(1, Math.round(boxH * 0.02));
  let racha = 0;
  for (let x = box.x0; x <= box.x1 && oscuro(x, fila); x++) racha++;
  if (racha < 7) return 0;

  const modulo = racha / 7;
  const modules = Math.round(boxW / modulo);
  return esTamanoQrValido(modules) ? modules : 0;
}

// Lee el QR del lienzo a una matriz de booleanos [fila][columna].
function leerMatrizQr(canvas, box) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const modules = contarModulos(data, width, box);
  if (!modules) return null;

  const boxW = box.x1 - box.x0 + 1;
  const boxH = box.y1 - box.y0 + 1;
  const pasoX = boxW / modules;
  const pasoY = boxH / modules;
  // Se promedia el centro del módulo (40% central) para no depender de un solo
  // píxel y absorber el suavizado de los bordes.
  const radioX = Math.max(0, Math.floor(pasoX * 0.2));
  const radioY = Math.max(0, Math.floor(pasoY * 0.2));

  const matriz = [];
  for (let fila = 0; fila < modules; fila++) {
    const cy = Math.round(box.y0 + (fila + 0.5) * pasoY);
    const linea = [];
    for (let col = 0; col < modules; col++) {
      const cx = Math.round(box.x0 + (col + 0.5) * pasoX);
      let suma = 0;
      let n = 0;
      for (let dy = -radioY; dy <= radioY; dy++) {
        for (let dx = -radioX; dx <= radioX; dx++) {
          const i = ((cy + dy) * width + (cx + dx)) * 4;
          suma += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          n++;
        }
      }
      linea.push(suma / n < 128);
    }
    matriz.push(linea);
  }
  return matriz;
}

// Dibuja la matriz con módulos de tamaño entero y la zona de silencio que pide
// la norma (4 módulos), y devuelve el PNG en base64.
function matrizAPngBase64(matriz) {
  const modules = matriz.length;
  const lado = modules + QUIET_MODULES * 2;
  const escala = Math.max(1, Math.floor(OUT_SIDES_PX[0] / lado));
  const outSide = lado * escala;

  const out = getScratch("out", outSide, outSide);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outSide, outSide);
  ctx.fillStyle = "#000000";
  for (let fila = 0; fila < modules; fila++) {
    for (let col = 0; col < modules; col++) {
      if (!matriz[fila][col]) continue;
      ctx.fillRect(
        (col + QUIET_MODULES) * escala,
        (fila + QUIET_MODULES) * escala,
        escala,
        escala
      );
    }
  }
  return out.toDataURL("image/png").split(",")[1];
}

// Deja el lienzo en blanco y negro puros (sin grises intermedios).
function binarize(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    const v = lum < 128 ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

// Compone el QR recortado sobre un lienzo con margen blanco y devuelve el PNG
// en base64 (sin el prefijo "data:image/png;base64,").
function toPngBase64(src, box, outSide) {
  const boxW = box.x1 - box.x0 + 1;
  const boxH = box.y1 - box.y0 + 1;
  const quiet = Math.round(outSide * QUIET_ZONE);
  const inner = outSide - quiet * 2;

  // Un QR es cuadrado: si el recuadro casi lo es, se corrige el estiramiento
  // que introduce la colocación de la imagen en el PDF. Si no, se respeta la
  // proporción original.
  const ratio = boxW / boxH;
  const square = ratio > 1 - SQUARE_TOLERANCE && ratio < 1 + SQUARE_TOLERANCE;
  let drawW;
  let drawH;
  if (square) {
    drawW = inner;
    drawH = inner;
  } else {
    const k = inner / Math.max(boxW, boxH);
    drawW = Math.max(1, Math.round(boxW * k));
    drawH = Math.max(1, Math.round(boxH * k));
  }

  const out = getScratch("out", outSide, outSide);
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outSide, outSide);
  // Al reducir conviene suavizar; al ampliar, no (bordes de módulo nítidos).
  ctx.imageSmoothingEnabled = drawW < boxW;
  ctx.drawImage(
    src,
    box.x0,
    box.y0,
    boxW,
    boxH,
    Math.round((outSide - drawW) / 2),
    Math.round((outSide - drawH) / 2),
    drawW,
    drawH
  );

  // Un QR sólo tiene negro y blanco. Al pasar los grises del antialiasing a
  // blanco o negro puro el PNG comprime muchísimo mejor (de ~20KB a ~3KB en
  // Chrome), el código queda más nítido y el resultado es idéntico en cualquier
  // navegador (cada uno suaviza a su manera).
  binarize(ctx, outSide, outSide);
  return out.toDataURL("image/png").split(",")[1];
}

// Renderiza, recorta y codifica el QR de un vale. Reduce el tamaño si el
// base64 supera el tope.
async function extractQrBase64(page, rect) {
  const widthPt = rect.x1 - rect.x0;
  const scale = Math.min(40, Math.max(2, RENDER_WIDTH_PX / Math.max(1, widthPt)));
  const canvas = await renderRegion(page, rect, scale);
  const box = darkBoundingBox(canvas);
  if (!box) return null; // imagen en blanco: no hay QR que recortar

  // Camino preferente: reconstruir la rejilla de módulos (QR exacto y ligero).
  const matriz = leerMatrizQr(canvas, box);
  if (matriz) {
    const exacto = matrizAPngBase64(matriz);
    // En la práctica son ~9KB; la comprobación garantiza el tope documentado.
    if (exacto.length <= QR_MAX_BASE64) return exacto;
  }

  // Respaldo: si no se reconoció la rejilla, se guarda el recorte tal cual.
  let base64 = null;
  for (const side of OUT_SIDES_PX) {
    base64 = toPngBase64(canvas, box, side);
    if (base64.length <= QR_MAX_BASE64) return base64;
  }
  return base64; // el más pequeño posible, aunque exceda el tope
}

// ===========================================================================
//  API principal
// ===========================================================================
// Lee el PDF y devuelve { vouchers, problemas }.
//   vouchers: [{ folio, monto, vencimiento, qrImageBase64, pagina }]
//   problemas: mensajes de los vales que no se pudieron leer
// `onProgress({ page, pages, found })` se llama durante el análisis.
export async function extractVouchersFromPdf(file, onProgress = () => {}) {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const vouchers = [];
  const problemas = [];

  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress({ page: n, pages: pdf.numPages, found: vouchers.length });

      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = textContent.items
        .filter((it) => it.str && it.transform)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width || 0,
          h: it.height || Math.abs(it.transform[3]) || 0,
        }));
      const images = imageRects(pdfjsLib.OPS, await page.getOperatorList());
      const cells = buildVoucherLayout(items, images, {
        width: viewport.width,
        height: viewport.height,
      });

      for (const cell of cells) {
        if (!cell.folio) continue;
        if (!Number.isFinite(cell.monto) || cell.monto <= 0) {
          problemas.push(`Folio ${cell.folio} (pág. ${n}): no se leyó el monto.`);
          continue;
        }
        if (!cell.rect) {
          problemas.push(`Folio ${cell.folio} (pág. ${n}): no se encontró la imagen del QR.`);
          continue;
        }
        const qrImageBase64 = await extractQrBase64(page, cell.rect);
        if (!qrImageBase64) {
          problemas.push(`Folio ${cell.folio} (pág. ${n}): el QR salió en blanco.`);
          continue;
        }
        vouchers.push({
          folio: cell.folio,
          monto: cell.monto,
          vencimiento: cell.vencimiento,
          qrImageBase64,
          pagina: n,
        });
        onProgress({ page: n, pages: pdf.numPages, found: vouchers.length });
      }

      page.cleanup();
    }
  } finally {
    pdf.destroy();
  }

  // Orden de lectura definitivo: por folio ascendente.
  vouchers.sort((a, b) => Number(a.folio) - Number(b.folio));
  return { vouchers, problemas };
}
