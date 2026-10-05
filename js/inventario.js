// ============================================================================
//  Inventario de vales físicos de Combusa
// ============================================================================
//
//  Cada documento de la colección `inventario` representa UN vale de papel del
//  PDF que entrega la gasolinera. El ID del documento ES el folio, así que
//  Firestore impide por construcción tener dos veces el mismo folio.
//
//  Ciclo de vida del status:
//    revision_requerida → disponible (tras aprobación manual)
//    disponible → asignado (al registrar un vale) → canjeado
//    vencido: la fecha de vencimiento ya pasó (se calcula, no se escribe)
//
// ============================================================================
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  INVENTARIO_COLLECTION,
  INVENTARIO_MONTOS,
  INVENTARIO_STATUS,
} from "./config.js";
import { escapeHtml, money, todayInput, withRetry } from "./utils.js";
import { extractVouchersFromPdf } from "./pdf-vales.js";

// Vales por lote de escritura. 50 documentos ≈ 250KB por petición: muy por
// debajo del tope de Firestore (500 operaciones) y cómodo en móvil.
const CHUNK_SIZE = 50;

const STATUS_LABELS = {
  disponible: "Disponible",
  revision_requerida: "⚠️ Requiere revisión",
  asignado: "Asignado",
  canjeado: "Canjeado",
  vencido: "Vencido",
};
const FILTER_STATUS_LABELS = {
  ...STATUS_LABELS,
  revision_requerida: "⚠️ Requieren revisión",
};

let db = null;
let inventarioRef = null;
let deps = {};

// Existencias por denominación: monto -> nº de folios con status "disponible".
// Es un COUNT del servidor (~150 bytes por denominación), NO la lista de
// folios: entrar a la app ya no descarga ningún `qrImageBase64`. Antes se
// traía el pool entero (110 documentos ≈ 660KB de base64) sólo para contar
// existencias y elegir el siguiente folio, y eso es lo que ahogaba la conexión
// en datos móviles. Los folios concretos se piden uno a uno al asignar, con
// limit(), en reservarFolios().
let stock = new Map();
let inventarioTotal = 0;
let stockPromise = null;

// ¿Existe ALGÚN vale en el inventario? Distingue "nunca se ha importado nada"
// (la app sigue funcionando como antes) de "se agotó esta denominación".
let inventarioUsado = false;

// Último error al leer el inventario (p. ej. reglas sin desplegar, red caída).
// OJO: mientras valga algo, el registro de las denominaciones de
// INVENTARIO_MONTOS queda BLOQUEADO (ver inventarioIlegible()). Antes se
// seguía adelante con el QR de prueba generado por la app, lo que emitía vales
// de $200/$300/$500/$1000 sin folio real de Combusa.
let poolError = null;

// Lista completa (incluye asignados/canjeados) para la tabla de Admin. Se carga
// sólo al abrir la sección, porque arrastra el base64 de todos los QR.
let todos = [];
let todosCargados = false;
let loteSeleccionado = null;

// --- Referencias al DOM (la sección vive en la pestaña de Admin) ------------
const $ = (sel) => document.querySelector(sel);
let el = {};

export function initInventario(options) {
  db = options.db;
  deps = options;
  inventarioRef = collection(db, INVENTARIO_COLLECTION);

  el = {
    importBtn: $("#btn-importar-pdf"),
    fileInput: $("#pdf-input"),
    refreshBtn: $("#btn-inv-actualizar"),
    progress: $("#inv-progress"),
    resumen: $("#inv-resumen"),
    stock: $("#inv-stock"),
    total: $("#inv-total"),
    ultima: $("#inv-ultima"),
    filtroLote: $("#inv-filtro-lote"),
    alcance: $("#inv-alcance"),
    filtroStatus: $("#inv-filtro-status"),
    filtroMonto: $("#inv-filtro-monto"),
    body: $("#inv-body"),
    empty: $("#inv-empty"),
    error: $("#inv-error"),
    count: $("#inv-count"),
  };

  // Filtros de la tabla.
  fillOptions(el.filtroStatus, [["", "Todos los estados"]].concat(
    INVENTARIO_STATUS.map((s) => [s, FILTER_STATUS_LABELS[s] || capitalize(s)])
  ));
  fillOptions(el.filtroMonto, [["", "Todos los montos"]].concat(
    INVENTARIO_MONTOS.map((m) => [String(m), money(m)])
  ));
  el.filtroStatus.value = "disponible";
  el.filtroLote.addEventListener("change", () => {
    loteSeleccionado = el.filtroLote.value;
    renderInventario();
  });
  el.filtroStatus.addEventListener("change", renderTabla);
  el.filtroMonto.addEventListener("change", renderTabla);
  el.body.addEventListener("click", onTableClick);

  el.importBtn.addEventListener("click", onImportClick);
  el.fileInput.addEventListener("change", onFileChosen);
  el.refreshBtn.addEventListener("click", () => cargarTodos(true).then(renderInventario));

  // Carga en segundo plano del pool de asignación: no bloquea la interfaz.
  ensurePool().catch((err) => console.error("[inventario] pool:", err));
}

function fillOptions(select, pairs) {
  select.innerHTML = "";
  for (const [value, label] of pairs) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ===========================================================================
//  Carga de datos
// ===========================================================================
// Existencias (`COUNT` por denominación) + sonda de existencia.
//
// Son 5 consultas de agregación en paralelo, de ~150 bytes de respuesta cada
// una: no devuelven documentos, así que NO descargan ningún `qrImageBase64`.
// Esto es lo que sustituye a la descarga del pool completo al entrar a la app.
//
// IMPORTANTE: esta promesa NUNCA se rechaza, pero un fallo ya NO es inocuo:
// deja `poolError` puesto y eso BLOQUEA el registro de las denominaciones que
// salen del inventario (ver inventarioIlegible()). El registro con QR generado
// queda sólo para las denominaciones fuera de INVENTARIO_MONTOS.
export function ensurePool() {
  // Si el intento anterior falló, se vuelve a probar (puede haber sido un fallo
  // puntual, una red móvil intermitente o unas reglas recién desplegadas).
  if (!stockPromise || poolError) stockPromise = cargarStock();
  return stockPromise;
}

async function cargarStock() {
  try {
    // El COUNT total es la sonda de existencia: hay inventario aunque esté todo
    // asignado. No se puede deducir de los COUNT por denominación.
    const snaps = await withRetry(() =>
      Promise.all([
        getCountFromServer(inventarioRef),
        ...INVENTARIO_MONTOS.map((monto) =>
          getCountFromServer(
            query(
              inventarioRef,
              where("status", "==", "disponible"),
              where("monto", "==", Number(monto))
            )
          )
        ),
      ])
    );
    const [totalSnap, ...porMonto] = snaps;
    inventarioTotal = totalSnap.data().count;
    stock = new Map(
      INVENTARIO_MONTOS.map((monto, i) => [Number(monto), porMonto[i].data().count])
    );
    inventarioUsado = inventarioTotal > 0;
    poolError = null;
  } catch (err) {
    console.error("[inventario] no se pudo leer el inventario:", err);
    stock = new Map();
    inventarioTotal = 0;
    inventarioUsado = false;
    poolError = err; // → el registro se BLOQUEA, no cae al QR de prueba
  }
  return stock;
}

// Error de lectura del inventario, si lo hubo (para avisar en Admin).
export function inventarioError() {
  return poolError;
}

/* ¿El inventario está ilegible ahora mismo?
   Es la señal de SEGURIDAD del registro: si vale true no se puede saber qué
   folios hay, así que registrar una denominación de INVENTARIO_MONTOS tiene
   que bloquearse en vez de inventarse un QR de prueba. */
export function inventarioIlegible() {
  return Boolean(poolError);
}

function refreshStock() {
  stockPromise = cargarStock();
  return stockPromise;
}

// Lista completa para la tabla de Admin.
async function cargarTodos(force = false) {
  if (todosCargados && !force) return todos;
  const snap = await getDocs(inventarioRef);
  todos = snap.docs.map((d) => ({ folio: d.id, ...d.data() }));
  todos.sort((a, b) => Number(a.folio) - Number(b.folio));
  todosCargados = true;
  return todos;
}

// ===========================================================================
//  Estado de un vale del inventario
// ===========================================================================
function esVencido(v) {
  return !!v.vencimiento && v.vencimiento < todayInput();
}

// Status que se MUESTRA: un vale disponible cuya fecha ya pasó es "vencido"
// aunque en la base siga como disponible.
function statusEfectivo(v) {
  if (v.status === "disponible" && esVencido(v)) return "vencido";
  return v.status || "disponible";
}

// ===========================================================================
//  API para la pestaña de Registro
// ===========================================================================
// ¿Esta denominación debe salir del inventario? Sólo si es una de las que
// entrega Combusa Y ya se importó algo. Así, mientras no se importe ningún PDF
// —o para denominaciones que Combusa no surte, como $4,000— el registro sigue
// funcionando exactamente como antes (QR generado por la app).
export function montoRequiereInventario(monto) {
  return inventarioUsado && INVENTARIO_MONTOS.includes(Number(monto));
}

export function inventarioEnUso() {
  return inventarioUsado;
}

/* Existencias de una denominación, según el último COUNT del servidor.
   Es un número, no una lista: contar ya no cuesta descargar folios.

   Es un TOPE SUPERIOR: el COUNT no puede excluir los folios vencidos (haría
   falta un filtro de rango y, con él, un índice compuesto). Quien decide de
   verdad es reservarFolios(), que sí descarta los vencidos. */
export function stockDisponible(monto) {
  return stock.get(Number(monto)) || 0;
}

// ---------------------------------------------------------------------------
//  Reserva de folios
// ---------------------------------------------------------------------------
// Folios extra que se piden por denominación además de los necesarios. Cubren
// dos cosas: recuperar el orden FIFO numérico dentro de la ventana (Firestore
// ordena de forma implícita por ID de documento, que es LEXICOGRÁFICO) y poder
// saltarse algún folio vencido sin volver a consultar. Cada folio extra cuesta
// ~6KB de base64, así que el margen se mantiene pequeño.
const MARGEN_FOLIOS = 4;
// Segunda ventana, sólo si la primera venía entera de folios vencidos.
const MARGEN_AMPLIO = 40;

/* Reserva los folios para una lista de montos leyendo de Firestore SÓLO los
   documentos que se van a usar (más el margen de arriba), en vez del pool
   completo. Como el documento que se descarga ya trae su `qrImageBase64`, la
   misma consulta sirve para asignar el folio y para pintar su QR después: no
   hace falta una segunda lectura.

   No escribe nada: quien llama añade los updates al mismo writeBatch que crea
   los vales. La carrera con otro dispositivo que se lleve el folio entre la
   reserva y el commit la corta firestore.rules, porque invIsAssignment() exige
   que el folio siga en 'disponible'; el lote entero falla y no se guarda nada.

   Devuelve { picks, faltantes, error }:
     picks     alineado con `items`; null si esa denominación no sale del
               inventario (o si faltó folio).
     faltantes { monto: cuántos faltaron }.
     error     el inventario no se pudo leer. Quien llama DEBE bloquear el
               registro: no es "no hay inventario", es "no se sabe". */
export async function reservarFolios(items) {
  await ensurePool();
  if (poolError) return { picks: [], faltantes: {}, error: poolError };

  // Cuántos se piden de cada denominación que sale del inventario.
  const pedidos = new Map();
  for (const monto of items) {
    if (!montoRequiereInventario(monto)) continue;
    pedidos.set(Number(monto), (pedidos.get(Number(monto)) || 0) + 1);
  }

  const colas = new Map();
  const faltantes = {};
  try {
    for (const [monto, cantidad] of pedidos) {
      const libres = await candidatos(monto, cantidad);
      if (libres.length < cantidad) faltantes[monto] = cantidad - libres.length;
      colas.set(monto, libres);
    }
  } catch (err) {
    // Igual que arriba: sin lectura fiable no se asigna nada a ciegas.
    console.error("[inventario] no se pudieron reservar folios:", err);
    return { picks: [], faltantes: {}, error: err };
  }

  const picks = items.map((monto) => {
    if (!montoRequiereInventario(monto)) return null;
    const cola = colas.get(Number(monto));
    return cola && cola.length ? cola.shift() : null;
  });
  return { picks, faltantes, error: null };
}

// Folios asignables de una denominación, en orden FIFO y ya sin vencidos.
async function candidatos(monto, cantidad) {
  let libres = await ventanaDisponibles(monto, cantidad + MARGEN_FOLIOS);
  // Si la ventana entera venía vencida todavía puede haber folios útiles más
  // adelante: se amplía UNA vez, y sólo si el COUNT dice que hay más.
  if (
    libres.length < cantidad &&
    stockDisponible(monto) > cantidad + MARGEN_FOLIOS
  ) {
    libres = await ventanaDisponibles(monto, cantidad + MARGEN_AMPLIO);
  }
  return libres.slice(0, cantidad);
}

/* Ventana de folios `disponible` de una denominación, como máximo `tope`.

   Dos filtros de igualdad y un limit(), sin orderBy: así Firestore la sirve
   con los índices de campo único que crea solo (verificado contra el proyecto)
   y no hace falta desplegar ningún índice compuesto.

   getDocsFromServer y NO getDocs: esto es deliberado y es una regla de
   seguridad, no una optimización. getDocs() se conforma con la caché local
   cuando no alcanza el servidor, y como los COUNT del arranque no guardan
   documentos, sin red devolvía un resultado VACÍO en vez de fallar. Un vacío
   se lee como "no quedan folios", que es una mentira peligrosa: tapa un
   problema de conexión con un "sin existencias". getDocsFromServer() falla de
   forma explícita y entonces el registro se bloquea con el mensaje correcto.
   Un vale de papel no se puede asignar a partir de una caché. */
async function ventanaDisponibles(monto, tope) {
  const snap = await withRetry(() =>
    getDocsFromServer(
      query(
        inventarioRef,
        where("status", "==", "disponible"),
        where("monto", "==", Number(monto)),
        limit(tope)
      )
    )
  );
  return snap.docs
    .map((d) => ({ folio: d.id, ...d.data() }))
    .filter((v) => !esVencido(v))
    .sort((a, b) => Number(a.folio) - Number(b.folio)) // FIFO por folio
    .map((v) => ({
      folio: v.folio,
      monto: Number(v.monto),
      vencimiento: v.vencimiento || null,
      qrImageBase64: v.qrImageBase64 || null,
    }));
}

// Referencia al documento de inventario de un folio (para el writeBatch).
export function inventarioDocRef(folio) {
  return doc(db, INVENTARIO_COLLECTION, String(folio));
}

// Campos que marcan un vale como asignado.
export function camposAsignacion(nombre, batchId) {
  return {
    status: "asignado",
    asignadoA: nombre,
    asignadoEn: serverTimestamp(),
    batchId: batchId || null,
  };
}

/* Tras guardar: descuenta las existencias en local y refresca en segundo
   plano. Recibe los `picks` que se acaban de asignar (no sólo los folios),
   porque ahora el stock se lleva por denominación y hace falta el monto. */
export function marcarAsignadosLocal(asignados) {
  for (const pick of asignados) {
    const monto = Number(pick.monto);
    stock.set(monto, Math.max(0, (stock.get(monto) || 0) - 1));
  }
  todosCargados = false;
  refreshStock().catch((err) => console.error("[inventario] refresh:", err));
}

// Campos que DEVUELVEN un vale al inventario (al anular el vale que lo usaba).
// Sólo toca las cuatro claves que las reglas permiten modificar; el folio, el
// monto, el vencimiento y la imagen del QR siguen intactos.
export function camposDevolucion() {
  return {
    status: "disponible",
    asignadoA: null,
    asignadoEn: null,
    batchId: null,
  };
}

// ¿Existe el documento de inventario de este folio? Los vales de pruebas
// antiguas traen folios que ya no están en la colección: en ese caso se anula
// el vale sin tocar el inventario.
export async function existeFolio(folio) {
  try {
    const snap = await getDoc(inventarioDocRef(folio));
    return snap.exists();
  } catch (err) {
    console.error("[inventario] no se pudo comprobar el folio", folio, err);
    return false;
  }
}

// Caché en memoria del QR de los folios que se han vuelto a consultar desde el
// historial. El base64 es inmutable (las reglas no dejan reescribirlo), así que
// basta con leerlo una vez por sesión.
const qrImagenCache = new Map();

// Imagen del QR (base64) de un folio YA EMITIDO, para volver a mostrar un vale
// desde el historial. Es SÓLO LECTURA: no toca el status ni ningún otro campo
// del inventario, y nunca reasigna ni devuelve el folio.
// Devuelve:
//   { ok: true, imagen }       imagen puede ser null si el documento no la trae
//   { ok: false, motivo: "no-existe" }  el folio ya no está en el inventario
//   { ok: false, motivo: "error" }      no se pudo leer (red/permisos). NO
//                                       significa que el vale no exista.
export async function qrImagenDeFolio(folio) {
  const key = String(folio);
  if (qrImagenCache.has(key)) return qrImagenCache.get(key);

  let resultado;
  try {
    const snap = await getDoc(inventarioDocRef(key));
    resultado = snap.exists()
      ? { ok: true, imagen: snap.data().qrImageBase64 || null }
      : { ok: false, motivo: "no-existe" };
  } catch (err) {
    console.error("[inventario] no se pudo leer el QR del folio", key, err);
    // Un fallo de lectura puede ser temporal: no se cachea, para que el
    // siguiente intento vuelva a preguntar.
    return { ok: false, motivo: "error" };
  }

  qrImagenCache.set(key, resultado);
  return resultado;
}

// Recarga el inventario tras devolver un folio (pool + tabla de la pestaña).
export async function refrescarInventario() {
  todosCargados = false;
  await refreshStock();
}

// ===========================================================================
//  Importación del PDF
// ===========================================================================
async function onImportClick() {
  const ok = await deps.requestAdminPin(
    "Importar el PDF de vales de Combusa al inventario."
  );
  if (!ok) return;
  el.fileInput.value = ""; // permite volver a elegir el mismo archivo
  el.fileInput.click();
}

async function onFileChosen(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await importarPdf(file);
  } catch (err) {
    console.error("[inventario] importación:", err);
    setProgress("");
    showError("No se pudo importar el PDF: " + (err && err.message ? err.message : err));
  } finally {
    el.importBtn.disabled = false;
    el.fileInput.value = "";
  }
}

async function importarPdf(file) {
  hideError();
  el.resumen.hidden = true;
  el.importBtn.disabled = true;
  setProgress("Cargando el lector de PDF…");

  // 1) Leer el PDF (folio, monto, vencimiento y QR de cada vale).
  const { vouchers, problemas } = await extractVouchersFromPdf(file, (p) => {
    setProgress(
      `Analizando PDF… página ${p.page}/${p.pages} · ${p.found} vales encontrados`
    );
  });

  if (vouchers.length === 0) {
    setProgress("");
    showError(
      "No se encontró ningún vale en el PDF. ¿Es el archivo de vales de Combusa? " +
        (problemas.length ? "Detalle: " + problemas[0] : "")
    );
    return;
  }

  // 2) Descartar folios que ya están en el inventario.
  setProgress("Comprobando folios ya importados…");
  await cargarTodos(true);
  const existentes = new Set(todos.map((v) => String(v.folio)));
  const duplicados = vouchers.filter((v) => existentes.has(String(v.folio)));
  let nuevos = vouchers.filter((v) => !existentes.has(String(v.folio)));

  // Denominaciones que las reglas de Firestore no aceptarían.
  const rechazados = nuevos.filter((v) => !INVENTARIO_MONTOS.includes(Number(v.monto)));
  nuevos = nuevos.filter((v) => INVENTARIO_MONTOS.includes(Number(v.monto)));

  if (nuevos.length === 0) {
    setProgress("");
    mostrarResumen(
      `ℹ️ No se importó ningún vale nuevo: los ${duplicados.length} folios del PDF ya estaban en el inventario.`
    );
    await cargarTodos(true);
    renderInventario();
    return;
  }

  // 3) Guardar por lotes, informando del avance.
  const importadoPor = (deps.getUsuario && deps.getUsuario()) || "Admin";
  let guardados = 0;
  for (let i = 0; i < nuevos.length; i += CHUNK_SIZE) {
    const lote = nuevos.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const v of lote) {
      const requiereRevision = Boolean(v.decodeError);
      const docData = {
        folio: String(v.folio),
        monto: Number(v.monto),
        status: requiereRevision ? "revision_requerida" : "disponible",
        vencimiento: v.vencimiento || null,
        qrImageBase64: v.qrImageBase64,
        asignadoA: null,
        asignadoEn: null,
        batchId: null,
        importadoEn: serverTimestamp(),
        importadoPor,
      };
      if (requiereRevision) {
        docData.decodeError = true;
        docData.decodedPayload =
          typeof v.decodedPayload === "string" ? v.decodedPayload : null;
      }
      batch.set(inventarioDocRef(v.folio), docData);
    }
    await batch.commit();
    guardados += lote.length;
    setProgress(`Importando… ${guardados}/${nuevos.length} vales`);
  }

  // 4) Resumen.
  setProgress("");
  const detalle = resumenPorMonto(nuevos);
  const validos = nuevos.filter((v) => !v.decodeError).length;
  const requierenRevision = nuevos.length - validos;
  const avisos = [];
  if (duplicados.length) {
    avisos.push(`${duplicados.length} folios ya existían y se omitieron`);
  }
  if (rechazados.length) {
    avisos.push(
      `${rechazados.length} con denominación no permitida (${[
        ...new Set(rechazados.map((v) => money(v.monto))),
      ].join(", ")})`
    );
  }
  if (problemas.length) avisos.push(`${problemas.length} vales ilegibles en el PDF`);

  mostrarResumen(
    `✅ ${guardados} vales importados: ${validos} válidos, ${requierenRevision} requieren revisión` +
      (detalle ? `\n${detalle}` : "") +
      (avisos.length ? `\n⚠️ ${avisos.join(" · ")}` : "")
  );
  if (problemas.length) console.warn("[inventario] vales ilegibles:", problemas);

  deps.showToast(
    `✅ ${guardados} importados · ${requierenRevision} requieren revisión`
  );

  await Promise.all([cargarTodos(true), refreshStock()]);
  loteSeleccionado = null;
  el.filtroStatus.value = "disponible";
  el.filtroMonto.value = "";
  renderInventario();
}

// "45×$200, 20×$300, 30×$500, 10×$1,000"
function resumenPorMonto(vales) {
  const counts = new Map();
  for (const v of vales) {
    const m = Number(v.monto);
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((m) => `${counts.get(m)}×${money(m)}`)
    .join(", ");
}

function setProgress(msg) {
  el.progress.textContent = msg;
  el.progress.hidden = !msg;
}
function mostrarResumen(msg) {
  el.resumen.textContent = msg;
  el.resumen.hidden = false;
}
function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = false;
}
function hideError() {
  el.error.hidden = true;
}

// ===========================================================================
//  Interfaz: tarjetas de stock + tabla
// ===========================================================================
export async function renderInventarioAdmin() {
  try {
    hideError();
    await cargarTodos();
    renderInventario();
  } catch (err) {
    console.error("[inventario] carga:", err);
    const code = err && err.code ? ` (${err.code})` : "";
    showError(
      "No se pudo cargar el inventario" + code + ": " +
        (err && err.message ? err.message : err) +
        (err && err.code === "permission-denied"
          ? " Despliega las reglas de Firestore (firebase deploy --only firestore:rules) " +
            "para habilitar la colección «inventario». Mientras tanto, el registro de " +
            "vales sigue funcionando con el QR generado por la app."
          : "")
    );
  }
}

// Las cargas antiguas no tienen un ID de lote: se agrupan por día de
// importación en Monterrey, independientemente del vencimiento del vale.
function claveLote(v) {
  const d = v.importadoEn && v.importadoEn.toDate ? v.importadoEn.toDate() : null;
  if (!d || !Number.isFinite(d.getTime())) return "sin-fecha";
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function etiquetaLote(clave) {
  if (clave === "sin-fecha") return "Importaciones sin fecha";
  return "Importación del " + new Date(clave + "T12:00:00-06:00").toLocaleDateString("es-MX", {
    timeZone: "America/Monterrey", day: "numeric", month: "long", year: "numeric",
  });
}

function valesDelLote() {
  return loteSeleccionado === "" ? todos : todos.filter((v) => claveLote(v) === loteSeleccionado);
}

function renderLotes() {
  const claves = [...new Set(todos.map(claveLote))].sort((a, b) => {
    if (a === "sin-fecha") return 1;
    if (b === "sin-fecha") return -1;
    return b.localeCompare(a);
  });
  if (loteSeleccionado === null || (loteSeleccionado !== "" && !claves.includes(loteSeleccionado))) {
    loteSeleccionado = claves[0] || "";
  }
  fillOptions(el.filtroLote, [["", "Todo el inventario"], ...claves.map((clave, i) => [
    clave, etiquetaLote(clave) + (i === 0 && clave !== "sin-fecha" ? " · Más reciente" : ""),
  ])]);
  el.filtroLote.value = loteSeleccionado;
  el.alcance.textContent = loteSeleccionado === ""
    ? "Mostrando todas las importaciones. El resumen cuenta los disponibles de todo el inventario."
    : etiquetaLote(loteSeleccionado) + ". El resumen cuenta los disponibles de esta carga. Los PDF importados el mismo día se agrupan juntos.";
}

function renderInventario() {
  renderLotes();
  renderStock();
  renderTabla();
}

function renderStock() {
  el.stock.innerHTML = "";
  let total = 0;

  for (const monto of INVENTARIO_MONTOS) {
    const libres = valesDelLote().filter(
      (v) => Number(v.monto) === monto && statusEfectivo(v) === "disponible"
    ).length;
    total += libres * monto;

    const card = document.createElement("div");
    card.className = "stat-card inv-card";
    card.innerHTML =
      `<span class="stat-label">${money(monto)}</span>` +
      `<strong>${libres}</strong>` +
      `<span class="inv-card-sub">disponibles</span>`;
    el.stock.appendChild(card);
  }

  el.total.textContent = money(total);

  // Última importación = importadoEn más reciente.
  let ultima = null;
  for (const v of valesDelLote()) {
    const d = v.importadoEn && v.importadoEn.toDate ? v.importadoEn.toDate() : null;
    if (d && (!ultima || d > ultima)) ultima = d;
  }
  el.ultima.textContent = ultima
    ? "Última importación: " +
      ultima.toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
}

function renderTabla() {
  const fStatus = el.filtroStatus.value;
  const fMonto = el.filtroMonto.value;

  const lote = valesDelLote();
  const filas = lote.filter((v) => {
    if (fStatus && statusEfectivo(v) !== fStatus) return false;
    if (fMonto && Number(v.monto) !== Number(fMonto)) return false;
    return true;
  });

  el.body.innerHTML = "";
  for (const v of filas) {
    const status = statusEfectivo(v);
    const tr = document.createElement("tr");
    tr.className = "inv-row inv-row--" + status;
    const asignadoEn =
      v.asignadoEn && v.asignadoEn.toDate
        ? v.asignadoEn.toDate().toLocaleDateString("es-MX", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "—";
    const payload =
      status === "revision_requerida"
        ? v.decodedPayload || "No se pudo decodificar"
        : "—";
    const accion =
      status === "revision_requerida"
        ? `<button type="button" class="btn-secondary inv-approve" data-approve-folio="${escapeHtml(
            String(v.folio)
          )}">Aprobar</button>`
        : "—";
    tr.innerHTML =
      `<td class="inv-folio">${escapeHtml(formatFolio(v.folio))}</td>` +
      `<td class="num">${money(v.monto)}</td>` +
      `<td><span class="badge badge--${status}">${escapeHtml(
        STATUS_LABELS[status] || capitalize(status)
      )}</span></td>` +
      `<td><code class="inv-decoded-payload">${escapeHtml(payload)}</code></td>` +
      `<td>${escapeHtml(v.asignadoA || "—")}</td>` +
      `<td>${asignadoEn}</td>` +
      `<td>${accion}</td>`;
    el.body.appendChild(tr);
  }

  el.empty.hidden = filas.length > 0;
  el.empty.textContent = todos.length
    ? "Ningún vale coincide con los filtros."
    : "Aún no hay vales importados. Usa «📥 Importar PDF».";
  el.count.textContent = `${filas.length} de ${lote.length} vales de ${loteSeleccionado === "" ? "todo el inventario" : "esta carga"}`;
}

async function onTableClick(event) {
  const button = event.target.closest("[data-approve-folio]");
  if (!button || !el.body.contains(button)) return;

  const folio = String(button.dataset.approveFolio || "");
  const voucher = todos.find((v) => String(v.folio) === folio);
  if (!voucher || statusEfectivo(voucher) !== "revision_requerida") return;

  const payload = voucher.decodedPayload || "sin payload decodificado";
  const ok = await deps.requestAdminPin(
    `Aprobar el folio ${formatFolio(folio)}. Payload QR: ${payload}`
  );
  if (!ok) return;

  button.disabled = true;
  hideError();
  try {
    // Los metadatos de decodificación se conservan como evidencia; aprobar
    // sólo habilita el vale para entrar al pool de asignación.
    await updateDoc(inventarioDocRef(folio), { status: "disponible" });
    todosCargados = false;
    await Promise.all([cargarTodos(true), refreshStock()]);
    renderInventario();
    deps.showToast(`✅ Folio ${formatFolio(folio)} aprobado`);
  } catch (err) {
    console.error("[inventario] aprobación:", err);
    button.disabled = false;
    showError(
      `No se pudo aprobar el folio ${formatFolio(folio)}: ` +
        (err && err.message ? err.message : err)
    );
  }
}

// "117765" → "117,765" (como lo imprime Combusa)
export function formatFolio(folio) {
  const n = Number(folio);
  return Number.isFinite(n) ? n.toLocaleString("es-MX") : String(folio);
}
