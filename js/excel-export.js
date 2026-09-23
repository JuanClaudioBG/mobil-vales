// ============================================================================
//  Exportación a Excel (.xlsx)
// ============================================================================
//  Este módulo NO conoce el DOM de la app ni Firestore: recibe una lista de
//  vales ya normalizados (ver `valesParaExcel()` en app.js) y devuelve el Blob
//  del libro. Así la lógica de agregación se puede probar desde Node sin
//  navegador ni Firebase.
//
//  Se usa ExcelJS y no SheetJS: la edición gratuita de SheetJS no escribe
//  estilos de celda (colores, negritas) ni inmoviliza paneles —lo comprobamos
//  generando un libro y leyendo su styles.xml—, y aquí hacen falta las dos
//  cosas. ExcelJS las trae de serie y además pesa menos que xlsx.full.min.js.
//
//  La librería se descarga BAJO DEMANDA al pedir el libro: son ~930 KB que no
//  tienen por qué penalizar cada carga de la app en el celular.
//
//  Forma de cada vale normalizado:
//    { nombre, categoria, monto, fecha: Date|null, registradoPor,
//      folio: string|null, anulado: boolean, notas }
//  A propósito NO incluye qrCode ni batchId: el QR es una credencial
//  operativa del vale y no tiene ningún uso analítico aquí.
// ============================================================================
import { money } from "./utils.js";
import { renderGraficas, TAM } from "./excel-charts.js";

const EXCELJS_CDN = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
let excelJsPromise = null;

function cargarExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (excelJsPromise) return excelJsPromise;
  excelJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = EXCELJS_CDN;
    script.onload = () =>
      window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error("ExcelJS no se registró"));
    script.onerror = () => {
      excelJsPromise = null; // permite reintentar en el siguiente clic
      reject(new Error("No se pudo descargar la librería de Excel"));
    };
    document.head.appendChild(script);
  });
  return excelJsPromise;
}

// Colores de marca en ARGB (el formato que espera ExcelJS).
const XLS_ROJO = "FFED1C24";
const XLS_ROJO_BORDE = "FFBF3030";
const XLS_BLANCO = "FFFFFFFF";
const XLS_GRIS = "FFF4F4F4";
const XLS_MONEDA = '"$"#,##0';
const XLS_BORDE = "FFD0D0D0";        // retícula gris clara
const XLS_BORDE_TOTAL = "FFA0A0A0";  // línea gruesa sobre la fila TOTAL
const XLS_TOTAL_BG = "FFF0F0F0";
// Tintes por categoría: los mismos códigos que usa la app, aclarados para que
// el texto negro siga leyéndose sin problema sobre ellos.
const XLS_CATEGORIA = {
  Empleado: "FFE3F2FD", // azul claro
  Familia: "FFE8F5E9",  // verde claro
  Socio: "FFEDE7F6",    // morado claro
};
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/* Descripción de las columnas de cada tipo de hoja: alineación, si llevan
   formato de moneda, si se suman en la fila TOTAL y cuál trae la categoría. */
const COLS_HISTORICO = [
  { titulo: "Nombre", align: "left" },
  { titulo: "Vales", align: "center", suma: true },
  { titulo: "Total", align: "right", moneda: true, suma: true },
];
const COLS_MES = [
  { titulo: "Nombre", align: "left" },
  { titulo: "Categoría", align: "left", categoria: true },
  { titulo: "Vales", align: "center", suma: true },
  { titulo: "Total", align: "right", moneda: true, suma: true },
];

// ---------------------------------------------------------------------------
//  Agregación  (semántica idéntica a la que vivía en app.js)
// ---------------------------------------------------------------------------

// Sólo los vales NO anulados.
export function activos(vales) {
  return vales.filter((v) => !v.anulado);
}

// Clave "YYYY-MM" de una fecha ya resuelta (hora local), o null si no hay.
export function monthKey(fecha) {
  if (!fecha) return null;
  return fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0");
}

/* Resumen histórico por persona, sin contar anulados, de mayor a menor gasto.
   Conserva el comportamiento de groupSum(): los vales sin `nombre` se omiten
   de esta hoja. El Detalle sí los incluye. */
export function filasHistorico(vales) {
  const porPersona = new Map();
  for (const v of activos(vales)) {
    const k = v.nombre;
    if (k == null) continue;
    const agg = porPersona.get(k) || { count: 0, total: 0 };
    agg.count += 1;
    agg.total += Number(v.monto) || 0;
    porPersona.set(k, agg);
  }
  return [...porPersona.entries()]
    .map(([nombre, agg]) => ({ nombre, count: agg.count, total: agg.total }))
    .sort((a, b) => b.total - a.total);
}

// Vales activos agrupados por mes local (misma regla que el dashboard),
// del mes más reciente al más antiguo.
export function valesPorMes(vales) {
  const porMes = new Map();
  for (const v of activos(vales)) {
    const clave = monthKey(v.fecha);
    if (!clave) continue;
    if (!porMes.has(clave)) porMes.set(clave, []);
    porMes.get(clave).push(v);
  }
  return [...porMes.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

// "2026-08" -> "Ago 2026"
export function nombreHojaMes(clave) {
  const [anio, mes] = clave.split("-").map(Number);
  return MESES_CORTOS[mes - 1] + " " + anio;
}

// Resumen por persona dentro de un mes, de mayor a menor gasto.
export function filasDelMes(vales) {
  const porPersona = new Map();
  for (const v of vales) {
    const agg = porPersona.get(v.nombre) ||
      { nombre: v.nombre, categoria: v.categoria || "", count: 0, total: 0 };
    agg.count += 1;
    agg.total += Number(v.monto) || 0;
    if (!agg.categoria && v.categoria) agg.categoria = v.categoria;
    porPersona.set(v.nombre, agg);
  }
  return [...porPersona.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
//  Formato de hoja
// ---------------------------------------------------------------------------

/* Formato común de cada hoja. Todo se aplica por celda: fijar estilos a nivel
   de columna pisaría el formato de la cabecera. */
function bordeGris(extra) {
  const linea = { style: "thin", color: { argb: XLS_BORDE } };
  return Object.assign({ top: linea, left: linea, bottom: linea, right: linea }, extra || {});
}

/* Añade la fila TOTAL al final de la hoja sumando las columnas marcadas. */
function agregarFilaTotal(ws, cols, filaInicio = 1) {
  const primera = filaInicio + 1;
  const ultima = ws.rowCount;
  const valores = cols.map((col, i) => {
    if (i === 0) return "TOTAL";
    if (!col.suma) return "";
    let acc = 0;
    for (let r = primera; r <= ultima; r++) acc += Number(ws.getRow(r).getCell(i + 1).value) || 0;
    return acc;
  });
  ws.addRow(valores);
}

/* Formato completo de una hoja: retícula, cabecera roja, tinte por categoría
   (o sombreado alterno si la hoja no tiene esa columna), moneda, alineación,
   alto de fila, fila TOTAL destacada y anchos automáticos. */
function formatearHoja(ws, cols, filaInicio = 1) {
  // Sólo se inmoviliza la cabecera cuando la tabla empieza arriba del todo
  // (Histórico). En las hojas de mes la tabla va debajo del área de insights:
  // congelar hasta ahí dejaría media pantalla fija.
  if (filaInicio === 1) ws.views = [{ state: "frozen", ySplit: 1 }];

  const filaTotal = ws.rowCount;                       // la última fila es TOTAL
  const colCategoria = cols.findIndex((c) => c.categoria) + 1; // 0 si no la hay

  for (let r = filaInicio; r <= filaTotal; r++) {
    const fila = ws.getRow(r);
    const esCabecera = r === filaInicio;
    const esTotal = r === filaTotal;

    // Color de fondo de la fila de datos: por categoría si la hoja la trae;
    // si no (Histórico), se conserva el sombreado alterno.
    let fondo = null;
    if (!esCabecera && !esTotal) {
      fondo = colCategoria
        ? XLS_CATEGORIA[String(fila.getCell(colCategoria).value || "").trim()] || null
        : (r - filaInicio) % 2 === 0 ? XLS_GRIS : null;
    }

    // Se recorren los índices de columna, no las celdas existentes: así la
    // retícula cubre también las celdas vacías del rango.
    for (let c = 1; c <= cols.length; c++) {
      const col = cols[c - 1];
      const celda = fila.getCell(c);

      celda.border = bordeGris(
        esCabecera
          ? { bottom: { style: "thin", color: { argb: XLS_ROJO_BORDE } } }
          : esTotal
            ? { top: { style: "medium", color: { argb: XLS_BORDE_TOTAL } } }
            : null
      );
      celda.alignment = { horizontal: col.align, vertical: "middle" };

      if (esCabecera) {
        celda.font = { bold: true, color: { argb: XLS_BLANCO }, size: 11 };
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_ROJO } };
      } else {
        if (esTotal) {
          celda.font = { bold: true };
          celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_TOTAL_BG } };
        } else if (fondo) {
          celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
        }
        if (col.moneda) celda.numFmt = XLS_MONEDA;
      }
    }

    fila.height = esCabecera ? 24 : 19; // algo más de aire que el alto por defecto
  }

  // Ancho por columna según su contenido más largo.
  for (let c = 1; c <= cols.length; c++) {
    const col = cols[c - 1];
    let ancho = 10;
    for (let r = filaInicio; r <= filaTotal; r++) {
      const v = ws.getRow(r).getCell(c).value;
      const texto = v == null ? "" : typeof v === "number" && col.moneda ? money(v) : String(v);
      ancho = Math.max(ancho, texto.length + 3);
    }
    ws.getColumn(c).width = Math.min(ancho, 42);
  }
}

// ---------------------------------------------------------------------------
//  Detalle  (Slice 2)  —  un renglón por vale persistido, activos Y anulados
// ---------------------------------------------------------------------------
export const SIN_NOMBRE = "(Sin nombre)";
export const SIN_CATEGORIA = "(Sin categoría)";
export const SIN_FECHA = "(Sin fecha)";

const texto = (v) => (v == null ? "" : String(v).trim());
export const etiquetaNombre = (v) => texto(v.nombre) || SIN_NOMBRE;
export const etiquetaCategoria = (v) => texto(v.categoria) || SIN_CATEGORIA;

const COLS_DETALLE = [
  { titulo: "Nombre", align: "left" },
  { titulo: "Categoría", align: "left", categoria: true },
  { titulo: "Monto", align: "right", moneda: true },
  { titulo: "Fecha del vale", align: "center", fecha: true },
  { titulo: "Registrado por", align: "left" },
  { titulo: "Folio", align: "center" },
  { titulo: "Estado", align: "center" },
  { titulo: "Notas", align: "left", ancho: 38 },
];

/* Renglones del Detalle, en el mismo orden en que llegan los vales (la app los
   entrega de más reciente a más antiguo). No se descarta NINGÚN vale: los que
   no traen nombre, categoría o fecha se etiquetan explícitamente. */
export function filasDetalle(vales) {
  return vales.map((v) => ({
    nombre: etiquetaNombre(v),
    categoria: etiquetaCategoria(v),
    monto: Number(v.monto) || 0,
    fecha: v.fecha instanceof Date && !isNaN(v.fecha) ? v.fecha : null,
    registradoPor: texto(v.registradoPor),
    folio: texto(v.folio),
    estado: v.anulado ? "ANULADO" : "ACTIVO",
    notas: texto(v.notas),
  }));
}

// ---------------------------------------------------------------------------
//  Métricas  (Slice 3)  —  función PURA: sin DOM, sin ExcelJS, sin canvas
// ---------------------------------------------------------------------------

// Etiqueta corta de un mes "YYYY-MM" -> "Ago 2026".
export function etiquetaMes(clave) {
  const [anio, mes] = clave.split("-").map(Number);
  return MESES_CORTOS[mes - 1] + " " + anio;
}

// Los N meses que terminan en `endKey` ("YYYY-MM"), del más viejo al más nuevo.
function ultimosNMeses(endKey, n) {
  const [y, m] = endKey.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    out.push({ key, label: etiquetaMes(key) });
  }
  return out;
}

const porcentaje = (parte, todo) => (todo ? parte / todo : 0);

/* Agregados del Dashboard histórico. Deliberadamente CORTO: el Dashboard es
   un resumen rápido, no una plataforma de BI. El detalle por categoría y por
   persona vive ahora en cada hoja de mes.

   Reglas (decisiones de producto cerradas):
     · el dinero y los conteos operativos son SÓLO de vales activos;
     · los anulados se reportan aparte (conteo y tasa), nunca netean;
     · TODO sale del mismo conjunto de vales que se exporta: si un mes no tuvo
       actividad vale 0 y se dibuja en 0, jamás se le inventa un importe;
     · los vales SIN FECHA no desaparecen: cuentan en los totales y en el
       Detalle, y se reportan en su propio bucket `sinFecha`, porque las hojas
       por mes (comportamiento previo) sí los omiten;
     · los montos son pesos enteros; los porcentajes se calculan sin redondear. */
export function computeExcelMetrics(vales, hoy = new Date()) {
  const lista = Array.isArray(vales) ? vales : [];
  const vivos = activos(lista);
  const registrados = lista.length;
  const anulados = registrados - vivos.length;
  const importeTotal = vivos.reduce((a, v) => a + (Number(v.monto) || 0), 0);

  const porMes = new Map(); // "YYYY-MM" -> { count, importe }
  const sinFecha = { count: 0, importe: 0 };
  for (const v of vivos) {
    const monto = Number(v.monto) || 0;
    const clave = monthKey(v.fecha);
    if (!clave) { sinFecha.count += 1; sinFecha.importe += monto; continue; }
    const agg = porMes.get(clave) || { count: 0, importe: 0 };
    agg.count += 1;
    agg.importe += monto;
    porMes.set(clave, agg);
  }
  const de = (clave) => porMes.get(clave) || { count: 0, importe: 0 };

  // Mes en curso vs anterior según el CALENDARIO, no «el último mes con
  // datos»: el reporte es histórico completo y debe decir la verdad. Si el mes
  // acaba de empezar y no hay vales, el importe es 0 —no se rellena con nada.
  const ventana = ultimosNMeses(monthKey(hoy), 12);
  const actualKey = ventana[ventana.length - 1].key;
  const anteriorKey = ventana[ventana.length - 2].key;
  const mesActual = de(actualKey).importe;
  const mesAnterior = de(anteriorKey).importe;

  return {
    registrados,
    activos: vivos.length,
    importeTotal,
    anulados,
    tasaAnulacion: registrados ? anulados / registrados : 0,

    mes: {
      actualKey,
      actualLabel: etiquetaMes(actualKey),
      actualImporte: mesActual,
      actualCount: de(actualKey).count,
      anteriorKey,
      anteriorLabel: etiquetaMes(anteriorKey),
      anteriorImporte: mesAnterior,
      delta: mesActual - mesAnterior,
      // Sin base previa el porcentaje no significa nada: se reporta null y la
      // tarjeta escribe "sin base previa" en vez de un 100 % engañoso.
      deltaPct: mesAnterior ? (mesActual - mesAnterior) / mesAnterior : null,
    },

    sinFecha,

    // Serie continua de 12 meses: los meses sin actividad valen 0 y así se
    // dibujan. La continuidad del eje nunca justifica un valor inventado.
    serieMeses: ventana.map((m) => ({
      key: m.key,
      label: m.label,
      importe: de(m.key).importe,
      count: de(m.key).count,
    })),

    // Tabla fuente de la única gráfica del Dashboard: sólo los meses que
    // existen de verdad, del más reciente al más antiguo.
    resumenMeses: [...porMes.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, a]) => ({ key, label: etiquetaMes(key), count: a.count, importe: a.importe }))
      .concat(
        sinFecha.count
          ? [{ key: null, label: SIN_FECHA, count: sinFecha.count, importe: sinFecha.importe }]
          : []
      ),
  };
}

/* Métricas de UNA hoja de mes. Recibe los vales de ese mes (ya filtrados por
   valesPorMes(), que sólo entrega activos) y no mira nada más: un mes no puede
   contaminarse con datos de otro.

   Desempates, deterministas y documentados:
     · top persona y categoría principal: mayor importe; si empatan, mayor
       número de vales; si vuelven a empatar, orden alfabético (es).
   Sin promedios por vale: las denominaciones son un conjunto fijo y la media
   no significa nada. */
export function metricasDelMes(valesDelMes) {
  const lista = valesDelMes || [];
  const importe = lista.reduce((a, v) => a + (Number(v.monto) || 0), 0);

  const porCategoria = new Map();
  const porPersona = new Map();
  for (const v of lista) {
    const monto = Number(v.monto) || 0;
    for (const [map, clave] of [[porCategoria, etiquetaCategoria(v)], [porPersona, etiquetaNombre(v)]]) {
      const agg = map.get(clave) || { count: 0, importe: 0 };
      agg.count += 1;
      agg.importe += monto;
      map.set(clave, agg);
    }
  }

  const ordenar = (map, campo) =>
    [...map.entries()]
      .map(([k, a]) => ({ [campo]: k, count: a.count, importe: a.importe, pct: importe ? a.importe / importe : 0 }))
      .sort((a, b) => b.importe - a.importe || b.count - a.count ||
                      String(a[campo]).localeCompare(String(b[campo]), "es"));

  const categorias = ordenar(porCategoria, "categoria");
  const personas = ordenar(porPersona, "nombre");

  return {
    count: lista.length,
    importe,
    categorias,
    topPersona: personas[0] || null,
    categoriaPrincipal: categorias[0] || null,
  };
}

// ---------------------------------------------------------------------------
//  Piezas comunes de maquetación (Dashboard y hojas de mes)
// ---------------------------------------------------------------------------
const XLS_PCT = "0.0%";
const XLS_TXT = "FF1F2430";
const XLS_TXT_SUAVE = "FF6B7280";
const XLS_APOYO_BG = "FFEDEFF2"; // cabecera discreta de las tablas de apoyo
const ALTO_FILA = 20;            // px aprox. de una fila estándar, para reservar sitio
const MESES_LARGOS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
                      "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

const lineaGris = () => ({ style: "thin", color: { argb: XLS_BORDE } });
const rellenoSolido = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const dosDigitos = (n) => String(n).padStart(2, "0");
const fechaCorta = (d) => `${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
const horaCorta = (d) => `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;

/* Sello de frescura, con hora. Va en el Dashboard y en CADA hoja de mes.
   Un libro es una FOTO: el mes en curso sigue creciendo después de
   descargarlo, así que una hoja sin fecha de corte se compara tarde o
   temprano contra un Dashboard más nuevo y parece que las cifras no cuadran.
   Con la hora, además, se distinguen dos descargas del mismo día.
   Sólo es una etiqueta: no entra en ningún cálculo. */
export const selloDatosAl = (d) => `Datos al ${fechaCorta(d)} ${horaCorta(d)}`;

/* Banda de ancho completo (título, subtítulo, nota). El estilo se aplica a
   TODAS las celdas del rango y la fusión se hace al final: ExcelJS redirige el
   estilo de las celdas esclavas a la maestra, así que fusionar primero dejaría
   el borde o el relleno a medias. */
function banda(ws, r, c1, c2, valor, estilo, alto) {
  for (let c = c1; c <= c2; c++) Object.assign(ws.getRow(r).getCell(c), estilo);
  ws.getRow(r).getCell(c1).value = valor;
  ws.mergeCells(r, c1, r, c2);
  if (alto) ws.getRow(r).height = alto;
  return r + 1;
}

/* Tarjeta KPI: tres filas (etiqueta / valor / nota) sobre el rango de columnas
   indicado, con una barra roja de acento a la izquierda. */
function tarjetaKpi(ws, fila, col, colFin, kpi) {
  for (let r = fila; r <= fila + 2; r++) {
    for (let c = col; c <= colFin; c++) {
      const cel = ws.getRow(r).getCell(c);
      cel.fill = rellenoSolido(XLS_GRIS);
      cel.border = {
        top: r === fila ? lineaGris() : undefined,
        bottom: r === fila + 2 ? lineaGris() : undefined,
        left: c === col ? { style: "medium", color: { argb: XLS_ROJO } } : undefined,
        right: c === colFin ? lineaGris() : undefined,
      };
    }
  }
  const escribe = (r, valor, font, alto, numFmt) => {
    const cel = ws.getRow(r).getCell(col);
    cel.value = valor;
    cel.font = font;
    cel.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    if (numFmt) cel.numFmt = numFmt;
    ws.mergeCells(r, col, r, colFin);
    ws.getRow(r).height = alto;
  };
  escribe(fila, kpi.etiqueta, { bold: true, size: 9, color: { argb: XLS_TXT_SUAVE } }, 16);
  // Los nombres propios se escriben más chicos que las cifras: no caben a 18.
  escribe(fila + 1, kpi.valor,
    { bold: true, size: kpi.tam || 18, color: { argb: XLS_TXT } }, 28, kpi.numFmt);
  escribe(fila + 2, kpi.nota, { size: 9, color: { argb: XLS_TXT_SUAVE } }, 16);
  return fila + 3;
}

// Título de sección: negrita sobre una regla roja fina.
function tituloSeccion(ws, r, c1, c2, titulo) {
  return banda(ws, r, c1, c2, titulo, {
    font: { bold: true, size: 12, color: { argb: XLS_TXT } },
    alignment: { horizontal: "left", vertical: "middle" },
    border: { bottom: { style: "thin", color: { argb: XLS_ROJO_BORDE } } },
  }, 22);
}

/* Tabla de apoyo: la MISMA fuente de datos que dibuja la gráfica de al lado,
   para que nadie tenga que fiarse de la imagen. Cabecera gris y filas bajas,
   a propósito: en las hojas de mes no debe competir con la tabla de personas,
   que sigue siendo la protagonista con su cabecera roja. */
function tablaApoyo(ws, r, c1, cols, filas) {
  cols.forEach((col, i) => {
    const cel = ws.getRow(r).getCell(c1 + i);
    cel.value = col.titulo;
    cel.font = { bold: true, size: 9, color: { argb: XLS_TXT } };
    cel.fill = rellenoSolido(XLS_APOYO_BG);
    cel.alignment = { horizontal: col.align, vertical: "middle" };
    cel.border = bordeGris();
  });
  ws.getRow(r).height = 17;

  filas.forEach((f, i) => {
    const rr = r + 1 + i;
    cols.forEach((col, k) => {
      const cel = ws.getRow(rr).getCell(c1 + k);
      cel.value = f[col.campo];
      cel.font = { size: 10 };
      cel.alignment = { horizontal: col.align, vertical: "middle" };
      cel.border = bordeGris();
      if (col.moneda) cel.numFmt = XLS_MONEDA;
      if (col.pct) cel.numFmt = XLS_PCT;
    });
    ws.getRow(rr).height = 16;
  });
  return r + 1 + filas.length;
}

/* Ancla una imagen y le reserva su propio bloque de filas, para que no tape
   nada de lo que viene debajo. */
function incrustarGrafica(ws, r, col, imageId, tam) {
  const reservadas = Math.ceil(tam.height / ALTO_FILA) + 1;
  ws.addImage(imageId, {
    tl: { col: col - 1 + 0.15, row: r - 1 + 0.15 },
    ext: { width: tam.width, height: tam.height },
    editAs: "oneCell",
  });
  for (let k = 0; k < reservadas; k++) ws.getRow(r + k).height = ALTO_FILA * 0.75;
  return r + reservadas;
}

// Vacío honesto: cuando no hay importe NO se dibuja una gráfica de ceros.
function bandaVacia(ws, r, c1, c2, texto) {
  return banda(ws, r, c1, c2, texto, {
    font: { italic: true, size: 10, color: { argb: XLS_TXT_SUAVE } },
    alignment: { horizontal: "left", vertical: "middle", indent: 1 },
    fill: rellenoSolido(XLS_GRIS),
    border: bordeGris(),
  }, 22);
}

// ---------------------------------------------------------------------------
//  Hoja "Dashboard"  —  resumen rápido, no una plataforma de BI
// ---------------------------------------------------------------------------
const DASH_C1 = 2; // columna B
const DASH_C2 = 5; // columna E

const COLS_RESUMEN_MES = [
  { titulo: "Mes", campo: "label", align: "left" },
  { titulo: "Vales", campo: "count", align: "center" },
  { titulo: "Importe", campo: "importe", align: "right", moneda: true },
];

/* `graficaMeses` es el id de imagen ya registrado en el libro, o null.
   `etiquetaQA` sólo lo pone el generador de muestras: en producción es null y
   la hoja no lleva ninguna marca. */
export function hojaDashboard(wb, metrics, opts = {}) {
  const { generado = new Date(), graficaMeses = null, etiquetaQA = null } = opts;
  const ws = wb.addWorksheet("Dashboard");
  ws.views = [{ state: "frozen", ySplit: 3, showGridLines: false }];
  ws.getColumn(1).width = 2.2;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 2.2;

  const m = metrics;
  const pctTxt = (x) => (x * 100).toFixed(1).replace(".", ",") + " %";

  // --- Encabezado ---
  ws.getRow(1).height = 8;
  banda(ws, 2, DASH_C1, DASH_C2, "SPECTRO / MOBIL — DASHBOARD DE VALES", {
    font: { bold: true, size: 16, color: { argb: XLS_BLANCO } },
    fill: rellenoSolido(XLS_ROJO),
    alignment: { horizontal: "left", vertical: "middle", indent: 1 },
  }, 32);
  banda(ws, 3, DASH_C1, DASH_C2, `Histórico completo · ${selloDatosAl(generado)}`, {
    font: { italic: true, size: 10, color: { argb: XLS_TXT_SUAVE } },
    alignment: { horizontal: "left", vertical: "middle", indent: 1 },
    border: { bottom: lineaGris() },
  }, 18);

  let r = 4;
  if (etiquetaQA) {
    // Visible pero discreta, y sólo en libros de muestra.
    r = banda(ws, r, DASH_C1, DASH_C2, etiquetaQA, {
      font: { bold: true, size: 9, color: { argb: "FF8A6D00" } },
      fill: rellenoSolido("FFFFF4CE"),
      alignment: { horizontal: "center", vertical: "middle" },
      border: bordeGris(),
    }, 17);
  }
  ws.getRow(r).height = 8;
  r += 1;

  // --- Cuatro KPI, dos por renglón ---
  const deltaNota = m.mes.deltaPct === null
    ? `sin base previa (${m.mes.anteriorLabel}: ${money(m.mes.anteriorImporte)})`
    : `${m.mes.deltaPct > 0 ? "▲" : m.mes.deltaPct < 0 ? "▼" : "="} ${pctTxt(Math.abs(m.mes.deltaPct))} vs ${m.mes.anteriorLabel}`;

  const kpis = [
    { etiqueta: "VALES ACTIVOS", valor: m.activos, nota: `de ${m.registrados} registrados` },
    { etiqueta: "IMPORTE TOTAL", valor: m.importeTotal, numFmt: XLS_MONEDA, nota: "sólo vales activos" },
    { etiqueta: "VALES ANULADOS", valor: m.anulados, nota: `tasa de anulación ${pctTxt(m.tasaAnulacion)}` },
    { etiqueta: `IMPORTE DE ${m.mes.actualLabel.toUpperCase()}`, valor: m.mes.actualImporte, numFmt: XLS_MONEDA, nota: deltaNota },
  ];
  for (let i = 0; i < kpis.length; i += 2) {
    tarjetaKpi(ws, r, DASH_C1, DASH_C1 + 1, kpis[i]);
    if (kpis[i + 1]) tarjetaKpi(ws, r, DASH_C1 + 2, DASH_C2, kpis[i + 1]);
    r += 3;
    ws.getRow(r).height = 6;
    r += 1;
  }

  // --- Única gráfica: importe por mes ---
  r = tituloSeccion(ws, r, DASH_C1, DASH_C2, "Importe por mes — últimos 12 meses");
  ws.getRow(r).height = 4;
  r += 1;
  if (graficaMeses != null) {
    r = incrustarGrafica(ws, r, DASH_C1, graficaMeses, TAM.meses);
    ws.getRow(r).height = 6;
    r += 1;
  } else {
    r = bandaVacia(ws, r, DASH_C1, DASH_C2, "Sin importe activo en los últimos 12 meses.");
    r += 1;
  }
  r = tablaApoyo(ws, r, DASH_C1, COLS_RESUMEN_MES, m.resumenMeses);
  ws.getRow(r).height = 10;
  r += 1;

  // --- Notas al pie ---
  const notas = ["Los vales anulados no suman al importe ni a los conteos; se reportan aparte."];
  if (m.sinFecha.count) {
    notas.push(
      `${m.sinFecha.count} vale(s) sin fecha (${money(m.sinFecha.importe)}) cuentan en los totales y aparecen en «Detalle», ` +
      "pero no pueden asignarse a un mes: quedan fuera de la serie mensual y de las hojas por mes."
    );
  }
  if (graficaMeses != null) {
    notas.push("La gráfica es una instantánea del momento de la exportación: no se recalcula al editar celdas.");
  }
  for (const nota of notas) {
    r = banda(ws, r, DASH_C1, DASH_C2, nota, {
      font: { size: 9, color: { argb: XLS_TXT_SUAVE } },
      alignment: { horizontal: "left", vertical: "middle", wrapText: true },
    }, 16);
  }
  return ws;
}

// ---------------------------------------------------------------------------
//  Hojas de mes  —  un informe corto por mes, con la tabla de siempre debajo
// ---------------------------------------------------------------------------
const MES_C1 = 1; // columna A (la tabla de personas empieza en A, como siempre)
const MES_C2 = 4; // columna D

const COLS_CATEGORIA_MES = [
  { titulo: "Categoría", campo: "categoria", align: "left" },
  { titulo: "Vales", campo: "count", align: "center" },
  { titulo: "Importe", campo: "importe", align: "right", moneda: true },
  { titulo: "%", campo: "pct", align: "center", pct: true },
];

// "2026-08" -> "AGOSTO 2026"
function tituloMes(clave) {
  const [anio, mes] = clave.split("-").map(Number);
  return MESES_LARGOS[mes - 1] + " " + anio;
}

/* Hoja de un mes: área de insights arriba y, debajo, la MISMA tabla por
   persona de siempre (nombre, categoría, vales, total y fila TOTAL), con sus
   tintes por categoría y sus anchos automáticos. */
function hojaMes(wb, clave, valesDelMes, resumen, imagenDonut, generado = new Date()) {
  // El NOMBRE de la pestaña no lleva sello: es corto y estable ("Sep 2026"),
  // y es lo que se usa para navegar el libro. La fecha de corte va dentro.
  const ws = wb.addWorksheet(nombreHojaMes(clave));
  ws.views = [{ showGridLines: false }];

  ws.getRow(1).height = 8;
  let r = banda(ws, 2, MES_C1, MES_C2, tituloMes(clave), {
    font: { bold: true, size: 14, color: { argb: XLS_BLANCO } },
    fill: rellenoSolido(XLS_ROJO),
    alignment: { horizontal: "left", vertical: "middle", indent: 1 },
  }, 28);
  // Mismo sello que el Dashboard, debajo del título: el mes en curso sigue
  // creciendo después de exportar y esta hoja es la foto de un instante.
  r = banda(ws, r, MES_C1, MES_C2, selloDatosAl(generado), {
    font: { italic: true, size: 10, color: { argb: XLS_TXT_SUAVE } },
    alignment: { horizontal: "left", vertical: "middle", indent: 1 },
    border: { bottom: lineaGris() },
  }, 18);
  ws.getRow(r).height = 6;
  r += 1;

  // --- Cuatro datos del mes, dos por renglón ---
  const top = resumen.topPersona;
  const principal = resumen.categoriaPrincipal;
  const kpis = [
    { etiqueta: "TOTAL VALES", valor: resumen.count, nota: "vales activos del mes" },
    { etiqueta: "IMPORTE DEL MES", valor: resumen.importe, numFmt: XLS_MONEDA, nota: "sólo vales activos" },
    top
      ? { etiqueta: "TOP PERSONA", valor: top.nombre, tam: 13, nota: `${money(top.importe)} · ${top.count} vales` }
      : { etiqueta: "TOP PERSONA", valor: "—", tam: 13, nota: "sin datos" },
    principal
      ? { etiqueta: "CATEGORÍA PRINCIPAL", valor: principal.categoria, tam: 13,
          nota: `${(principal.pct * 100).toFixed(1)}% del importe del mes` }
      : { etiqueta: "CATEGORÍA PRINCIPAL", valor: "—", tam: 13, nota: "sin datos" },
  ];
  for (let i = 0; i < kpis.length; i += 2) {
    tarjetaKpi(ws, r, MES_C1, MES_C1 + 1, kpis[i]);
    tarjetaKpi(ws, r, MES_C1 + 2, MES_C2, kpis[i + 1]);
    r += 3;
    ws.getRow(r).height = 6;
    r += 1;
  }

  // --- Dona + su tabla fuente ---
  r = tituloSeccion(ws, r, MES_C1, MES_C2, "Distribución del importe por categoría");
  ws.getRow(r).height = 4;
  r += 1;
  if (imagenDonut != null) {
    r = incrustarGrafica(ws, r, MES_C1, imagenDonut, TAM.donutMes);
  } else {
    r = bandaVacia(ws, r, MES_C1, MES_C2, "Este mes no tiene importe activo: no se dibuja distribución.");
  }
  ws.getRow(r).height = 4;
  r += 1;
  r = tablaApoyo(ws, r, MES_C1, COLS_CATEGORIA_MES, resumen.categorias);
  ws.getRow(r).height = 12;
  r += 1;

  /* --- Tabla por persona: exactamente la de antes, sólo que más abajo ---
     Se escribe por posición (y no con addRow) porque la fila de cabecera tiene
     que caer en un renglón conocido: agregarFilaTotal() y formatearHoja()
     necesitan saber dónde empieza la tabla. */
  const filaCabecera = r;
  COLS_MES.forEach((col, i) => {
    ws.getRow(filaCabecera).getCell(i + 1).value = col.titulo;
  });
  let rr = filaCabecera;
  for (const f of filasDelMes(valesDelMes)) {
    rr += 1;
    const fila = ws.getRow(rr);
    [f.nombre, f.categoria, f.count, f.total].forEach((v, i) => {
      fila.getCell(i + 1).value = v;
    });
  }
  agregarFilaTotal(ws, COLS_MES, filaCabecera);
  formatearHoja(ws, COLS_MES, filaCabecera);
  return ws;
}

/* Hoja "Detalle": el dato crudo del que sale todo lo demás. Sin fila TOTAL a
   propósito —lleva autofiltro, y un total fijo debajo de un filtro miente en
   cuanto alguien filtra—. El Dashboard es quien publica los totales. */
const XLS_ANULADO_BG = "FFF7F7F7";
const XLS_ANULADO_TXT = "FF8C8C8C";
const XLS_FECHA = "dd/mm/yyyy";

function hojaDetalle(wb, vales) {
  const ws = wb.addWorksheet("Detalle");
  const filas = filasDetalle(vales);

  ws.addRow(COLS_DETALLE.map((c) => c.titulo));
  for (const f of filas) {
    ws.addRow([
      f.nombre,
      f.categoria,
      f.monto,
      f.fecha || SIN_FECHA,
      f.registradoPor,
      f.folio,
      f.estado,
      f.notas,
    ]);
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  const ultima = ws.rowCount;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultima, column: COLS_DETALLE.length } };

  for (let r = 1; r <= ultima; r++) {
    const fila = ws.getRow(r);
    const esCabecera = r === 1;
    const dato = esCabecera ? null : filas[r - 2];
    const anulado = dato && dato.estado === "ANULADO";

    for (let c = 1; c <= COLS_DETALLE.length; c++) {
      const col = COLS_DETALLE[c - 1];
      const celda = fila.getCell(c);
      celda.border = bordeGris(
        esCabecera ? { bottom: { style: "thin", color: { argb: XLS_ROJO_BORDE } } } : null
      );
      celda.alignment = { horizontal: col.align, vertical: "middle", wrapText: false };

      if (esCabecera) {
        celda.font = { bold: true, color: { argb: XLS_BLANCO }, size: 11 };
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XLS_ROJO } };
        continue;
      }

      // Anulado: gris tenue en toda la fila. Activo: el mismo tinte por
      // categoría que usan las hojas por mes.
      const fondo = anulado
        ? XLS_ANULADO_BG
        : XLS_CATEGORIA[dato.categoria] || null;
      if (fondo) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fondo } };
      if (anulado) celda.font = { color: { argb: XLS_ANULADO_TXT }, italic: true };

      if (col.moneda) celda.numFmt = XLS_MONEDA;
      if (col.fecha && celda.value instanceof Date) celda.numFmt = XLS_FECHA;
    }
    fila.height = esCabecera ? 24 : 18;
  }

  // Anchos: por contenido, con tope propio para Notas.
  for (let c = 1; c <= COLS_DETALLE.length; c++) {
    const col = COLS_DETALLE[c - 1];
    let ancho = 10;
    for (let r = 1; r <= ultima; r++) {
      const v = ws.getRow(r).getCell(c).value;
      const t = v == null ? ""
        : v instanceof Date ? "00/00/0000"
        : typeof v === "number" && col.moneda ? money(v)
        : String(v);
      ancho = Math.max(ancho, t.length + 3);
    }
    ws.getColumn(c).width = Math.min(ancho, col.ancho || 30);
  }
  return ws;
}

/* Registra un PNG en el libro y devuelve su id para anclarlo, o null si no
   hay imagen (mes sin importe, o libro construido sin renderizador).
   ExcelJS espera el base64 sin el prefijo "data:image/png;base64,". */
function registrarImagen(wb, dataUrl) {
  if (!dataUrl) return null;
  const base64 = dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
  return wb.addImage({ base64, extension: "png" });
}

/* Arma el libro completo con una instancia de ExcelJS ya cargada. Se mantiene
   separada de generarLibroExcel() para poder construir libros sin pasar por el
   <script> del CDN (pruebas y muestras de QA).

   Orden de hojas: Dashboard · Histórico · un mes por hoja · Detalle.

   `render` es opcional: ({ metrics, meses }) -> { meses, porMes }. Sin él el
   libro se arma igual, sólo que sin gráficas.
   `etiquetaQA` sólo lo usa el generador de muestras; en producción va en null
   y el libro no lleva ninguna marca. */
export function construirLibro(ExcelJS, vales, opts = {}) {
  const { generado = new Date(), render = null, etiquetaQA = null } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Spectro Networks — Vales";
  wb.created = generado;

  const metrics = computeExcelMetrics(vales, generado);
  // valesPorMes() sólo entrega meses que EXISTEN en los datos y sólo con vales
  // activos: no se crea ninguna hoja de un mes que no ocurrió.
  const meses = valesPorMes(vales);
  const resumenes = meses.map(([clave, delMes]) => [clave, metricasDelMes(delMes)]);
  const pngs = render ? render({ metrics, meses: resumenes }) : {};

  // --- Hoja: Dashboard (primera, la que abre Excel) ---
  hojaDashboard(wb, metrics, {
    generado,
    graficaMeses: registrarImagen(wb, pngs.meses),
    etiquetaQA,
  });

  // --- Hoja: Histórico (igual que siempre) ---
  const hoja = wb.addWorksheet("Histórico");
  hoja.addRow(COLS_HISTORICO.map((c) => c.titulo));
  for (const f of filasHistorico(vales)) hoja.addRow([f.nombre, f.count, f.total]);
  agregarFilaTotal(hoja, COLS_HISTORICO);
  formatearHoja(hoja, COLS_HISTORICO);

  // --- Una hoja por mes con vales, la más reciente primero ---
  const donas = pngs.porMes || {};
  resumenes.forEach(([clave, resumen], i) => {
    hojaMes(wb, clave, meses[i][1], resumen, registrarImagen(wb, donas[clave]), generado);
  });

  // --- Hoja: Detalle (última), con activos y anulados ---
  hojaDetalle(wb, vales);

  return wb;
}

/* Descarga ExcelJS si hace falta, arma el libro y devuelve el Blob listo para
   guardar. El botón, el nombre de archivo y el toast los maneja app.js. */
export async function generarLibroExcel(vales, opts = {}) {
  const ExcelJS = await cargarExcelJs();
  const wb = construirLibro(ExcelJS, vales, { render: renderGraficas, ...opts });
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
