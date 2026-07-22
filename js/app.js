// ============================================================================
//  App de registro de vales de gasolina  —  lógica principal
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
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

let unsubscribe = null;
let allVales = [];

// --- Puerta de PIN (sólo cosmética, ver advertencia en config.js) ----------
function unlock() {
  pinScreen.hidden = true;
  appScreen.hidden = false;
  sessionStorage.setItem("vales_unlocked", "1");
  startListening();
}

pinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (pinInput.value === ACCESS_PIN) {
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
fillSelect($("#monto"), MONTOS.map(String));
fillSelect(filtroCategoria, CATEGORIAS, true);

// --- Escuchar en tiempo real -----------------------------------------------
function startListening() {
  if (unsubscribe) return;
  const q = query(valesRef, orderBy("fecha", "desc"));
  unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      allVales = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    (err) => {
      console.error("Error al leer vales:", err);
      tbody.innerHTML = `<tr><td colspan="6" class="error-row">Error al cargar los datos: ${escapeHtml(
        err.message
      )}</td></tr>`;
    }
  );
}

// --- Guardar un nuevo vale --------------------------------------------------
valeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const data = {
    nombre: $("#nombre").value.trim(),
    categoria: $("#categoria").value,
    monto: Number($("#monto").value),
    registradoPor: $("#registradoPor").value.trim(),
    notas: $("#notas").value.trim(),
    fecha: serverTimestamp(),
  };

  // Validación del lado del cliente (reflejo de firestore.rules)
  const problema = validar(data);
  if (problema) {
    formError.textContent = problema;
    formError.hidden = false;
    return;
  }

  // No enviar 'notas' si está vacío (coincide con campo opcional en las reglas)
  if (!data.notas) delete data.notas;

  const btn = valeForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Guardando…";
  try {
    await addDoc(valesRef, data);
    valeForm.reset();
    $("#nombre").focus();
  } catch (err) {
    console.error("Error al guardar:", err);
    formError.textContent = "No se pudo guardar: " + err.message;
    formError.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Registrar vale";
  }
});

function validar(d) {
  if (!d.nombre || d.nombre.length > 100) return "El nombre es obligatorio (máx. 100 caracteres).";
  if (!CATEGORIAS.includes(d.categoria)) return "Selecciona una categoría válida.";
  if (!MONTOS.includes(d.monto)) return "Selecciona un monto válido.";
  if (!d.registradoPor || d.registradoPor.length > 100) return "Indica quién registra el vale (máx. 100).";
  if (d.notas && d.notas.length > 500) return "Las notas no pueden superar 500 caracteres.";
  return null;
}

// --- Eliminar un vale -------------------------------------------------------
async function eliminarVale(id, nombre) {
  if (!confirm(`¿Eliminar el vale de "${nombre}"?`)) return;
  try {
    await deleteDoc(doc(db, COLLECTION, id));
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
