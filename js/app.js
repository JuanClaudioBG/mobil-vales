// ============================================================================
//  App de registro de vales de gasolina  —  lógica principal
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  updateDoc,
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

// Autocompletado (sólo "Registrado por")
const registradoPorInput = $("#registradoPor");
const registradoPorSug = $("#registradoPor-sugerencias");

// Navegación por pestañas
const tabButtons = document.querySelectorAll(".tab");
const views = {
  registro: $("#view-registro"),
  dashboard: $("#view-dashboard"),
  admin: $("#view-admin"),
};

// Dashboard
const dashMes = $("#dash-mes");
const dashCount = $("#dash-count");
const dashTotal = $("#dash-total");
const dashEmp = $("#dash-emp");
const dashFam = $("#dash-fam");
const dashTop = $("#dash-top");
const dashTopEmpty = $("#dash-top-empty");
const dashChart = $("#dash-chart");
const dashLegend = $("#dash-legend");
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

// --- Puerta de PIN (sólo cosmética, ver advertencia en config.js) ----------
function unlock() {
  pinScreen.hidden = true;
  appScreen.hidden = false;
  sessionStorage.setItem("vales_unlocked", "1");
  loadVales(); // carga inicial (una sola vez); loadVales gestiona sus errores
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
    catAuto.className = "cat-auto badge badge--" + (p.categoria === "Familia" ? "familia" : "empleado");
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
valeForm.addEventListener("submit", (e) => {
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

  pendingSave = { base, items };
  openConfirm(base, items);
});

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

  try {
    const batch = writeBatch(db);
    for (const monto of items) {
      const ref = doc(valesRef); // ID automático
      const docData = {
        nombre: base.nombre,
        categoria: base.categoria,
        monto,
        registradoPor: base.registradoPor,
        fechaVale,
        createdAt: serverTimestamp(),
        anulado: false,
        batchId,
      };
      if (base.notas) docData.notas = base.notas; // opcional
      batch.set(ref, docData);
    }
    await batch.commit();

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
async function anularVale(id, nombre) {
  const ok = await requestAdminPin(`Anular el vale de "${nombre}". Dejará de contar en reportes.`);
  if (!ok) return;
  try {
    await updateDoc(doc(db, COLLECTION, id), {
      anulado: true,
      anuladoEn: serverTimestamp(),
    });
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
    tr.className = v.categoria === "Familia" ? "row-familia" : "row-empleado";
    tr.innerHTML = `
      <td>${escapeHtml(v.nombre)}</td>
      <td class="col-categoria"><span class="badge badge--${v.categoria === "Familia" ? "familia" : "empleado"}">${escapeHtml(
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
    btn.addEventListener("click", () => anularVale(v.id, v.nombre));
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
  renderDashboard();
});
dashVerTodos.addEventListener("click", () => {
  dashExpanded = !dashExpanded;
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

  const emp = delMes.filter((v) => v.categoria === "Empleado");
  const fam = delMes.filter((v) => v.categoria === "Familia");
  dashEmp.textContent = `${emp.length} · ${money(sum(emp.map((v) => v.monto)))}`;
  dashFam.textContent = `${fam.length} · ${money(sum(fam.map((v) => v.monto)))}`;

  // Leaderboard del mes (ordenado por total desc)
  const ranking = [...groupSum(delMes, (v) => v.nombre).entries()].sort(
    (a, b) => b[1].total - a[1].total
  );
  renderLeaderboard(ranking);

  // Gráfica apilada por persona (últimos 6 meses terminando en `mes`)
  renderStackedChart(mes);
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
  dashLegend.innerHTML = "";
  for (const nombre of personas) {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML =
      `<span class="legend-dot" style="background:${personaColor(nombre)}"></span>` +
      escapeHtml(nombre);
    dashLegend.appendChild(item);
  }
}

function drawStackedBarChart(canvas, meses, matrix, personas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  // Tamaño lógico desde el contenedor (idempotente); si la vista está oculta,
  // clientWidth es 0 → respaldo 640; al abrir la pestaña se redibuja bien.
  const wrap = canvas.parentElement;
  const cssW = Math.max(300, Math.min(640, wrap.clientWidth || 640));
  const cssH = 260;
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
    tr.className = anulado
      ? "row-anulada"
      : v.categoria === "Familia"
      ? "row-familia"
      : "row-empleado";
    tr.innerHTML = `
      <td>${escapeHtml(v.nombre)}</td>
      <td class="col-categoria"><span class="badge badge--${v.categoria === "Familia" ? "familia" : "empleado"}">${escapeHtml(
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
      btn.addEventListener("click", () => anularVale(v.id, v.nombre));
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

// "YYYY-MM-DD" de hoy (para el input date).
function todayInput() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
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
function money(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX");
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
