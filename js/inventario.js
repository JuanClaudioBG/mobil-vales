// ============================================================================
//  Inventario de vales físicos de Combusa
// ============================================================================
//
//  Cada documento de la colección `inventario` representa UN vale de papel del
//  PDF que entrega la gasolinera. El ID del documento ES el folio, así que
//  Firestore impide por construcción tener dos veces el mismo folio.
//
//  Ciclo de vida del status:
//    disponible → asignado (al registrar un vale) → canjeado
//    vencido: la fecha de vencimiento ya pasó (se calcula, no se escribe)
//
// ============================================================================
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  INVENTARIO_COLLECTION,
  INVENTARIO_MONTOS,
  INVENTARIO_STATUS,
} from "./config.js";
import { escapeHtml, money, todayInput } from "./utils.js";
import { extractVouchersFromPdf } from "./pdf-vales.js";

// Vales por lote de escritura. 50 documentos ≈ 250KB por petición: muy por
// debajo del tope de Firestore (500 operaciones) y cómodo en móvil.
const CHUNK_SIZE = 50;

let db = null;
let inventarioRef = null;
let deps = {};

// Pool de asignación: sólo los vales `disponible` (es lo único que necesita la
// pestaña de Registro). Se carga en segundo plano al entrar a la app.
let disponibles = [];
let poolPromise = null;

// ¿Existe ALGÚN vale en el inventario? Distingue "nunca se ha importado nada"
// (la app sigue funcionando como antes) de "se agotó esta denominación".
let inventarioUsado = false;

// Último error al leer el inventario (p. ej. reglas sin desplegar). Si el
// inventario no se puede leer, la app NO se bloquea: se comporta como antes de
// existir esta función (QR generado). Ver ensurePool().
let poolError = null;

// Lista completa (incluye asignados/canjeados) para la tabla de Admin. Se carga
// sólo al abrir la sección, porque arrastra el base64 de todos los QR.
let todos = [];
let todosCargados = false;

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
    filtroStatus: $("#inv-filtro-status"),
    filtroMonto: $("#inv-filtro-monto"),
    body: $("#inv-body"),
    empty: $("#inv-empty"),
    error: $("#inv-error"),
    count: $("#inv-count"),
  };

  // Filtros de la tabla.
  fillOptions(el.filtroStatus, [["", "Todos los estados"]].concat(
    INVENTARIO_STATUS.map((s) => [s, capitalize(s)])
  ));
  fillOptions(el.filtroMonto, [["", "Todos los montos"]].concat(
    INVENTARIO_MONTOS.map((m) => [String(m), money(m)])
  ));
  el.filtroStatus.addEventListener("change", renderTabla);
  el.filtroMonto.addEventListener("change", renderTabla);

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
// Pool de asignación (`status == "disponible"`) + sonda de existencia.
//
// IMPORTANTE: esta promesa NUNCA se rechaza. Si el inventario no se puede leer
// (reglas sin desplegar, sin red…), se deja el pool vacío y `inventarioUsado`
// en false: el registro de vales sigue funcionando igual que antes de existir
// el inventario, en lugar de quedarse bloqueado. El error se muestra en la
// sección de Admin, que es donde se puede hacer algo al respecto.
export function ensurePool() {
  // Si el intento anterior falló, se vuelve a probar (puede haber sido un fallo
  // puntual o unas reglas recién desplegadas).
  if (!poolPromise || poolError) poolPromise = cargarPool();
  return poolPromise;
}

async function cargarPool() {
  try {
    const [snapDisponibles, snapCualquiera] = await Promise.all([
      getDocs(query(inventarioRef, where("status", "==", "disponible"))),
      getDocs(query(inventarioRef, limit(1))),
    ]);
    disponibles = snapDisponibles.docs.map((d) => ({ folio: d.id, ...d.data() }));
    disponibles.sort((a, b) => Number(a.folio) - Number(b.folio)); // FIFO por folio
    inventarioUsado = !snapCualquiera.empty;
    poolError = null;
  } catch (err) {
    console.error("[inventario] no se pudo leer el inventario:", err);
    disponibles = [];
    inventarioUsado = false; // → el registro usa el QR generado, como antes
    poolError = err;
  }
  return disponibles;
}

// Error de lectura del inventario, si lo hubo (para avisar en Admin).
export function inventarioError() {
  return poolError;
}

function refreshPool() {
  poolPromise = cargarPool();
  return poolPromise;
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

// Vales disponibles y NO vencidos de una denominación.
export function disponiblesPorMonto(monto) {
  return disponibles.filter((v) => Number(v.monto) === Number(monto) && !esVencido(v));
}

// Reserva (en memoria) los folios para una lista de montos.
// Devuelve { picks, faltantes }: `picks` en el mismo orden que `items`, y
// `faltantes` = { monto: cuántos faltaron }. No escribe en Firestore: quien
// llama añade los updates al mismo writeBatch que crea los vales.
export function tomarFolios(items) {
  const usados = new Set();
  const picks = [];
  const faltantes = {};

  for (const monto of items) {
    if (!montoRequiereInventario(monto)) {
      picks.push(null); // sin inventario para esta denominación: QR generado
      continue;
    }
    const libre = disponiblesPorMonto(monto).find((v) => !usados.has(v.folio));
    if (!libre) {
      faltantes[monto] = (faltantes[monto] || 0) + 1;
      picks.push(null);
      continue;
    }
    usados.add(libre.folio);
    picks.push({
      folio: libre.folio,
      monto: Number(libre.monto),
      vencimiento: libre.vencimiento || null,
      qrImageBase64: libre.qrImageBase64 || null,
    });
  }
  return { picks, faltantes };
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

// Tras guardar: quita los folios del pool y refresca en segundo plano.
export function marcarAsignadosLocal(folios) {
  const set = new Set(folios.map(String));
  disponibles = disponibles.filter((v) => !set.has(String(v.folio)));
  todosCargados = false;
  refreshPool().catch((err) => console.error("[inventario] refresh:", err));
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

// Recarga el inventario tras devolver un folio (pool + tabla de la pestaña).
export async function refrescarInventario() {
  todosCargados = false;
  await refreshPool();
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
      batch.set(inventarioDocRef(v.folio), {
        folio: String(v.folio),
        monto: Number(v.monto),
        status: "disponible",
        vencimiento: v.vencimiento || null,
        qrImageBase64: v.qrImageBase64,
        asignadoA: null,
        asignadoEn: null,
        batchId: null,
        importadoEn: serverTimestamp(),
        importadoPor,
      });
    }
    await batch.commit();
    guardados += lote.length;
    setProgress(`Importando… ${guardados}/${nuevos.length} vales`);
  }

  // 4) Resumen.
  setProgress("");
  const detalle = resumenPorMonto(nuevos);
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
    `✅ ${guardados} vales importados: ${detalle}` +
      (avisos.length ? `\n⚠️ ${avisos.join(" · ")}` : "")
  );
  if (problemas.length) console.warn("[inventario] vales ilegibles:", problemas);

  deps.showToast(`✅ ${guardados} vales importados al inventario`);

  await Promise.all([cargarTodos(true), refreshPool()]);
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

function renderInventario() {
  renderStock();
  renderTabla();
}

function renderStock() {
  el.stock.innerHTML = "";
  let total = 0;

  for (const monto of INVENTARIO_MONTOS) {
    const libres = todos.filter(
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
  for (const v of todos) {
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

  const filas = todos.filter((v) => {
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
    tr.innerHTML =
      `<td class="inv-folio">${escapeHtml(formatFolio(v.folio))}</td>` +
      `<td class="num">${money(v.monto)}</td>` +
      `<td><span class="badge badge--${status}">${capitalize(status)}</span></td>` +
      `<td>${escapeHtml(v.asignadoA || "—")}</td>` +
      `<td>${asignadoEn}</td>`;
    el.body.appendChild(tr);
  }

  el.empty.hidden = filas.length > 0;
  el.empty.textContent = todos.length
    ? "Ningún vale coincide con los filtros."
    : "Aún no hay vales importados. Usa «📥 Importar PDF».";
  el.count.textContent = `${filas.length} de ${todos.length}`;
}

// "117765" → "117,765" (como lo imprime Combusa)
export function formatFolio(folio) {
  const n = Number(folio);
  return Number.isFinite(n) ? n.toLocaleString("es-MX") : String(folio);
}
