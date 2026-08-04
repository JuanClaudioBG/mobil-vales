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
  PERSONA_COLORS,
  COLOR_DEFAULT,
} from "./config.js";
import { money, escapeHtml, todayInput } from "./utils.js";
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
const updateBanner = $("#update-banner");
const updateAppBtn = $("#btn-update-app");

// Formulario: persona / categoría automática / fecha del vale
const personaSelect = $("#persona");
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
const dashCount = $("#dash-count");
const dashTotal = $("#dash-total");
const dashTrend = $("#dash-trend");
const dashEmp = $("#dash-emp");
const dashFam = $("#dash-fam");
const dashSoc = $("#dash-soc");
const dashTop = $("#dash-top");
const dashTopEmpty = $("#dash-top-empty");
const dashChart = $("#dash-chart");
const dashLegend = $("#dash-legend");
const dashLegendToggle = $("#dash-legend-toggle");
const dashVerTodos = $("#dash-vertodos");

// Admin
const adminBody = $("#admin-body");
const adminEmpty = $("#admin-empty");
const btnCsv = $("#btn-csv");
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
let dashExpanded = false; // leaderboard: mostrar todos vs top 5
let legendExpanded = false; // leyenda de la gráfica: mostrar todos vs top 5

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

// --- Detección ligera de nuevas versiones desplegadas ----------------------
const VERSION_POLL_MS = 60_000;
// Al publicar, este valor debe coincidir con version.json. Una copia vieja de
// app.js conservará su versión anterior y detectará el JSON recién desplegado.
const CURRENT_APP_VERSION = "2026-08-04";
let knownAppVersion = CURRENT_APP_VERSION;
let availableAppVersion = null;

async function checkAppVersion() {
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

    if (version !== knownAppVersion) {
      availableAppVersion = version;
      updateBanner.hidden = false;
    }
  } catch (err) {
    // Un fallo de red no afecta el uso normal; el siguiente sondeo reintenta.
    console.warn("[version] No se pudo comprobar la versión:", err);
  }
}

function initVersionCheck() {
  checkAppVersion();
  window.setInterval(checkAppVersion, VERSION_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAppVersion();
  });
}

updateAppBtn.addEventListener("click", () => {
  // Cambiar la URL del documento fuerza una navegación nueva incluso en modo
  // PWA/home screen, sin depender del soporte obsoleto de reload(true).
  const reloadUrl = new URL(window.location.href);
  reloadUrl.searchParams.set("_app_version", availableAppVersion || String(Date.now()));
  window.location.replace(reloadUrl.toString());
});

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
for (const el of [fechaValeInput, filtroMes, dashMes]) {
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
  if (refreshBtn) refreshBtn.disabled = true;

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
    if (refreshBtn) refreshBtn.disabled = false;
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

// Botón de recarga manual.
if (refreshBtn) refreshBtn.addEventListener("click", loadVales);

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
    notas: $("#notas").value.trim(),
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
  const fechaTxt = parseDateInput(v.fechaStr).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

  // Oculta la confirmación "✅ Listo" al cambiar de vale.
  hideQrDone();

  // Identificador que se muestra al compartir: el folio real si lo hay.
  const idTxt = v.folio ? `Folio: ${formatFolio(v.folio)}` : `Código: ${v.qrCode}`;

  // Descargar: exporta el QR como PNG (fondo blanco, sin transparencia).
  qrDownload.onclick = () => {
    const blob = qrToPngBlob();
    if (!blob) return;
    downloadBlob(blob, qrFileName(v));
    showQrDone();
  };

  // Compartir: Web Share API con el archivo PNG; si no está disponible, descarga.
  qrShare.onclick = async () => {
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
    const acciones = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-anular";
    btn.title = "Anular";
    btn.textContent = "Anular";
    btn.addEventListener("click", () => anularVale(v));
    acciones.appendChild(btn);
    tr.appendChild(acciones);
    tbody.appendChild(tr);
  }

  emptyState.hidden = vales.length > 0;
  totalEl.textContent = "$" + total.toLocaleString("es-MX");
  countEl.textContent = String(vales.length);
}

// ===========================================================================
//  Dashboard
// ===========================================================================
dashMes.addEventListener("change", () => {
  dashExpanded = false; // al cambiar de mes, colapsa el leaderboard
  legendExpanded = false;
  renderDashboard();
});
dashVerTodos.addEventListener("click", () => {
  dashExpanded = !dashExpanded;
  renderDashboard();
});
dashLegendToggle.addEventListener("click", () => {
  legendExpanded = !legendExpanded;
  renderDashboard();
});

function personaColor(nombre) {
  return PERSONA_COLORS[nombre] || COLOR_DEFAULT;
}

function renderDashboard() {
  const mes = dashMes.value || currentMonthKey();
  const delMes = activos(allVales).filter((v) => monthKey(valeDate(v)) === mes);

  const total = sum(delMes.map((v) => v.monto));
  dashCount.textContent = String(delMes.length);
  dashTotal.textContent = money(total);

  // Comparación contra el mes inmediato anterior. Si ese mes no tuvo vales,
  // se oculta para evitar porcentajes engañosos o divisiones entre cero.
  const mesAnterior = lastNMonths(mes, 2)[0];
  const delMesAnterior = activos(allVales).filter(
    (v) => monthKey(valeDate(v)) === mesAnterior.key
  );
  renderMonthTrend(total, delMesAnterior, mesAnterior.label);

  const emp = delMes.filter((v) => v.categoria === "Empleado");
  const fam = delMes.filter((v) => v.categoria === "Familia");
  const soc = delMes.filter((v) => v.categoria === "Socio");
  renderCategoryStat(dashEmp, emp);
  renderCategoryStat(dashFam, fam);
  renderCategoryStat(dashSoc, soc);

  // Leaderboard del mes (ordenado por total desc)
  const ranking = [...groupSum(delMes, (v) => v.nombre).entries()].sort(
    (a, b) => b[1].total - a[1].total
  );
  renderLeaderboard(ranking);

  // Gráfica apilada por persona (últimos 6 meses terminando en `mes`)
  renderStackedChart(mes);
}

function renderCategoryStat(valueEl, vales) {
  const total = sum(vales.map((v) => v.monto));
  valueEl.textContent = `${vales.length} · ${money(total)}`;
  valueEl.closest(".stat-card").hidden = vales.length === 0 && total === 0;
}

function renderMonthTrend(total, valesAnteriores, mesLabel) {
  if (valesAnteriores.length === 0) {
    dashTrend.hidden = true;
    return;
  }

  const anterior = sum(valesAnteriores.map((v) => v.monto));
  const cambio = anterior ? Math.round(((total - anterior) / anterior) * 100) : 0;
  const direccion = cambio > 0 ? "up" : cambio < 0 ? "down" : "flat";
  const flecha = cambio > 0 ? "↑" : cambio < 0 ? "↓" : "→";
  dashTrend.className = `stat-trend stat-trend--${direccion}`;
  dashTrend.textContent = `${flecha} ${Math.abs(cambio)}% vs ${mesLabel}`;
  dashTrend.hidden = false;
}

function renderLeaderboard(ranking) {
  dashTopEmpty.hidden = ranking.length > 0;
  dashVerTodos.hidden = ranking.length <= 5;
  dashVerTodos.textContent = dashExpanded ? "Ver menos" : "Ver todos";

  const top1 = ranking.length ? ranking[0][1].total : 0;
  const visibles = dashExpanded ? ranking : ranking.slice(0, 5);

  dashTop.innerHTML = "";
  visibles.forEach(([nombre, agg], i) => {
    const pct = top1 ? Math.round((agg.total / top1) * 100) : 0;
    const color = personaColor(nombre);
    const row = document.createElement("div");
    row.className = "lb-row" + (i === 0 ? " lb-row--first" : "");
    row.innerHTML =
      `<span class="lb-rank">${i + 1}</span>` +
      `<span class="lb-dot" style="background:${color}"></span>` +
      `<span class="lb-name">${escapeHtml(nombre)}</span>` +
      `<span class="lb-bar"><span class="lb-bar-fill" style="width:${pct}%;background:${color}"></span></span>` +
      `<span class="lb-amount">${money(agg.total)} <span class="muted">(${agg.count})</span></span>`;
    dashTop.appendChild(row);
  });
}

function renderStackedChart(mes) {
  const meses = lastNMonths(mes, 6);
  const keySet = new Set(meses.map((m) => m.key));

  // Vales dentro de la ventana de 6 meses.
  const enVentana = activos(allVales).filter((v) => keySet.has(monthKey(valeDate(v))));

  // Matriz mes -> (persona -> total) y totales por persona en la ventana.
  const matrix = new Map(meses.map((m) => [m.key, new Map()]));
  const totPersona = new Map();
  for (const v of enVentana) {
    const mk = monthKey(valeDate(v));
    const monto = Number(v.monto) || 0;
    const cell = matrix.get(mk);
    cell.set(v.nombre, (cell.get(v.nombre) || 0) + monto);
    totPersona.set(v.nombre, (totPersona.get(v.nombre) || 0) + monto);
  }
  // Orden de apilado y leyenda: por total desc (segmento más grande abajo).
  const personas = [...totPersona.keys()].sort(
    (a, b) => totPersona.get(b) - totPersona.get(a)
  );

  drawStackedBarChart(dashChart, meses, matrix, personas);
  renderLegend(personas);
}

function renderLegend(personas) {
  const visibles = legendExpanded ? personas : personas.slice(0, 5);
  dashLegend.innerHTML = "";
  for (const nombre of visibles) {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML =
      `<span class="legend-dot" style="background:${personaColor(nombre)}"></span>` +
      escapeHtml(nombre);
    dashLegend.appendChild(item);
  }

  dashLegendToggle.hidden = personas.length <= 5;
  dashLegendToggle.textContent = legendExpanded
    ? "Ver menos"
    : `Ver todos (${personas.length})`;
  dashLegendToggle.setAttribute("aria-expanded", String(legendExpanded));
}

function drawStackedBarChart(canvas, meses, matrix, personas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  // Tamaño lógico desde el contenedor (idempotente); si la vista está oculta,
  // clientWidth es 0 → respaldo 640; al abrir la pestaña se redibuja bien.
  const wrap = canvas.parentElement;
  const cssW = Math.max(300, Math.min(640, wrap.clientWidth || 640));
  const cssH = 338;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 56, padR = 16, padT = 20, padB = 34;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const mesesKeys = meses.map((m) => m.key);
  const totalesMes = mesesKeys.map((k) => {
    let s = 0;
    for (const t of matrix.get(k).values()) s += t;
    return s;
  });
  const max = Math.max(1, ...totalesMes);

  const styles = getComputedStyle(document.documentElement);
  const muted = styles.getPropertyValue("--muted").trim() || "#97a1b0";
  const border = styles.getPropertyValue("--border").trim() || "#303845";

  // Eje base
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + h);
  ctx.lineTo(padL + w, padT + h);
  ctx.stroke();

  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";

  const n = meses.length;
  const slot = w / n;
  const barW = slot * 0.55;
  const usableH = h - 10;

  for (let i = 0; i < n; i++) {
    const cell = matrix.get(mesesKeys[i]);
    const x = padL + slot * i + (slot - barW) / 2;
    let yTop = padT + h; // apila desde la base hacia arriba
    for (const nombre of personas) {
      const val = cell.get(nombre) || 0;
      if (val <= 0) continue;
      const segH = (val / max) * usableH;
      yTop -= segH;
      ctx.fillStyle = personaColor(nombre);
      ctx.fillRect(x, yTop, barW, segH);
    }
    // Total encima de la barra
    if (totalesMes[i] > 0) {
      ctx.fillStyle = muted;
      ctx.fillText(money(totalesMes[i]), x + barW / 2, yTop - 6);
    }
    // Etiqueta de mes
    ctx.fillStyle = muted;
    ctx.fillText(meses[i].label, x + barW / 2, padT + h + 18);
  }
}

// ===========================================================================
//  Admin (histórico por persona + exportar CSV)
// ===========================================================================
btnCsv.addEventListener("click", exportCsv);

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
    const acciones = document.createElement("td");
    if (!anulado) {
      const btn = document.createElement("button");
      btn.className = "btn-anular";
      btn.title = "Anular";
      btn.textContent = "Anular";
      btn.addEventListener("click", () => anularVale(v));
      acciones.appendChild(btn);
    }
    tr.appendChild(acciones);
    adminValesBody.appendChild(tr);
  }
}

function exportCsv() {
  const rows = adminRows();
  const lines = [["Nombre", "Vales", "Total"]];
  for (const r of rows) lines.push([r.nombre, String(r.count), String(r.total)]);
  const csv = lines
    .map((cols) => cols.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vales-por-persona-${currentMonthKey()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function csvCell(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
