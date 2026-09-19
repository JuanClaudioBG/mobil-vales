// ============================================================================
//  App de registro de vales de gasolina  —  lógica principal
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  firebaseConfig,
  ACCESS_PIN,
  ADMIN_PIN,
  COLLECTION,
  CATEGORIAS,
  MONTOS,
  PERSONAS,
  DEPARTAMENTOS,
} from "./config.js";
import { money, escapeHtml, todayInput } from "./utils.js";
import {
  EMPTY_FILTERS,
  monthRange,
  rangeMonthKey,
  filterDashboardVales,
  calculateDashboardMetrics,
  aggregateTopRequesters,
  requesterDetailRows,
  chartMonths,
  aggregateMonthlySeries,
  orderChartRequesters,
  assignRequesterColors,
} from "./dashboard-data.js";
import {
  initInventario,
  ensurePool,
  renderInventarioAdmin,
  montoRequiereInventario,
  disponiblesPorMonto,
  tomarFolios,
  inventarioDocRef,
  camposAsignacion,
  camposDevolucion,
  existeFolio,
  qrImagenDeFolio,
  refrescarInventario,
  marcarAsignadosLocal,
  formatFolio,
} from "./inventario.js";

// --- Inicialización de Firebase --------------------------------------------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const valesRef = collection(db, COLLECTION);

// --- Referencias al DOM -----------------------------------------------------
const $ = (sel) => document.querySelector(sel);

const pinScreen = $("#pin-screen");
const pinInput = $("#pin-input");
const pinForm = $("#pin-form");
const pinError = $("#pin-error");

const appScreen = $("#app-screen");
const valeForm = $("#vale-form");
const formError = $("#form-error");
const tbody = $("#vales-body");
const emptyState = $("#empty-state");
const totalEl = $("#total-monto");
const countEl = $("#total-count");
const filtroCategoria = $("#filtro-categoria");
const filtroMes = $("#filtro-mes");
const filtroNombre = $("#filtro-nombre");
const appError = $("#app-error");
const loadingEl = $("#loading");
const refreshBtn = $("#btn-actualizar");
const dashRefreshBtn = $("#btn-dash-actualizar");
// Botones «↻ Actualizar» que recargan los vales desde Firestore (Historial y
// Dashboard). Se deshabilitan en bloque mientras dura la lectura.
const refreshButtons = [refreshBtn, dashRefreshBtn].filter(Boolean);
const updateBanner = $("#update-banner");
// Aviso de avance de la importación de PDF: mientras esté visible hay una
// importación en curso y no se debe recargar.
const invProgress = $("#inv-progress");

// Formulario: persona / categoría automática / fecha del vale
const personaSelect = $("#persona");
const notasInput = $("#notas");
const catAuto = $("#cat-auto");
const fechaValeInput = $("#fecha-vale");
const fechaAnteriorToggle = $("#fecha-anterior-toggle");
const fechaValeWrap = $("#fecha-vale-wrap");
const fechaField = $("#fecha-field");
const fechaSwitchLabel = $("#fecha-switch-label");

// Confirmación / toast
const toastEl = $("#toast");
const confirmModal = $("#confirm-modal");
const cPersona = $("#c-persona");
const cCategoria = $("#c-categoria");
const cVales = $("#c-vales");
const cTotal = $("#c-total");
const cFecha = $("#c-fecha");
const cRegistrado = $("#c-registrado");
const btnCancelar = $("#btn-cancelar");
const btnConfirmar = $("#btn-confirmar");

// Modal de PIN de administrador
const adminPinModal = $("#admin-pin-modal");
const adminPinAction = $("#admin-pin-action");
const adminPinInput = $("#admin-pin-input");
const adminPinError = $("#admin-pin-error");
const adminPinOk = $("#admin-pin-ok");
const adminPinCancel = $("#admin-pin-cancel");

// Modal de QR del vale
const qrModal = $("#qr-modal");
const qrProgress = $("#qr-progress");
const qrNombre = $("#qr-nombre");
const qrCategoria = $("#qr-categoria");
const qrMonto = $("#qr-monto");
const qrFecha = $("#qr-fecha");
const qrCanvas = $("#qr-canvas");
const qrCodeText = $("#qr-code");
const qrVence = $("#qr-vence");
const qrAnulado = $("#qr-anulado");
const qrHint = $("#qr-hint");
const qrShareActions = $("#qr-share-actions");
const qrDownload = $("#qr-download");
const qrShare = $("#qr-share");
const qrDone = $("#qr-done");
const qrPrev = $("#qr-prev");
const qrNext = $("#qr-next");

// Autocompletado (sólo "Registrado por")
const registradoPorInput = $("#registradoPor");
const registradoPorSug = $("#registradoPor-sugerencias");

// Navegación por pestañas
const tabButtons = document.querySelectorAll(".tab");
const views = {
  registro: $("#view-registro"),
  dashboard: $("#view-dashboard"),
  admin: $("#view-admin"),
  inventario: $("#view-inventario"),
};

// Dashboard
const dashMes = $("#dash-mes");
const dashFrom = $("#dash-from");
const dashTo = $("#dash-to");
const dashPersona = $("#dash-persona");
const dashTipo = $("#dash-tipo");
const dashChips = $("#dash-chips");
const dashClear = $("#dash-clear");
const dashCount = $("#dash-count");
const dashTotal = $("#dash-total");
const dashTrend = $("#dash-trend");
const dashEmp = $("#dash-emp");
const dashFam = $("#dash-fam");
const dashSoc = $("#dash-soc");
const dashSocCard = $("#dash-soc-card");
const dashSplit = $("#dash-split");
const dashTop = $("#dash-top");
const dashTopEmpty = $("#dash-top-empty");
const dashVerTodos = $("#dash-vertodos");
const dashDetailEl = $("#dash-detail");
const dashDetailClose = $("#dash-detail-close");
const dashCrumbName = $("#dash-crumb-name");
const dashDetailName = $("#dash-detail-name");
const dashDetailSummary = $("#dash-detail-summary");
const dashDetailFormat = $("#dash-detail-format");
const dashDetailBody = $("#dash-detail-body");
const dashDetailEmpty = $("#dash-detail-empty");
const dashChartCanvas = $("#dash-chart");
const dashChartWrap = $("#dash-chart-wrap");
const dashChartHint = $("#dash-chart-hint");
const dashChartEmpty = $("#dash-chart-empty");
const dashLegend = $("#dash-legend");

// Admin
const adminBody = $("#admin-body");
const adminEmpty = $("#admin-empty");
const btnExcel = $("#btn-excel");
const adminValesBody = $("#admin-vales-body");
const adminValesEmpty = $("#admin-vales-empty");

// Carrito de montos (multi-vale)
const denomsEl = $("#denoms");
const carritoResumen = $("#carrito-resumen");
const carritoLista = $("#carrito-lista");
const carritoTotalEl = $("#carrito-total");
const carritoCountEl = $("#carrito-count");
const btnLimpiar = $("#btn-limpiar");

let allVales = [];
const carrito = new Map(); // monto -> cantidad

const MAX_VALES = 20; // tope de vales por registro
let pendingSave = null; // payload en espera de confirmación
let saving = false; // evita doble envío

// Fuente de autocompletado de "Registrado por"
let registradoresDistintos = [];

// Búsqueda rápida persona -> categoría
const personaPorNombre = new Map(PERSONAS.map((p) => [p.nombre, p]));

// --- Mostrar/ocultar un error visible en la interfaz -----------------------
function showAppError(msg) {
  if (loadingEl) loadingEl.hidden = true;
  appError.textContent = msg;
  appError.hidden = false;
  console.error("[vales] " + msg);
}
function clearAppError() {
  appError.hidden = true;
}

// --- Detección de nuevas versiones y recarga automática --------------------
// Al detectar un despliegue nuevo la app se recarga sola, pero NUNCA encima de
// un registro a medias: primero comprueba que no haya nada que perder. Si lo
// hay, muestra un aviso informativo y espera, reintentando cada pocos segundos
// hasta que el usuario termina; entonces recarga sin preguntar.
const VERSION_POLL_MS = 60_000;
const SAFETY_POLL_MS = 2_000;
// Chrome (y otros) frenan los setInterval de las pestañas en segundo plano, y
// en pestañas muy longevas el sondeo puede espaciarse mucho más de 60 s. Si al
// volver a la pestaña han pasado más de 90 s desde la última comprobación
// correcta Y la pestaña llevaba visible todo ese rato, es que el temporizador
// se atascó: se avisa por consola para poder depurarlo.
const VERSION_STALE_MS = 90_000;
// visibilitychange y focus suelen dispararse juntos al cambiar de pestaña;
// dentro de esta ventana se funden en una sola comprobación.
const VERSION_COALESCE_MS = 2_000;
// Margen mínimo entre recargas automáticas. Si version.json se sirviera de
// forma inconsistente (p. ej. una CDN a medio propagar que alterna entre la
// versión vieja y la nueva), sin este tope la app podría entrar en un ciclo de
// recargas. Con el margen, lo peor que puede pasar es una recarga por minuto.
const MIN_RELOAD_GAP_MS = 60_000;
const RELOAD_STAMP_KEY = "vales_ultima_recarga_auto";

// La versión que traía version.json cuando se cargó la app. No se fija a mano:
// la primera lectura la establece, y a partir de ahí cualquier valor distinto
// significa que se publicó un despliegue nuevo mientras la pestaña seguía
// abierta. Basta con subir el string de version.json al desplegar.
let knownAppVersion = null;
let updatePendiente = false; // ya se detectó una versión nueva sin aplicar
let updateBannerVisible = false;
let safetyTimer = null;

// Vigilancia del sondeo (ver VERSION_STALE_MS).
let ultimaComprobacionOk = 0; // marca de la última lectura correcta
let ultimoIntento = 0; // marca del último intento (para fundir eventos)
let comprobando = false; // hay un fetch en vuelo
let visibleDesde = document.hidden ? 0 : Date.now(); // visible de forma continua

async function checkAppVersion() {
  // Un solo fetch a la vez: al volver a la pestaña pueden llegar varios
  // disparadores casi simultáneos.
  if (comprobando) return;
  comprobando = true;
  ultimoIntento = Date.now();
  try {
    // El parámetro único evita además que una CDN intermedia entregue una
    // copia anterior aunque el navegador respete `cache: "no-store"`.
    const versionUrl = new URL("./version.json", window.location.href);
    versionUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(versionUrl, { cache: "no-store" });
    if (!response.ok) return;

    const data = await response.json();
    const version = String(data.version || "").trim();
    if (!version) return;

    // Lectura correcta: reinicia el reloj de la vigilancia.
    ultimaComprobacionOk = Date.now();

    if (knownAppVersion === null) {
      knownAppVersion = version; // primera lectura: la versión de esta sesión
    } else if (version !== knownAppVersion) {
      onNuevaVersion();
    }
  } catch (err) {
    // Un fallo de red no afecta el uso normal; el siguiente sondeo reintenta.
    console.warn("[version] No se pudo comprobar la versión:", err);
  } finally {
    comprobando = false;
  }
}

// Avisa si el sondeo se quedó atascado con la pestaña a la vista. Sólo es
// sospechoso cuando la pestaña llevaba visible más de VERSION_STALE_MS: si
// estuvo en segundo plano, el hueco es normal y esperado.
function avisarSiSondeoEstancado(origen) {
  if (document.hidden || !ultimaComprobacionOk || !visibleDesde) return;
  const hueco = Date.now() - ultimaComprobacionOk;
  const visibleDesdeHace = Date.now() - visibleDesde;
  if (hueco <= VERSION_STALE_MS || visibleDesdeHace <= VERSION_STALE_MS) return;
  console.warn(
    `[version] Sondeo estancado: ${Math.round(hueco / 1000)} s sin comprobar ` +
      `con la pestaña visible (se esperaba cada ${VERSION_POLL_MS / 1000} s; ` +
      `origen "${origen}"). Probable limitación de temporizadores del navegador. ` +
      `Recomprobando ahora.`
  );
}

// Punto de entrada único de todos los disparadores.
function comprobarVersion(origen) {
  if (origen !== "interval") {
    // Funde visibilitychange + focus del mismo cambio de pestaña.
    if (Date.now() - ultimoIntento < VERSION_COALESCE_MS) return;
  }
  avisarSiSondeoEstancado(origen);
  checkAppVersion();
}

// ¿Se puede recargar ahora mismo sin que el usuario pierda nada?
function isSafeToReload() {
  // Registro a medio capturar: se perdería lo tecleado.
  if (personaSelect.value) return false;
  if (carrito.size > 0) return false;
  if (notasInput.value.trim()) return false;
  // Guardado en vuelo: recargar dejaría el lote a medias.
  if (saving) return false;
  // Cualquier modal abierto (confirmación, QR del vale, PIN de administrador):
  // el QR es la única copia que el usuario tiene del vale recién generado.
  if (!confirmModal.hidden || !qrModal.hidden || !adminPinModal.hidden) return false;
  // Importación de PDF en curso: el aviso de avance sigue visible.
  if (invProgress && !invProgress.hidden) return false;
  return true;
}

// Recarga sólo si es seguro. Devuelve true si la recarga se disparó.
function tryAutoReload() {
  if (!isSafeToReload()) return false;
  if (recargadaHacePoco()) return false; // ver MIN_RELOAD_GAP_MS
  aplicarUpdate();
  return true;
}

function recargadaHacePoco() {
  try {
    const previa = Number(sessionStorage.getItem(RELOAD_STAMP_KEY));
    return Number.isFinite(previa) && Date.now() - previa < MIN_RELOAD_GAP_MS;
  } catch (_) {
    return false; // sin sessionStorage (modo privado antiguo): no bloquea
  }
}

function aplicarUpdate() {
  if (safetyTimer) window.clearInterval(safetyTimer);
  try {
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch (_) {
    /* si no se puede escribir, la recarga sigue adelante */
  }
  window.location.reload();
}

function onNuevaVersion() {
  if (updatePendiente) return; // ya hay una actualización en espera
  updatePendiente = true;

  // Camino normal: nadie está capturando nada → se recarga en el acto.
  if (tryAutoReload()) return;

  // Hay trabajo a medias: se avisa y se espera a que termine.
  showUpdateBanner();
  safetyTimer = window.setInterval(tryAutoReload, SAFETY_POLL_MS);
}

function showUpdateBanner() {
  if (updateBannerVisible) return; // una vez visible, ahí se queda
  updateBannerVisible = true;

  updateBanner.hidden = false;
  syncUpdateBannerHeight();
  document.body.classList.add("has-update");
  // El siguiente frame: con el elemento ya visible, la clase .show sí anima el
  // translateY (si se añadiera en el mismo frame el navegador no interpola).
  requestAnimationFrame(() => updateBanner.classList.add("show"));
}

// El texto puede envolverse en pantallas estrechas, así que el hueco reservado
// bajo la barra se toma de su alto real en lugar de un valor fijo.
function syncUpdateBannerHeight() {
  if (!updateBannerVisible) return;
  document.documentElement.style.setProperty(
    "--update-banner-h",
    updateBanner.offsetHeight + "px"
  );
}
window.addEventListener("resize", syncUpdateBannerHeight);

function initVersionCheck() {
  checkAppVersion();

  // 1) Sondeo periódico. Es el que el navegador puede frenar.
  window.setInterval(() => comprobarVersion("interval"), VERSION_POLL_MS);

  // 2) Al volver a la pestaña: comprueba ya, sin esperar al temporizador.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      visibleDesde = 0; // el hueco a partir de aquí es esperado
      return;
    }
    visibleDesde = Date.now();
    comprobarVersion("visibilitychange");
  });

  // 3) Algunos navegadores disparan focus sin visibilitychange (cambio de
  //    ventana, salir de otra app), así que se cubre también.
  window.addEventListener("focus", () => {
    if (!visibleDesde && !document.hidden) visibleDesde = Date.now();
    comprobarVersion("focus");
  });
}

initVersionCheck();

// --- Puerta de PIN (sólo cosmética, ver advertencia en config.js) ----------
let inventarioIniciado = false;

function unlock() {
  pinScreen.hidden = true;
  appScreen.hidden = false;
  sessionStorage.setItem("vales_unlocked", "1");
  loadVales(); // carga inicial (una sola vez); loadVales gestiona sus errores

  // El inventario se conecta al entrar (no antes: así no se descarga nada
  // desde la pantalla del PIN). El pool de folios disponibles se carga en
  // segundo plano y no bloquea la interfaz.
  if (!inventarioIniciado) {
    inventarioIniciado = true;
    initInventario({
      db,
      requestAdminPin,
      showToast,
      // Quién importa el PDF: el mismo nombre que usa "Registrado por".
      getUsuario: () => registradoPorInput.value.trim() || "Admin",
    });
  }
}

pinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (pinInput.value.trim() === ACCESS_PIN) {
    pinError.hidden = true;
    unlock();
  } else {
    pinError.hidden = false;
    pinInput.value = "";
    pinInput.focus();
  }
});

if (sessionStorage.getItem("vales_unlocked") === "1") {
  unlock();
}

// --- Poblar selects desde la config ----------------------------------------
function fillSelect(select, values, includeAllOption = false) {
  if (includeAllOption) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Todas las categorías";
    select.appendChild(opt);
  }
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}
fillSelect(filtroCategoria, CATEGORIAS, true);

// --- Selector de persona (agrupado por departamento) -----------------------
for (const depto of DEPARTAMENTOS) {
  const gente = PERSONAS.filter((p) => p.depto === depto);
  if (gente.length === 0) continue;
  const group = document.createElement("optgroup");
  group.label = depto;
  for (const p of gente) {
    const opt = document.createElement("option");
    opt.value = p.nombre;
    opt.textContent = p.label || p.nombre;
    group.appendChild(opt);
  }
  personaSelect.appendChild(group);
}

// Al elegir persona, autocompleta la categoría (Familia / Empleado).
personaSelect.addEventListener("change", updateCategoriaAuto);
function updateCategoriaAuto() {
  const p = personaPorNombre.get(personaSelect.value);
  if (p) {
    catAuto.textContent = p.categoria;
    catAuto.className = "cat-auto badge badge--" + catSlug(p.categoria);
  } else {
    catAuto.textContent = "—";
    catAuto.className = "cat-auto";
  }
}

// Fecha del vale por defecto = hoy (oculta salvo que se active el backdating).
fechaValeInput.value = todayInput();
fechaAnteriorToggle.addEventListener("change", updateFechaToggle);
function updateFechaToggle() {
  const on = fechaAnteriorToggle.checked;
  fechaValeWrap.hidden = !on;
  fechaField.classList.toggle("active", on);
  fechaSwitchLabel.textContent = on
    ? "📅 Fecha del vale:"
    : "📅 ¿Vale de fecha anterior?";
  if (on && !fechaValeInput.value) fechaValeInput.value = todayInput();
}

// Abrir el selector de fecha/mes al tocar cualquier parte del campo
// (no sólo el pequeño ícono del calendario). Mejora el acceso en móvil.
for (const el of [fechaValeInput, filtroMes, dashMes, dashFrom, dashTo]) {
  el.addEventListener("click", () => {
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
      } catch (_) {
        /* algunos navegadores lo restringen; el toque nativo sigue funcionando */
      }
    }
  });
}

// --- Carrito de montos: botones de denominación (con + y −) -----------------
const denomButtons = [];
for (const monto of MONTOS) {
  const item = document.createElement("div");
  item.className = "denom-item";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "denom-btn";
  btn.dataset.monto = String(monto);
  btn.innerHTML =
    `<span class="denom-amount">$${monto.toLocaleString("es-MX")}</span>` +
    `<span class="denom-badge"></span>`;
  btn.addEventListener("click", () => addToCart(monto));

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "denom-minus";
  minus.textContent = "−";
  minus.title = "Quitar uno";
  minus.hidden = true;
  minus.addEventListener("click", () => removeFromCart(monto));

  item.appendChild(btn);
  item.appendChild(minus);
  denomsEl.appendChild(item);
  denomButtons.push(btn);
}

if (btnLimpiar) btnLimpiar.addEventListener("click", clearCart);

function cartCount() {
  let n = 0;
  for (const c of carrito.values()) n += c;
  return n;
}

function addToCart(monto) {
  if (cartCount() >= MAX_VALES) {
    flashCartNote(`Máximo ${MAX_VALES} vales por registro.`);
    return;
  }
  carrito.set(monto, (carrito.get(monto) || 0) + 1);
  renderCart();
}

function removeFromCart(monto) {
  const c = carrito.get(monto) || 0;
  if (c <= 1) carrito.delete(monto);
  else carrito.set(monto, c - 1);
  renderCart();
}

function clearCart() {
  carrito.clear();
  renderCart();
}

let cartNoteTimer = null;
function flashCartNote(msg) {
  carritoCountEl.textContent = msg;
  carritoCountEl.classList.add("cart-note");
  clearTimeout(cartNoteTimer);
  cartNoteTimer = setTimeout(() => {
    carritoCountEl.classList.remove("cart-note");
    renderCart();
  }, 1800);
}

// Expande el carrito a una lista plana de montos: {200:2,300:1} -> [200,200,300]
function cartItems() {
  const items = [];
  for (const [monto, cantidad] of carrito) {
    for (let i = 0; i < cantidad; i++) items.push(monto);
  }
  return items;
}

function renderCart() {
  // Badges + botón menos en cada denominación
  for (const btn of denomButtons) {
    const monto = Number(btn.dataset.monto);
    const cantidad = carrito.get(monto) || 0;
    const badge = btn.querySelector(".denom-badge");
    badge.textContent = cantidad > 0 ? "×" + cantidad : "";
    btn.classList.toggle("selected", cantidad > 0);
    const minus = btn.parentElement.querySelector(".denom-minus");
    if (minus) minus.hidden = cantidad === 0;
  }

  // Resumen
  carritoLista.innerHTML = "";
  let total = 0;
  const count = cartCount();
  const montosOrdenados = [...carrito.keys()].sort((a, b) => a - b);
  for (const monto of montosOrdenados) {
    const cantidad = carrito.get(monto);
    total += monto * cantidad;
    const li = document.createElement("li");
    li.textContent = `$${monto.toLocaleString("es-MX")} ×${cantidad}`;
    carritoLista.appendChild(li);
  }

  carritoTotalEl.textContent = "$" + total.toLocaleString("es-MX");
  carritoCountEl.classList.remove("cart-note");
  carritoCountEl.textContent =
    count > 0 ? `(${count}/${MAX_VALES} ${count === 1 ? "vale" : "vales"})` : "";
  carritoResumen.hidden = carrito.size === 0;
}

// --- Cargar los vales una sola vez (getDocs) --------------------------------
// Usamos una lectura puntual en lugar de onSnapshot: el canal de streaming en
// tiempo real puede quedarse "colgado" tras algunos firewalls/VPN/extensiones,
// mientras que una lectura puntual falla de forma explícita. El botón
// «Actualizar» permite recargar manualmente.
async function loadVales() {
  clearAppError();
  loadingEl.hidden = false;
  for (const btn of refreshButtons) btn.disabled = true;

  try {
    // Sin orderBy en la consulta: un orderBy("fecha") o ("fechaVale") EXCLUYE
    // los documentos que no tienen ese campo. Los vales antiguos usan 'fecha'
    // y los nuevos 'fechaVale', así que traemos todos y ordenamos en el cliente
    // por valeDate() (fechaVale → fecha → createdAt).
    const snapshot = await withTimeout(getDocs(valesRef), 15000);
    allVales = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    allVales.sort((a, b) => {
      const ta = valeDate(a) ? valeDate(a).getTime() : 0;
      const tb = valeDate(b) ? valeDate(b).getTime() : 0;
      return tb - ta; // más reciente primero
    });
    loadingEl.hidden = true;
    clearAppError();
    refreshDerived(); // fuentes de autocompletado
    renderHistorial();
    renderDashboard();
    renderAdmin();
  } catch (err) {
    loadingEl.hidden = true;
    const code = err && err.code ? ` (${err.code})` : "";
    showAppError(
      "Error al cargar los datos" + code + ": " +
        (err && err.message ? err.message : err) +
        ". Si el código es 'permission-denied', despliega las reglas de Firestore. " +
        "Pulsa «Actualizar» para reintentar."
    );
  } finally {
    for (const btn of refreshButtons) btn.disabled = false;
  }
}

// Rechaza si la promesa no se resuelve dentro de `ms` (evita cuelgues indefinidos).
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Tiempo de espera agotado al conectar con Firestore")),
        ms
      )
    ),
  ]);
}

// Botones de recarga manual (Historial y Dashboard). loadVales() vuelve a
// pintar historial, dashboard y admin, así que ambos respetan los filtros y el
// mes que estén seleccionados en ese momento.
for (const btn of refreshButtons) btn.addEventListener("click", loadVales);

// --- Enviar: validar → mostrar confirmación --------------------------------
valeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const persona = personaPorNombre.get(personaSelect.value);
  // Si el toggle está apagado, la fecha es HOY; si está encendido, la del picker.
  const fechaValeStr = fechaAnteriorToggle.checked ? fechaValeInput.value : todayInput();

  const base = {
    nombre: persona ? persona.nombre : "",
    categoria: persona ? persona.categoria : "",
    registradoPor: registradoPorInput.value.trim(),
    notas: notasInput.value.trim(),
    fechaValeStr,
  };

  const problema = validarBase(base);
  if (problema) {
    formError.textContent = problema;
    formError.hidden = false;
    return;
  }

  const items = cartItems();
  if (items.length === 0) {
    formError.textContent = "Agrega al menos un vale tocando una denominación.";
    formError.hidden = false;
    return;
  }
  if (items.length > MAX_VALES) {
    formError.textContent = `Máximo ${MAX_VALES} vales por registro.`;
    formError.hidden = false;
    return;
  }

  // Cada vale tiene que respaldarse con un folio real del inventario de
  // Combusa. Se comprueba ANTES de confirmar para no dejar el registro a medias.
  const faltaInventario = await revisarInventario(items);
  if (faltaInventario) {
    formError.textContent = faltaInventario;
    formError.hidden = false;
    return;
  }

  pendingSave = { base, items };
  openConfirm(base, items);
});

// Devuelve un mensaje de aviso si no hay folios suficientes, o null si todo bien.
async function revisarInventario(items) {
  // ensurePool() nunca falla: si el inventario no se puede leer, queda vacío y
  // montoRequiereInventario() devuelve false, así que el registro sigue como
  // antes (QR generado) en lugar de bloquearse.
  await ensurePool();

  // Cuántos se piden de cada denominación que sale del inventario.
  const pedidos = new Map();
  for (const monto of items) {
    if (!montoRequiereInventario(monto)) continue;
    pedidos.set(monto, (pedidos.get(monto) || 0) + 1);
  }

  const avisos = [];
  for (const [monto, cantidad] of [...pedidos].sort((a, b) => a[0] - b[0])) {
    const libres = disponiblesPorMonto(monto).length;
    if (libres >= cantidad) continue;
    avisos.push(
      libres === 0
        ? `⚠️ Sin inventario de ${money(monto)} disponible`
        : `⚠️ Sólo quedan ${libres} vales de ${money(monto)} en inventario (pediste ${cantidad})`
    );
  }
  if (avisos.length === 0) return null;
  return avisos.join(". ") + ". Importa el PDF de Combusa en la pestaña Admin.";
}

function validarBase(d) {
  if (!d.nombre || !CATEGORIAS.includes(d.categoria)) return "Selecciona una persona del directorio.";
  if (!d.registradoPor || d.registradoPor.length > 100) return "Indica quién registra el vale (máx. 100).";
  if (!d.fechaValeStr) return "Elige la fecha del vale.";
  if (d.notas && d.notas.length > 500) return "Las notas no pueden superar 500 caracteres.";
  return null;
}

// --- Modal de confirmación --------------------------------------------------
function openConfirm(base, items) {
  cPersona.textContent = base.nombre;
  cCategoria.textContent = base.categoria;
  cVales.textContent = resumenVales(items);
  cTotal.textContent = money(sum(items));
  cFecha.textContent = parseDateInput(base.fechaValeStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  cRegistrado.textContent = base.registradoPor;
  confirmModal.hidden = false;
}

function closeConfirm() {
  confirmModal.hidden = true;
}

// Agrupa items en "$200 ×2, $500 ×1"
function resumenVales(items) {
  const counts = new Map();
  for (const m of items) counts.set(m, (counts.get(m) || 0) + 1);
  return [...counts.keys()]
    .sort((a, b) => a - b)
    .map((m) => `$${m.toLocaleString("es-MX")} ×${counts.get(m)}`)
    .join(", ");
}

btnCancelar.addEventListener("click", () => {
  closeConfirm();
  pendingSave = null;
});
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) {
    closeConfirm();
    pendingSave = null;
  }
});
btnConfirmar.addEventListener("click", doSave);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmModal.hidden && !saving) {
    closeConfirm();
    pendingSave = null;
  }
});

// --- Guardar de verdad (tras confirmar) -------------------------------------
async function doSave() {
  if (saving || !pendingSave) return; // evita doble envío
  saving = true;

  const { base, items } = pendingSave;
  const fechaVale = Timestamp.fromDate(parseDateInput(base.fechaValeStr));
  // batchId único: permite detectar/depurar envíos duplicados.
  const batchId = uuid();

  btnConfirmar.disabled = true;
  btnCancelar.disabled = true;
  btnConfirmar.innerHTML = '<span class="spinner"></span> Guardando…';

  // Vales guardados en este lote, para mostrar sus QR tras el registro.
  const savedVales = [];

  // Folios reales del inventario, uno por vale (null si esa denominación no
  // sale del inventario).
  const { picks, faltantes } = tomarFolios(items);
  if (Object.keys(faltantes).length > 0) {
    // El inventario cambió entre la confirmación y el guardado (otro registro
    // se llevó los folios). Mejor abortar que guardar vales sin respaldo.
    const detalle = Object.keys(faltantes)
      .sort((a, b) => a - b)
      .map((m) => money(m))
      .join(", ");
    saving = false;
    btnConfirmar.disabled = false;
    btnCancelar.disabled = false;
    btnConfirmar.textContent = "Confirmar";
    closeConfirm();
    formError.textContent = `⚠️ Sin inventario de ${detalle} disponible. Actualiza el inventario e inténtalo de nuevo.`;
    formError.hidden = false;
    return;
  }
  const foliosAsignados = [];

  try {
    const anio = parseDateInput(base.fechaValeStr).getFullYear();
    const batch = writeBatch(db);
    items.forEach((monto, i) => {
      const ref = doc(valesRef); // ID automático
      const pick = picks[i];
      // Con folio del inventario el "código" del vale ES el folio de Combusa;
      // si no hay inventario para esa denominación se mantiene el código
      // generado por la app.
      const qrCode = pick ? `COMBUSA-${pick.folio}` : makeQrCode(anio);
      const docData = {
        nombre: base.nombre,
        categoria: base.categoria,
        monto,
        registradoPor: base.registradoPor,
        fechaVale,
        createdAt: serverTimestamp(),
        anulado: false,
        batchId,
        qrCode,
      };
      if (base.notas) docData.notas = base.notas; // opcional
      if (pick) {
        docData.folio = pick.folio;
        if (pick.vencimiento) docData.vencimiento = pick.vencimiento;
        // El vale del inventario pasa a "asignado" en el MISMO lote: o se
        // guarda todo, o no se guarda nada.
        batch.update(inventarioDocRef(pick.folio), camposAsignacion(base.nombre, batchId));
        foliosAsignados.push(pick.folio);
      }
      batch.set(ref, docData);
      savedVales.push({
        nombre: base.nombre,
        categoria: base.categoria,
        monto,
        fechaStr: base.fechaValeStr,
        qrCode,
        folio: pick ? pick.folio : null,
        vencimiento: pick ? pick.vencimiento : null,
        qrImageBase64: pick ? pick.qrImageBase64 : null,
      });
    });
    await batch.commit();
    if (foliosAsignados.length) marcarAsignadosLocal(foliosAsignados);

    const n = items.length;
    const total = sum(items);
    pendingSave = null;
    closeConfirm();
    valeForm.reset();
    clearCart();
    updateCategoriaAuto();
    fechaAnteriorToggle.checked = false;
    fechaValeInput.value = todayInput();
    updateFechaToggle(); // oculta el picker, quita el resaltado y restaura la etiqueta
    personaSelect.focus();
    showToast(`✅ ${n} ${n === 1 ? "vale registrado" : "vales registrados"} — ${money(total)} total`);
    await loadVales();
    // Tras el toast de éxito, muestra el QR de cada vale del lote.
    openQrModal(savedVales);
  } catch (err) {
    console.error("Error al guardar:", err);
    formError.textContent = "No se pudieron guardar los vales: " + err.message;
    formError.hidden = false;
    closeConfirm();
  } finally {
    saving = false;
    btnConfirmar.disabled = false;
    btnCancelar.disabled = false;
    btnConfirmar.textContent = "Confirmar";
  }
}

// --- Toast de éxito (auto-cierra en 3 s) ------------------------------------
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => (toastEl.hidden = true), 300);
  }, 3000);
}

// ===========================================================================
//  QR del vale (prototipo) — código de prueba SPECTRO-FUEL-{AÑO}-{8 CHARS}
// ===========================================================================
// Genera un código de prueba único: SPECTRO-FUEL-2026-A3K9XM2P
function makeQrCode(anio) {
  const year = Number.isFinite(anio) ? anio : new Date().getFullYear();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let rand = "";
  for (let i = 0; i < 8; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SPECTRO-FUEL-${year}-${rand}`;
}

// Cola de vales por mostrar en el modal de QR y el índice actual.
let qrQueue = [];
let qrIndex = 0;

function openQrModal(vales) {
  if (!Array.isArray(vales) || vales.length === 0) return;
  qrQueue = vales;
  qrIndex = 0;
  qrModal.hidden = false;
  renderQrVale();
}

// Token de render: evita que un dibujado asíncrono que llega tarde pise el
// vale que se está mostrando (p. ej. si se pulsa "Siguiente" muy rápido).
let qrRenderToken = 0;

async function renderQrVale() {
  const v = qrQueue[qrIndex];
  if (!v) return;
  const total = qrQueue.length;
  const token = ++qrRenderToken;

  qrProgress.hidden = total <= 1;
  qrProgress.textContent = `Vale ${qrIndex + 1} de ${total}`;

  qrNombre.textContent = v.nombre;
  qrCategoria.textContent = v.categoria;
  qrMonto.textContent = money(v.monto);
  // Los vales reabiertos derivan la fecha de lo guardado; si un vale muy
  // antiguo no tuviera ninguna fecha utilizable, se muestra un guion.
  const fechaTxt = v.fechaStr
    ? parseDateInput(v.fechaStr).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
  qrFecha.textContent = fechaTxt;
  // Con folio real se muestra el folio de Combusa (destacado: es EL dato que
  // pide la gasolinera); si no, el código generado por la app, más discreto.
  qrCodeText.textContent = v.folio ? `Folio: ${formatFolio(v.folio)}` : v.qrCode;
  qrCodeText.classList.toggle("qr-code--folio", !!v.folio);
  qrVence.hidden = !v.vencimiento;
  if (v.vencimiento) {
    qrVence.textContent =
      "Vence: " +
      parseDateInput(v.vencimiento).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
  }

  // Vale ANULADO (sólo se llega aquí reabriéndolo desde el historial): el
  // modal queda en modo CONSULTA. Sin descargar ni compartir, porque el folio
  // pudo volver al inventario y estar ya reasignado a otra persona: esa imagen
  // no debe volver a circular como si el vale siguiera siendo válido.
  const anulado = !!v.anulado;
  qrAnulado.hidden = !anulado;
  qrShareActions.hidden = anulado;
  qrHint.hidden = anulado;

  // Oculta la confirmación "✅ Listo" al cambiar de vale.
  hideQrDone();

  // Identificador que se muestra al compartir: el folio real si lo hay.
  const idTxt = v.folio ? `Folio: ${formatFolio(v.folio)}` : `Código: ${v.qrCode}`;

  // Descargar: exporta el QR como PNG (fondo blanco, sin transparencia).
  qrDownload.onclick = () => {
    if (anulado) return; // vale anulado: sólo consulta
    const blob = qrToPngBlob();
    if (!blob) return;
    downloadBlob(blob, qrFileName(v));
    showQrDone();
  };

  // Compartir: Web Share API con el archivo PNG; si no está disponible, descarga.
  qrShare.onclick = async () => {
    if (anulado) return; // vale anulado: sólo consulta
    const blob = qrToPngBlob();
    if (!blob) return;
    const fileName = qrFileName(v);
    const file = new File([blob], fileName, { type: "image/png" });
    const shareData = {
      files: [file],
      title: `Vale de Gasolina ${money(v.monto)}`,
      text:
        `Tu vale de gasolina Spectro Networks\n` +
        `Asignado a: ${v.nombre}\n` +
        `Monto: ${money(v.monto)}\n` +
        `Fecha: ${fechaTxt}\n` +
        idTxt +
        (v.vencimiento ? `\nVence: ${v.vencimiento}` : ""),
    };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share(shareData);
        showQrDone();
      } catch (err) {
        // El usuario canceló el diálogo (AbortError) o falló: no hacemos nada.
      }
    } else {
      // Sin Web Share API para archivos: respaldo → descargar.
      downloadBlob(blob, fileName);
      showQrDone();
    }
  };

  // "← Anterior" oculto en el primer vale; sin sentido si sólo hay uno.
  qrPrev.hidden = qrIndex === 0;
  // Último vale del lote → "Cerrar"; si quedan más → "Siguiente →".
  qrNext.textContent = qrIndex === total - 1 ? "Cerrar" : "Siguiente →";

  // El QR se pinta al final: así los botones ya responden al vale correcto
  // mientras se decodifica la imagen.
  qrCanvas.innerHTML = "";
  if (v.qrImageBase64) {
    // Vale REAL de Combusa: se pinta la imagen del QR que venía en el PDF.
    // Se dibuja en un <canvas> (no en un <img>) para que "Descargar" y
    // "Compartir" sigan funcionando de forma síncrona, igual que antes.
    await drawQrImage(v.qrImageBase64, token);
  } else if (v.folio) {
    // Vale de Combusa reabierto cuyo QR no se pudo recuperar del inventario.
    // NO se dibuja un QR generado a partir de "COMBUSA-{folio}": ese texto no
    // es el payload que lee la gasolinera, así que sería un QR falso. Se
    // muestra el motivo y el folio (que sigue siendo el original).
    qrCanvas.textContent = v.avisoQr || "No se pudo mostrar el QR de este vale.";
  } else if (window.QRCode) {
    // Sin inventario para esta denominación: QR generado por la app, a 1024px
    // internos (PNG de alta calidad); el CSS lo muestra a min(80vw, 280px).
    new window.QRCode(qrCanvas, {
      text: v.qrCode,
      width: 1024,
      height: 1024,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    // Respaldo si la CDN no cargó: al menos mostramos el código en texto.
    qrCanvas.textContent = v.qrCode;
  }
}

// Pinta la imagen real del QR (base64 del PDF de Combusa) en un <canvas>, para
// que el resto del modal (descargar/compartir) funcione sin cambios.
async function drawQrImage(base64, token) {
  const img = new Image();
  img.src = "data:image/png;base64," + base64;
  try {
    // decode() espera a que la imagen esté lista para pintarse.
    if (img.decode) await img.decode();
    else await new Promise((ok, fail) => ((img.onload = ok), (img.onerror = fail)));
  } catch (err) {
    console.error("[vales] QR del inventario ilegible:", err);
    qrCanvas.textContent = "No se pudo mostrar el QR de este vale.";
    return;
  }
  if (token !== qrRenderToken) return; // ya se está mostrando otro vale

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 480;
  canvas.height = img.naturalHeight || 480;
  // El QR real se muestra reducido: con suavizado se conserva la rejilla de
  // módulos mejor que con 'pixelated'.
  canvas.className = "qr-real";
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  qrCanvas.innerHTML = "";
  qrCanvas.appendChild(canvas);
}

// Devuelve el <canvas> que contiene los píxeles del QR (generado o real).
function getQrCanvas() {
  return qrCanvas.querySelector("canvas");
}

// Compone el QR sobre fondo blanco (sin transparencia) y lo devuelve como
// Blob PNG. Es SÍNCRONO a propósito: así navigator.share() sigue dentro del
// gesto del usuario (algunos navegadores lo exigen).
function qrToPngBlob() {
  const src = getQrCanvas();
  if (!src) return null;
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return dataUrlToBlob(out.toDataURL("image/png"));
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Nombre de archivo: vale-{monto}-{nombre-normalizado}-{folio|qrCode}.png
function qrFileName(v) {
  const id = v.folio ? `folio-${v.folio}` : v.qrCode;
  return `vale-${v.monto}-${normalizeNombre(v.nombre)}-${id}.png`;
}

// Normaliza el nombre: minúsculas, sin acentos, espacios → guiones.
function normalizeNombre(nombre) {
  return String(nombre)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Confirmación "✅ Listo" durante 2 s (no cierra el modal).
let qrDoneTimer = null;
function showQrDone() {
  qrDone.classList.add("show");
  clearTimeout(qrDoneTimer);
  qrDoneTimer = setTimeout(hideQrDone, 2000);
}
function hideQrDone() {
  clearTimeout(qrDoneTimer);
  qrDone.classList.remove("show");
}

function closeQrModal() {
  qrModal.hidden = true;
  qrCanvas.innerHTML = "";
  qrQueue = [];
  qrIndex = 0;
}

qrNext.addEventListener("click", () => {
  if (qrIndex < qrQueue.length - 1) {
    qrIndex++;
    renderQrVale();
  } else {
    closeQrModal();
  }
});
qrPrev.addEventListener("click", () => {
  if (qrIndex > 0) {
    qrIndex--;
    renderQrVale(); // regenera QR y datos del vale anterior
  }
});
// Cerrar al tocar fuera de la tarjeta.
qrModal.addEventListener("click", (e) => {
  if (e.target === qrModal) closeQrModal();
});
// Cerrar con Escape.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !qrModal.hidden) closeQrModal();
});

// UUID v4 (con respaldo si crypto.randomUUID no existe).
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ===========================================================================
//  Reabrir un vale YA EMITIDO (historial / admin)
// ===========================================================================
//  Si el usuario cierra el modal sin descargar ni compartir, el vale NO se ha
//  perdido: sigue en Firestore con su código/folio. Esta sección lo vuelve a
//  mostrar a partir de lo que hay guardado.
//
//  Es SÓLO LECTURA. No emite nada ni toca nada: no llama a makeQrCode(),
//  tomarFolios(), writeBatch() ni a ninguna escritura de Firestore, así que el
//  código, el folio, el estado del inventario y las fechas del vale quedan
//  exactamente como estaban.
// ===========================================================================

// ¿Hay algo que volver a mostrar? Los vales anteriores al QR no guardaron ni
// `qrCode` ni `folio`: de esos no se puede reconstruir nada.
function sePuedeReabrir(v) {
  return Boolean(v && (v.qrCode || v.folio));
}

// "YYYY-MM-DD" de la fecha del vale: es el formato que espera el modal.
function fechaValeInputStr(v) {
  const d = valeDate(v);
  if (!d) return null;
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// Rehace el modelo que usa el modal a partir del vale guardado. El QR de un
// vale con folio vive en `inventario/{folio}` (una lectura); el de un vale con
// código generado se vuelve a dibujar a partir del propio `qrCode`, que es
// determinista.
async function valeParaModal(v) {
  const modelo = {
    nombre: v.nombre,
    categoria: v.categoria,
    monto: v.monto,
    fechaStr: fechaValeInputStr(v),
    qrCode: v.qrCode || (v.folio ? `COMBUSA-${v.folio}` : ""),
    folio: v.folio || null,
    vencimiento: v.vencimiento || null,
    qrImageBase64: null,
    anulado: !!v.anulado,
    avisoQr: null,
  };

  if (modelo.folio) {
    const res = await qrImagenDeFolio(modelo.folio);
    if (res.ok && res.imagen) {
      modelo.qrImageBase64 = res.imagen;
    } else if (res.ok || res.motivo === "no-existe") {
      // El vale existe y sus datos son los originales; lo que falta es la
      // imagen del QR en el inventario.
      modelo.avisoQr =
        "Este vale existe, pero su QR ya no está en el inventario. " +
        "Usa el folio que aparece abajo.";
    } else {
      // Fallo de lectura: NO es que el vale no exista.
      modelo.avisoQr =
        "No se pudo cargar el QR (revisa la conexión e inténtalo de nuevo). " +
        "El folio de abajo es el original del vale.";
    }
  }

  return modelo;
}

// Botón "Ver" de una fila: reabre ESE vale, sin crear ninguno nuevo.
function botonVerVale(v) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-ver";
  btn.textContent = "Ver";
  btn.title = v.anulado ? "Ver el vale anulado (sólo consulta)" : "Ver el vale";
  btn.addEventListener("click", () => abrirValeExistente(v, btn));
  return btn;
}

async function abrirValeExistente(v, btn) {
  if (btn.disabled) return; // evita reabrirlo dos veces mientras carga el QR
  btn.disabled = true;
  try {
    openQrModal([await valeParaModal(v)]);
  } catch (err) {
    console.error("[vales] no se pudo reabrir el vale:", err);
    alert("No se pudo abrir el vale: " + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
  }
}

// Celda de acciones de una fila (historial y admin). "Ver" va SIEMPRE antes de
// "Anular": anular es la acción destructiva, no debe ser la única a mano.
function celdaAcciones(v, { conAnular }) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "acciones";

  if (sePuedeReabrir(v)) wrap.appendChild(botonVerVale(v));

  if (conAnular) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-anular";
    btn.title = "Anular";
    btn.textContent = "Anular";
    btn.addEventListener("click", () => anularVale(v));
    wrap.appendChild(btn);
  }

  td.appendChild(wrap);
  return td;
}

// --- PIN de administrador (reutilizable para acciones sensibles) ------------
// Devuelve una promesa que resuelve true (PIN correcto) o false (cancelado).
let adminPinResolver = null;
function requestAdminPin(actionLabel) {
  return new Promise((resolve) => {
    adminPinResolver = resolve;
    adminPinAction.textContent = actionLabel || "";
    adminPinInput.value = "";
    adminPinError.hidden = true;
    adminPinModal.hidden = false;
    setTimeout(() => adminPinInput.focus(), 40);
  });
}
function settleAdminPin(result) {
  adminPinModal.hidden = true;
  const resolve = adminPinResolver;
  adminPinResolver = null;
  if (resolve) resolve(result);
}
adminPinOk.addEventListener("click", () => {
  if (adminPinInput.value.trim() === ADMIN_PIN) {
    settleAdminPin(true);
  } else {
    // PIN incorrecto: muestra error; la acción no procede hasta un PIN válido.
    adminPinError.hidden = false;
    adminPinInput.value = "";
    adminPinInput.focus();
  }
});
adminPinCancel.addEventListener("click", () => settleAdminPin(false));
adminPinModal.addEventListener("click", (e) => {
  if (e.target === adminPinModal) settleAdminPin(false);
});
adminPinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    adminPinOk.click();
  } else if (e.key === "Escape") {
    settleAdminPin(false);
  }
});

// --- Anular un vale (borrado suave) — requiere PIN de administrador ----------
// Si el vale usaba un folio real de Combusa, ese folio VUELVE al inventario
// como "disponible": el vale de papel no se gastó, así que puede reasignarse.
async function anularVale(vale) {
  const { id, nombre, folio } = vale;

  const ok = await requestAdminPin(
    `Anular el vale de "${nombre}". Dejará de contar en reportes.` +
      (folio ? ` El folio ${formatFolio(folio)} volverá al inventario.` : "")
  );
  if (!ok) return;

  try {
    // ¿Sigue existiendo el vale de papel? Los folios de pruebas anteriores
    // pueden haberse borrado; en ese caso se anula el vale y ya está.
    const devolver = folio ? await existeFolio(folio) : false;

    // Un solo lote: o se anula el vale Y se devuelve el folio, o no pasa nada.
    const batch = writeBatch(db);
    batch.update(doc(db, COLLECTION, id), {
      anulado: true,
      anuladoEn: serverTimestamp(),
    });
    if (devolver) batch.update(inventarioDocRef(folio), camposDevolucion());
    await batch.commit();

    if (devolver) {
      await refrescarInventario();
      showToast(`✅ Vale anulado · folio ${formatFolio(folio)} devuelto al inventario`);
    } else {
      showToast("✅ Vale anulado");
    }
    await loadVales();
  } catch (err) {
    console.error("Error al anular:", err);
    alert("No se pudo anular: " + err.message);
  }
}

// ===========================================================================
//  Navegación por pestañas
// ===========================================================================
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    for (const [name, el] of Object.entries(views)) el.hidden = name !== target;
    // Re-render por si cambiaron datos.
    if (target === "dashboard") renderDashboard();
    if (target === "admin") renderAdmin();
    // El inventario completo (con el base64 de cada QR) se descarga sólo al
    // abrir su pestaña, no al entrar a la app.
    if (target === "inventario") renderInventarioAdmin();
  });
});

// ===========================================================================
//  Datos derivados (autocompletado)
// ===========================================================================
function refreshDerived() {
  registradoresDistintos = distinct(allVales.map((v) => v.registradoPor));
}
function distinct(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}

// ===========================================================================
//  Autocompletado genérico
// ===========================================================================
function setupAutocomplete(input, listEl, getSource, onPick) {
  function show() {
    const q = input.value.trim().toLowerCase();
    const source = getSource();
    const matches = (q
      ? source.filter((s) => s.toLowerCase().includes(q))
      : source
    ).slice(0, 8);

    listEl.innerHTML = "";
    if (matches.length === 0) {
      listEl.hidden = true;
      return;
    }
    for (const m of matches) {
      const li = document.createElement("li");
      li.textContent = m;
      // mousedown (no click) para que dispare antes del blur del input
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = m;
        listEl.hidden = true;
        if (onPick) onPick();
      });
      listEl.appendChild(li);
    }
    listEl.hidden = false;
  }
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("blur", () => setTimeout(() => (listEl.hidden = true), 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") listEl.hidden = true;
  });
}

setupAutocomplete(registradoPorInput, registradoPorSug, () => registradoresDistintos);

// ===========================================================================
//  Filtros del historial (mes + nombre + categoría, en conjunto = AND)
// ===========================================================================
filtroCategoria.addEventListener("change", renderHistorial);
filtroMes.addEventListener("change", renderHistorial);
filtroNombre.addEventListener("input", renderHistorial);

// Mes actual por defecto en los selectores de mes.
filtroMes.value = currentMonthKey();
dashMes.value = currentMonthKey();

function renderHistorial() {
  const cat = filtroCategoria.value;
  const mes = filtroMes.value; // "YYYY-MM" o ""
  const nombreQ = filtroNombre.value.trim().toLowerCase();

  const vales = activos(allVales).filter((v) => {
    if (cat && v.categoria !== cat) return false;
    if (mes && monthKey(valeDate(v)) !== mes) return false;
    if (nombreQ && !(v.nombre || "").toLowerCase().includes(nombreQ)) return false;
    return true;
  });

  tbody.innerHTML = "";
  let total = 0;

  for (const v of vales) {
    total += Number(v.monto) || 0;
    const tr = document.createElement("tr");
    tr.className = "row-" + catSlug(v.categoria);
    tr.innerHTML = `
      <td>${escapeHtml(v.nombre)}</td>
      <td class="col-categoria"><span class="badge badge--${catSlug(v.categoria)}">${escapeHtml(
      v.categoria
    )}</span></td>
      <td class="num">$${Number(v.monto).toLocaleString("es-MX")}</td>
      <td>${formatFechaVale(v)}</td>
      <td class="col-registrado">${escapeHtml(v.registradoPor || "")}</td>
      <td class="notas col-notas">${escapeHtml(v.notas || "")}</td>
    `;
    tr.appendChild(celdaAcciones(v, { conAnular: true }));
    tbody.appendChild(tr);
  }

  emptyState.hidden = vales.length > 0;
  totalEl.textContent = "$" + total.toLocaleString("es-MX");
  countEl.textContent = String(vales.length);
}

// ===========================================================================
//  Dashboard  (sólo lectura: filtra y agrega `allVales` en memoria)
// ===========================================================================
//  Flujo: allVales → dashRecords() → filterDashboardVales(dashFilters) →
//  agregaciones puras (dashboard-data.js) → render de cada widget.
//  Estado de UI (no se persiste): filtros, detalle abierto y "Ver todos".
//  TODO: filtro Área — requiere un campo real `area` en los vales (hoy no existe;
//        no derivar de PERSONAS.depto).
//  TODO: filtro Unidad — pendiente de producto
const TOP_VISIBLE = 5;

let dashFilters = { ...EMPTY_FILTERS, ...monthRange(currentMonthKey()) };
let dashDetail = null; // nombre del solicitante abierto en el detalle
let dashExpanded = false; // Top: mostrar todos vs top 5
let dashChart = null; // instancia de Chart.js

function defaultDashFilters() {
  return { ...EMPTY_FILTERS, ...monthRange(currentMonthKey()) };
}

// Normaliza cada vale una sola vez por render (fecha ya resuelta).
function dashRecords() {
  return allVales.map((v) => ({
    id: v.id,
    nombre: v.nombre || "",
    categoria: v.categoria || "",
    monto: v.monto,
    date: valeDate(v),
    anulado: Boolean(v.anulado),
    // Sin qrCode: el código canjeable nunca se muestra en analítica.
    folio: v.folio != null && String(v.folio).trim() !== "" ? String(v.folio).trim() : "",
  }));
}

function setDashFilters(patch) {
  dashFilters = { ...dashFilters, ...patch };
  // Con un rango invertido se intercambian los extremos: siempre hay UN periodo válido.
  if (dashFilters.dateFrom && dashFilters.dateTo && dashFilters.dateFrom > dashFilters.dateTo) {
    [dashFilters.dateFrom, dashFilters.dateTo] = [dashFilters.dateTo, dashFilters.dateFrom];
  }
  dashExpanded = false;
  renderDashboard();
}

dashMes.addEventListener("change", () => {
  // El mes es un preset del rango canónico; vacío = volver al mes actual.
  setDashFilters(monthRange(dashMes.value || currentMonthKey()));
});
dashFrom.addEventListener("change", () => setDashFilters({ dateFrom: dashFrom.value }));
dashTo.addEventListener("change", () => setDashFilters({ dateTo: dashTo.value }));
dashPersona.addEventListener("change", () => setDashFilters({ persona: dashPersona.value }));
dashTipo.addEventListener("change", () => setDashFilters({ tipo: dashTipo.value }));
dashClear.addEventListener("click", () => {
  // Limpia filtros; el detalle abierto (si lo hay) se conserva y se recalcula.
  dashFilters = defaultDashFilters();
  dashExpanded = false;
  renderDashboard();
});
dashVerTodos.addEventListener("click", () => {
  dashExpanded = !dashExpanded;
  renderDashboard();
});
dashDetailClose.addEventListener("click", () => {
  // Sólo cierra el detalle: los filtros se mantienen.
  const name = dashDetail;
  dashDetail = null;
  renderDashboard();
  dashTop.querySelector(`[data-name="${CSS.escape(name || "")}"]`)?.focus();
});
dashTop.addEventListener("click", (e) => {
  const row = e.target.closest(".lb-row[data-name]");
  if (!row) return;
  openDashDetail(dashDetail === row.dataset.name ? null : row.dataset.name);
});

function openDashDetail(name) {
  dashDetail = name;
  renderDashboard();
  // En móvil el panel queda debajo del Top: se lleva a la vista.
  if (name && window.matchMedia("(max-width: 900px)").matches) {
    dashDetailEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function fillDashSelect(select, values, current) {
  const first = select.options[0];
  select.replaceChildren(first);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  // Un valor filtrado que ya no aparece en los datos se conserva visible.
  if (current && !values.includes(current)) {
    const opt = document.createElement("option");
    opt.value = current;
    opt.textContent = current;
    select.appendChild(opt);
  }
  select.value = current;
}

function shortDay(iso) {
  return parseDateInput(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

function periodLabel({ dateFrom, dateTo }) {
  const mk = rangeMonthKey(dateFrom, dateTo);
  if (mk) {
    const [y, m] = mk.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  }
  if (dateFrom && dateTo) return `${shortDay(dateFrom)} – ${shortDay(dateTo)} ${dateTo.slice(0, 4)}`;
  if (dateFrom) return `Desde ${shortDay(dateFrom)} ${dateFrom.slice(0, 4)}`;
  if (dateTo) return `Hasta ${shortDay(dateTo)} ${dateTo.slice(0, 4)}`;
  return "Todo el historial";
}

function renderDashboard() {
  const records = dashRecords();
  const f = dashFilters;

  // --- Controles: reflejan el estado único -------------------------------
  const personas = [...new Set(records.map((r) => r.nombre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es"));
  const tipos = [...new Set(records.map((r) => r.categoria).filter(Boolean))]
    .sort((a, b) => CATEGORIAS.indexOf(a) - CATEGORIAS.indexOf(b));
  fillDashSelect(dashPersona, personas, f.persona);
  fillDashSelect(dashTipo, tipos, f.tipo);
  dashFrom.value = f.dateFrom;
  dashTo.value = f.dateTo;
  const presetMonth = rangeMonthKey(f.dateFrom, f.dateTo);
  dashMes.value = presetMonth || "";
  renderDashChips(presetMonth);

  // --- Población filtrada (la MISMA para todos los widgets) --------------
  const filtered = filterDashboardVales(records, f);
  const metrics = calculateDashboardMetrics(filtered);
  dashCount.textContent = String(metrics.count);
  dashTotal.textContent = money(metrics.total);
  renderDashTrend(records, metrics.total, presetMonth);
  const cat = (name) => metrics.byTipo.get(name) || { count: 0, total: 0 };
  dashEmp.textContent = `${cat("Empleado").count} · ${money(cat("Empleado").total)}`;
  dashFam.textContent = `${cat("Familia").count} · ${money(cat("Familia").total)}`;
  dashSoc.textContent = `${cat("Socio").count} · ${money(cat("Socio").total)}`;
  dashSocCard.hidden = cat("Socio").count === 0;

  const ranking = aggregateTopRequesters(filtered);
  // Color fijo por solicitante (no depende de filtros): el mismo en Top, gráfica y leyenda.
  const colors = assignRequesterColors(
    PERSONAS.map((p) => p.nombre),
    records.map((r) => r.nombre || "Sin nombre")
  );
  renderDashTop(ranking, colors);
  renderDashDetail(filtered);
  renderDashChart(records, ranking, colors);
}

function renderDashChips(presetMonth) {
  const f = dashFilters;
  const chips = [];
  const isDefault = presetMonth === currentMonthKey();
  chips.push({
    label: presetMonth ? `Periodo: ${periodLabel(f)}` : `Rango personalizado: ${periodLabel(f)}`,
    clear: isDefault ? null : () => ({ ...monthRange(currentMonthKey()) }),
  });
  if (f.persona) chips.push({ label: `Persona: ${f.persona}`, clear: () => ({ persona: "" }) });
  if (f.tipo) chips.push({ label: `Tipo: ${f.tipo}`, clear: () => ({ tipo: "" }) });

  dashChips.innerHTML = "";
  for (const chip of chips) {
    const el = document.createElement("span");
    el.className = "dash-chip";
    el.textContent = chip.label;
    if (chip.clear) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "dash-chip-x";
      x.setAttribute("aria-label", `Quitar ${chip.label}`);
      x.textContent = "✕";
      x.addEventListener("click", () => setDashFilters(chip.clear()));
      el.appendChild(x);
    }
    dashChips.appendChild(el);
  }
  dashClear.hidden = !f.persona && !f.tipo && isDefault;
}

// Comparación contra el mes anterior: sólo con preset de mes y si ese mes tuvo
// vales activos con las mismas dimensiones (evita porcentajes engañosos).
function renderDashTrend(records, total, presetMonth) {
  dashTrend.hidden = true;
  if (!presetMonth) return;
  const prev = lastNMonths(presetMonth, 2)[0];
  const prevMetrics = calculateDashboardMetrics(
    filterDashboardVales(records, { ...dashFilters, ...monthRange(prev.key) })
  );
  if (prevMetrics.count === 0) return;
  const anterior = prevMetrics.total;
  const cambio = anterior ? Math.round(((total - anterior) / anterior) * 100) : 0;
  const direccion = cambio > 0 ? "up" : cambio < 0 ? "down" : "flat";
  const flecha = cambio > 0 ? "↑" : cambio < 0 ? "↓" : "→";
  dashTrend.className = `stat-trend stat-trend--${direccion}`;
  dashTrend.textContent = `${flecha} ${Math.abs(cambio)}% vs ${prev.label}`;
  dashTrend.hidden = false;
}

function renderDashTop(ranking, colors) {
  dashTopEmpty.hidden = ranking.length > 0;
  dashVerTodos.hidden = ranking.length <= TOP_VISIBLE;
  dashVerTodos.textContent = dashExpanded ? "Ver menos" : `Ver todos (${ranking.length})`;
  const top1 = ranking.length ? ranking[0].total : 0;
  const visibles = dashExpanded ? ranking : ranking.slice(0, TOP_VISIBLE);
  // El seleccionado siempre queda visible aunque esté fuera del top 5.
  if (dashDetail && !visibles.some((r) => r.name === dashDetail)) {
    const sel = ranking.find((r) => r.name === dashDetail);
    if (sel) visibles.push(sel);
  }

  dashTop.innerHTML = "";
  for (const r of visibles) {
    const rank = ranking.indexOf(r) + 1;
    const pct = top1 ? Math.max(2, Math.round((r.total / top1) * 100)) : 0;
    const color = colors.get(r.name);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "lb-row" + (r.name === dashDetail ? " lb-row--selected" : "");
    row.dataset.name = r.name;
    row.setAttribute("aria-pressed", String(r.name === dashDetail));
    row.innerHTML =
      `<span class="lb-rank">${rank}</span>` +
      `<span class="lb-dot" style="background:${color}"></span>` +
      `<span class="lb-name">${escapeHtml(r.name)}</span>` +
      `<span class="lb-bar"><span class="lb-bar-fill" style="width:${pct}%;background:${color}"></span></span>` +
      `<span class="lb-amount">${money(r.total)} <span class="muted">(${r.count})</span></span>`;
    dashTop.appendChild(row);
  }
}

function renderDashDetail(filtered) {
  const open = Boolean(dashDetail);
  dashDetailEl.hidden = !open;
  dashSplit.classList.toggle("dash-split--detail", open);
  if (!open) return;
  const rows = requesterDetailRows(filtered, dashDetail);
  dashCrumbName.textContent = dashDetail;
  dashDetailName.textContent = dashDetail;
  const total = rows.reduce((s, r) => s + (Number(r.monto) || 0), 0);
  // El tipo es constante por solicitante: va en el resumen, no como columna.
  const tipos = [...new Set(rows.map((r) => r.categoria).filter(Boolean))].join(" / ");
  dashDetailSummary.textContent = rows.length
    ? [`${rows.length} ${rows.length === 1 ? "vale activo" : "vales activos"}`, money(total), tipos, periodLabel(dashFilters)]
        .filter(Boolean).join(" · ")
    : periodLabel(dashFilters);
  // Formato derivado (con folio = físico Combusa; sin folio = digital).
  const fisicos = rows.filter((r) => r.folio).length;
  const digitales = rows.length - fisicos;
  dashDetailFormat.hidden = rows.length === 0;
  dashDetailFormat.textContent = !digitales ? "Formato: Físico"
    : !fisicos ? "Formato: Digital"
    : `Formato: ${fisicos} ${fisicos === 1 ? "físico" : "físicos"} · ${digitales} ${digitales === 1 ? "digital" : "digitales"}`;
  dashDetailEmpty.hidden = rows.length > 0;
  dashDetailBody.closest("table").hidden = rows.length === 0;
  // Área y Unidad no se guardan en los vales: la tabla muestra sólo campos reales.
  dashDetailBody.innerHTML = rows
    .map((r) => {
      const fecha = r.date
        ? r.date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
        : "—";
      return (
        `<tr><td>${escapeHtml(fecha)}</td><td class="dash-code">${r.folio ? escapeHtml(r.folio) : "—"}</td>` +
        `<td class="num">${money(r.monto)}</td></tr>`
      );
    })
    .join("");
}

function renderDashChart(records, periodRanking, colors) {
  const f = dashFilters;
  // Mismas dimensiones (persona/tipo); el periodo sólo define la ventana de meses.
  const dimensionFiltered = filterDashboardVales(records, f, { ignorePeriod: true });
  const months = chartMonths(f.dateFrom, f.dateTo);
  const series = aggregateMonthlySeries(dimensionFiltered, months);
  // TODOS los solicitantes con importe en la ventana, sin agrupar en "Otros".
  const inWindow = new Set(series.flatMap((m) => [...m.bySegment.keys()]));
  const windowRanking = aggregateTopRequesters(
    filterDashboardVales(dimensionFiltered, { dateFrom: monthRange(months[0]).dateFrom, dateTo: monthRange(months.at(-1)).dateTo })
  );
  const segNames = orderChartRequesters(periodRanking, windowRanking).filter((n) => inWindow.has(n));
  const hasData = series.some((m) => m.total > 0);

  dashChart?.destroy();
  dashChart = null;
  dashChartEmpty.hidden = hasData;
  dashChartWrap.hidden = !hasData;
  dashChartHint.hidden = !hasData;
  dashLegend.innerHTML = "";
  if (!hasData) return;
  if (typeof window.Chart !== "function") {
    dashChartWrap.hidden = true;
    dashChartHint.hidden = true;
    dashChartEmpty.textContent = "No se pudo cargar la librería de gráficas.";
    dashChartEmpty.hidden = false;
    return;
  }
  dashChartEmpty.textContent = "Sin resultados con estos filtros";

  const labels = months.map((m) => {
    const [y, mm] = m.split("-").map(Number);
    return new Date(y, mm - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
  });
  const datasets = segNames.map((name) => {
    return {
      label: name,
      data: series.map((m) => m.bySegment.get(name) || 0),
      backgroundColor: colors.get(name),
      // Separador del color de la tarjeta entre segmentos apilados.
      borderColor: "#1a1f27",
      borderWidth: { top: 1.5 },
      borderSkipped: false,
      maxBarThickness: 84,
      categoryPercentage: 0.78,
      barPercentage: 0.9,
      stack: "total",
    };
  });

  const muted = "#97a1b0";
  const text = "#e7ecf3";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  dashChart = new window.Chart(dashChartCanvas, {
    type: "bar",
    data: { labels, datasets },
    plugins: [{
      // Total encima de cada columna.
      id: "monthTotals",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        ctx.save();
        // Columnas angostas (móvil): importe compacto y letra menor para que no se encimen.
        const slot = chart.chartArea.width / series.length;
        ctx.font = `700 ${slot < 64 ? 10.5 : 12}px system-ui, sans-serif`;
        const label = (n) => (slot < 64 ? "$" + (n >= 1000 ? Math.round(n / 100) / 10 + "k" : n) : money(n));
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        series.forEach((m, i) => {
          if (!m.total) return;
          let top = Infinity, x = 0;
          chart.data.datasets.forEach((_, d) => {
            const meta = chart.getDatasetMeta(d);
            if (meta.hidden || !chart.data.datasets[d].data[i]) return;
            const bar = meta.data[i];
            x = bar.x;
            top = Math.min(top, bar.y);
          });
          if (top === Infinity) return;
          ctx.fillStyle = text;
          ctx.fillText(label(m.total), x, top - 6);
        });
        ctx.restore();
      },
    }],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduced ? false : { duration: 300 },
      layout: { padding: { top: 26 } },
      interaction: { mode: "point", intersect: true }, // sólo el segmento bajo el puntero
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#10151e", titleColor: text, bodyColor: text,
          borderColor: "#46546a", borderWidth: 1, padding: 10,
          filter: (item) => item.parsed.y > 0,
          callbacks: {
            title: (items) => (items.length ? `${labels[items[0].dataIndex]} · total ${money(series[items[0].dataIndex].total)}` : ""),
            label: (ctx) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: muted } },
        y: {
          stacked: true, beginAtZero: true, grace: "8%",
          border: { display: false }, grid: { color: "rgba(151,161,176,0.12)" },
          ticks: { color: muted, maxTicksLimit: 5, callback: (v) => money(v) },
        },
      },
      onHover: (e, els) => {
        e.native.target.style.cursor = els.length || chartMonthAt(e) != null ? "pointer" : "default";
      },
      onClick: (e, els) => {
        // Segmento → mes + detalle del solicitante. Columna vacía/eje → sólo el mes.
        const seg = els[0];
        const i = seg ? seg.index : chartMonthAt(e);
        if (i == null) return;
        const name = seg ? segNames[seg.datasetIndex] : null;
        dashFilters = { ...dashFilters, ...monthRange(months[i]) };
        dashExpanded = false;
        // Diferido: el render destruye esta gráfica y no debe hacerlo dentro de su propio evento.
        setTimeout(() => (name ? openDashDetail(name) : renderDashboard()));
      },
    },
  });

  // Leyenda propia (HTML): todos los solicitantes, mismo orden y colores que los segmentos.
  for (const name of segNames) {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML =
      `<span class="legend-dot" style="background:${colors.get(name)}"></span>` +
      escapeHtml(name);
    dashLegend.appendChild(item);
  }
}

// Índice del mes bajo el puntero (clic en la columna vacía o en la etiqueta).
function chartMonthAt(e) {
  const x = dashChart?.scales?.x;
  if (!x || e.x < x.left || e.x > x.right) return null;
  const i = x.getValueForPixel(e.x);
  return Number.isInteger(i) && i >= 0 && i < x.ticks.length ? i : null;
}

// ===========================================================================
//  Admin (histórico por persona + exportar Excel)
// ===========================================================================
btnExcel.addEventListener("click", exportExcel);

function adminRows() {
  // Resumen histórico por persona, sin contar vales anulados.
  const porPersona = groupSum(activos(allVales), (v) => v.nombre);
  return [...porPersona.entries()]
    .map(([nombre, agg]) => ({ nombre, count: agg.count, total: agg.total }))
    .sort((a, b) => b.total - a.total);
}

function renderAdmin() {
  // --- Resumen por persona (sin anulados) ---
  const rows = adminRows();
  adminBody.innerHTML = "";
  adminEmpty.hidden = rows.length > 0;
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td data-label="Nombre">${escapeHtml(r.nombre)}</td>` +
      `<td class="num" data-label="Vales">${r.count}</td>` +
      `<td class="num" data-label="Total">${money(r.total)}</td>`;
    adminBody.appendChild(tr);
  }

  // --- Todos los vales (incluye anulados, con tachado) ---
  adminValesBody.innerHTML = "";
  adminValesEmpty.hidden = allVales.length > 0;
  for (const v of allVales) {
    const anulado = !!v.anulado;
    const tr = document.createElement("tr");
    tr.className = anulado ? "row-anulada" : "row-" + catSlug(v.categoria);
    tr.innerHTML = `
      <td>${escapeHtml(v.nombre)}</td>
      <td class="col-categoria"><span class="badge badge--${catSlug(v.categoria)}">${escapeHtml(
      v.categoria
    )}</span></td>
      <td class="num">$${Number(v.monto).toLocaleString("es-MX")}</td>
      <td>${formatFechaVale(v)}</td>
      <td class="col-registrado">${escapeHtml(v.registradoPor || "")}</td>
      <td class="col-estado">${anulado ? '<span class="estado-anulado">Anulado</span>' : '<span class="estado-activo">Activo</span>'}</td>
    `;
    // Los vales anulados también se pueden VER (auditoría), pero el modal
    // queda en modo consulta; anular ya no aplica.
    tr.appendChild(celdaAcciones(v, { conAnular: !anulado }));
    adminValesBody.appendChild(tr);
  }
}

/* ===========================================================================
   Exportación a Excel (.xlsx)
   ===========================================================================
   La implementación (hojas, estilos, carga diferida de ExcelJS) vive en
   js/excel-export.js. Aquí sólo se normalizan los vales y se maneja el botón. */

/* Vales tal y como los consume el módulo de Excel. La fecha se resuelve aquí
   porque valeDate() depende de Timestamp de Firestore; así el módulo queda
   libre de Firebase y se puede probar desde Node.
   A propósito NO se copian qrCode ni batchId: el QR es una credencial
   operativa del vale y no tiene ningún uso analítico en el reporte. */
function valesParaExcel() {
  return allVales.map((v) => ({
    nombre: v.nombre,
    categoria: v.categoria,
    monto: Number(v.monto) || 0,
    fecha: valeDate(v),
    registradoPor: v.registradoPor || "",
    folio: v.folio || null,
    anulado: !!v.anulado,
    notas: v.notas || "",
  }));
}

async function exportExcel() {
  const etiqueta = btnExcel.textContent;
  btnExcel.disabled = true;
  btnExcel.textContent = "Generando…";
  try {
    // El módulo de Excel se importa AQUÍ, no arriba: son ~44 KB (más ExcelJS,
    // que él mismo descarga bajo demanda) que no tienen por qué pesar en cada
    // arranque de la app en el celular. El navegador lo cachea tras el primer
    // clic, y si la descarga falla el catch de abajo ya avisa.
    const { generarLibroExcel } = await import("./excel-export.js");
    const blob = await generarLibroExcel(valesParaExcel());
    downloadBlob(blob, `vales-spectro-${todayInput()}.xlsx`);
    showToast("✅ Excel generado");
  } catch (err) {
    console.error("Error al exportar a Excel:", err);
    showToast("⚠️ No se pudo generar el Excel: " + err.message);
  } finally {
    btnExcel.disabled = false;
    btnExcel.textContent = etiqueta;
  }
}

// ===========================================================================
//  Utilidades
// ===========================================================================
function toDate(fecha) {
  if (!fecha) return null;
  return fecha instanceof Timestamp ? fecha.toDate() : new Date(fecha);
}

// Sólo los vales NO anulados.
function activos(vales) {
  return vales.filter((v) => !v.anulado);
}

// Fecha del vale para reportes/filtros: fechaVale (con respaldo a datos viejos).
function valeDate(v) {
  return toDate(v.fechaVale) || toDate(v.fecha) || toDate(v.createdAt);
}

// Muestra la fecha del vale + (en gris) la hora de registro del sistema.
function formatFechaVale(v) {
  const d = valeDate(v);
  if (!d) return "—";
  const f = d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const created = toDate(v.createdAt) || toDate(v.fecha);
  const reg = created
    ? `<span class="reg-time">reg. ${created.toLocaleString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}</span>`
    : "";
  return `${f}${reg ? "<br>" + reg : ""}`;
}

// Convierte "YYYY-MM-DD" a Date en medianoche local.
function parseDateInput(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Clave "YYYY-MM" de una fecha (usando hora local).
function monthKey(fecha) {
  const d = toDate(fecha);
  if (!d) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function currentMonthKey() {
  return monthKey(new Date());
}

// Genera los últimos N meses terminando en `endKey` ("YYYY-MM"): [{key,label}].
function lastNMonths(endKey, n) {
  const [y, m] = endKey.split("-").map(Number);
  const out = [];
  const base = new Date(y, m - 1, 1);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push({
      key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"),
      label: d.toLocaleDateString("es-MX", { month: "short" }),
    });
  }
  return out;
}

function sum(arr) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}
// Agrupa por clave -> {count, total}
function groupSum(vales, keyFn) {
  const map = new Map();
  for (const v of vales) {
    const k = keyFn(v);
    if (k == null) continue;
    const agg = map.get(k) || { count: 0, total: 0 };
    agg.count += 1;
    agg.total += Number(v.monto) || 0;
    map.set(k, agg);
  }
  return map;
}

// Sufijo de clase CSS por categoría (badge--*, row-*).
function catSlug(categoria) {
  if (categoria === "Familia") return "familia";
  if (categoria === "Socio") return "socio";
  return "empleado";
}
