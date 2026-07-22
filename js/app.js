// ============================================================================
//  App de registro de vales de gasolina  —  lógica principal
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  firebaseConfig,
  ACCESS_PIN,
  COLLECTION,
  CATEGORIAS,
  MONTOS,
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
const appError = $("#app-error");
const loadingEl = $("#loading");
const refreshBtn = $("#btn-actualizar");

// Carrito de montos (multi-vale)
const denomsEl = $("#denoms");
const carritoResumen = $("#carrito-resumen");
const carritoLista = $("#carrito-lista");
const carritoTotalEl = $("#carrito-total");
const carritoCountEl = $("#carrito-count");
const btnLimpiar = $("#btn-limpiar");

let allVales = [];
const carrito = new Map(); // monto -> cantidad

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
fillSelect($("#categoria"), CATEGORIAS);
fillSelect(filtroCategoria, CATEGORIAS, true);

// --- Carrito de montos: botones de denominación ----------------------------
const denomButtons = [];
for (const monto of MONTOS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "denom-btn";
  btn.dataset.monto = String(monto);
  btn.innerHTML =
    `<span class="denom-amount">$${monto.toLocaleString("es-MX")}</span>` +
    `<span class="denom-badge"></span>`;
  btn.addEventListener("click", () => addToCart(monto));
  denomsEl.appendChild(btn);
  denomButtons.push(btn);
}

if (btnLimpiar) btnLimpiar.addEventListener("click", clearCart);

function addToCart(monto) {
  carrito.set(monto, (carrito.get(monto) || 0) + 1);
  renderCart();
}

function clearCart() {
  carrito.clear();
  renderCart();
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
  // Badges en cada botón
  for (const btn of denomButtons) {
    const monto = Number(btn.dataset.monto);
    const cantidad = carrito.get(monto) || 0;
    const badge = btn.querySelector(".denom-badge");
    badge.textContent = cantidad > 0 ? "×" + cantidad : "";
    btn.classList.toggle("selected", cantidad > 0);
  }

  // Resumen
  carritoLista.innerHTML = "";
  let total = 0;
  let count = 0;
  const montosOrdenados = [...carrito.keys()].sort((a, b) => a - b);
  for (const monto of montosOrdenados) {
    const cantidad = carrito.get(monto);
    total += monto * cantidad;
    count += cantidad;
    const li = document.createElement("li");
    li.textContent = `$${monto.toLocaleString("es-MX")} ×${cantidad}`;
    carritoLista.appendChild(li);
  }

  carritoTotalEl.textContent = "$" + total.toLocaleString("es-MX");
  carritoCountEl.textContent =
    count > 0 ? `(${count} ${count === 1 ? "vale" : "vales"})` : "";
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
    const q = query(valesRef, orderBy("fecha", "desc"));
    const snapshot = await withTimeout(getDocs(q), 15000);
    allVales = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadingEl.hidden = true;
    clearAppError();
    render();
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

// --- Guardar vales (uno por cada toque, como documentos separados) ----------
valeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const base = {
    nombre: $("#nombre").value.trim(),
    categoria: $("#categoria").value,
    registradoPor: $("#registradoPor").value.trim(),
    notas: $("#notas").value.trim(),
  };

  // Validación del lado del cliente (reflejo de firestore.rules)
  const problema = validarBase(base);
  if (problema) {
    formError.textContent = problema;
    formError.hidden = false;
    return;
  }

  const items = cartItems(); // p. ej. [200, 200, 300, 500]
  if (items.length === 0) {
    formError.textContent = "Agrega al menos un vale tocando una denominación.";
    formError.hidden = false;
    return;
  }

  const btn = valeForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    // Un documento por vale; misma fecha/nombre/categoria/registradoPor para todos.
    const batch = writeBatch(db);
    for (const monto of items) {
      const ref = doc(valesRef); // ID automático
      const docData = {
        nombre: base.nombre,
        categoria: base.categoria,
        monto,
        registradoPor: base.registradoPor,
        fecha: serverTimestamp(),
      };
      if (base.notas) docData.notas = base.notas; // opcional
      batch.set(ref, docData);
    }
    await batch.commit();

    valeForm.reset();
    clearCart();
    $("#nombre").focus();
    await loadVales(); // recargar la lista tras guardar
  } catch (err) {
    console.error("Error al guardar:", err);
    formError.textContent = "No se pudieron guardar los vales: " + err.message;
    formError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Registrar vales";
  }
});

function validarBase(d) {
  if (!d.nombre || d.nombre.length > 100) return "El nombre es obligatorio (máx. 100 caracteres).";
  if (!CATEGORIAS.includes(d.categoria)) return "Selecciona una categoría válida.";
  if (!d.registradoPor || d.registradoPor.length > 100) return "Indica quién registra el vale (máx. 100).";
  if (d.notas && d.notas.length > 500) return "Las notas no pueden superar 500 caracteres.";
  return null;
}

// --- Eliminar un vale -------------------------------------------------------
async function eliminarVale(id, nombre) {
  if (!confirm(`¿Eliminar el vale de "${nombre}"?`)) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
    await loadVales(); // recargar la lista tras eliminar
  } catch (err) {
    console.error("Error al eliminar:", err);
    alert("No se pudo eliminar: " + err.message);
  }
}

// --- Filtro -----------------------------------------------------------------
filtroCategoria.addEventListener("change", render);

// --- Render -----------------------------------------------------------------
function render() {
  const filtro = filtroCategoria.value;
  const vales = filtro ? allVales.filter((v) => v.categoria === filtro) : allVales;

  tbody.innerHTML = "";
  let total = 0;

  for (const v of vales) {
    total += Number(v.monto) || 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(v.nombre)}</td>
      <td><span class="badge badge--${v.categoria === "Familia" ? "familia" : "empleado"}">${escapeHtml(
      v.categoria
    )}</span></td>
      <td class="num">$${Number(v.monto).toLocaleString("es-MX")}</td>
      <td>${formatFecha(v.fecha)}</td>
      <td>${escapeHtml(v.registradoPor || "")}</td>
      <td class="notas">${escapeHtml(v.notas || "")}</td>
    `;
    const acciones = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "btn-eliminar";
    btn.title = "Eliminar";
    btn.textContent = "✕";
    btn.addEventListener("click", () => eliminarVale(v.id, v.nombre));
    acciones.appendChild(btn);
    tr.appendChild(acciones);
    tbody.appendChild(tr);
  }

  emptyState.hidden = vales.length > 0;
  totalEl.textContent = "$" + total.toLocaleString("es-MX");
  countEl.textContent = String(vales.length);
}

// --- Utilidades -------------------------------------------------------------
function formatFecha(fecha) {
  if (!fecha) return "—"; // aún no confirmado por el servidor
  const date = fecha instanceof Timestamp ? fecha.toDate() : new Date(fecha);
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
