// ============================================================================
//  CONFIGURACIÓN  —  Reemplaza los valores de marcador de posición
// ============================================================================
//
//  1) FIREBASE
//     Pega aquí la configuración real de tu proyecto de Firebase.
//     La obtienes en:  Consola de Firebase → Configuración del proyecto →
//     "Tus apps" → App web → SDK de Firebase → Config.
//     O por CLI:  npx -y firebase-tools@latest apps:sdkconfig web <APP_ID>
//
export const firebaseConfig = {
  apiKey: "AIzaSyCK5In_kXB2GQ8HrPu0c76d7CO7IkkBH9M",
  authDomain: "mobil-vales.firebaseapp.com",
  projectId: "mobil-vales",
  storageBucket: "mobil-vales.firebasestorage.app",
  messagingSenderId: "344444918306",
  appId: "1:344444918306:web:3e24c858a85054231d087b",
};

// ============================================================================
//  2) PIN DE ACCESO  (control de acceso del lado del cliente)
//
//  ⚠️  ADVERTENCIA DE SEGURIDAD
//  Este PIN sólo oculta la interfaz. NO protege los datos: cualquiera que abra
//  las herramientas de desarrollador del navegador puede leer este archivo y
//  también puede acceder a Firestore directamente. Úsalo únicamente porque el
//  equipo es de confianza y los datos no son sensibles.
// ============================================================================
export const ACCESS_PIN = "2026";

// PIN de administrador para acciones sensibles (p. ej. Anular).
// ⚠️ Mismo modelo de seguridad que ACCESS_PIN: es sólo del lado del cliente.
export const ADMIN_PIN = "7001";

// Nombre de la colección en Firestore.
export const COLLECTION = "vales";

// Colección del inventario de vales físicos de Combusa (uno por folio).
export const INVENTARIO_COLLECTION = "inventario";

// Opciones permitidas (deben coincidir con firestore.rules).
export const CATEGORIAS = ["Empleado", "Familia", "Socio"];
export const MONTOS = [200, 300, 500, 1000, 4000];

// Denominaciones que surte Combusa en el PDF de vales físicos. Sólo estas se
// toman del inventario; el resto (p. ej. $4,000) sigue con el QR generado por
// la app.
export const INVENTARIO_MONTOS = [200, 300, 500, 1000];

// Estados posibles de un vale del inventario (deben coincidir con las reglas).
export const INVENTARIO_STATUS = [
  "disponible",
  "revision_requerida",
  "asignado",
  "canjeado",
  "vencido",
];

// Orden de los departamentos en el selector de persona.
export const DEPARTAMENTOS = [
  "Socios",
  "Familia",
  "Ventas",
  "Administración",
  "Operaciones",
  "Logística",
  "Soporte",
];

// Directorio fijo de personas. `categoria` se autocompleta a partir de aquí.
// `label` (opcional) es el texto a mostrar en el selector.
export const PERSONAS = [
  // Socios
  { nombre: "Eugenio Galán", categoria: "Socio", depto: "Socios" },
  // Familia
  { nombre: "Juan Jr", categoria: "Familia", depto: "Familia" },
  { nombre: "Andrea", categoria: "Familia", depto: "Familia" },
  { nombre: "Lorena", categoria: "Familia", depto: "Familia" },
  { nombre: "Juan Claudio Belloc", categoria: "Familia", depto: "Familia", label: "Juan Claudio Belloc (Jefe · Socio · Familia)" },
  // Empleados — Ventas
  { nombre: "Erick", categoria: "Empleado", depto: "Ventas" },
  { nombre: "Marcelino", categoria: "Empleado", depto: "Ventas" },
  { nombre: "Ventas (General)", categoria: "Empleado", depto: "Ventas" },
  // Empleados — Administración
  { nombre: "Karen", categoria: "Empleado", depto: "Administración" },
  { nombre: "Aracely", categoria: "Empleado", depto: "Administración" },
  // Empleados — Operaciones
  { nombre: "Yankee", categoria: "Empleado", depto: "Operaciones" },
  { nombre: "Juanjo", categoria: "Empleado", depto: "Operaciones" },
  { nombre: "Héctor", categoria: "Empleado", depto: "Operaciones" },
  { nombre: "Operaciones (General)", categoria: "Empleado", depto: "Operaciones" },
  // Empleados — Logística
  { nombre: "Alex", categoria: "Empleado", depto: "Logística" },
  { nombre: "Juan Ramon", categoria: "Empleado", depto: "Logística" },
  { nombre: "Quiroz", categoria: "Empleado", depto: "Logística" },
  // Empleados — Soporte
  { nombre: "Lucio", categoria: "Empleado", depto: "Soporte" },
  { nombre: "Emmanuel", categoria: "Empleado", depto: "Soporte" },
  { nombre: "Soporte (General)", categoria: "Empleado", depto: "Soporte" },
];

// Color por persona (gráfica del dashboard y leaderboard).
export const PERSONA_COLORS = {
  "Eugenio Galán": "#7c4dff",
  "Juan Jr": "#3aa0ff",
  "Andrea": "#22c98e",
  "Lorena": "#f5a623",
  "Juan Claudio Belloc": "#e6567a",
  "Erick": "#9b7bf0",
  "Marcelino": "#5bc8ff",
  "Karen": "#7fe0b0",
  "Aracely": "#ffd166",
  "Yankee": "#ff6b6b",
  "Juanjo": "#c9a8ff",
  "Héctor": "#4ecdc4",
  "Alex": "#ff9f43",
  "Juan Ramon": "#a8e6cf",
  "Quiroz": "#c0ca33",
  "Operaciones (General)": "#e31e24",
  "Ventas (General)": "#d946ef",
};
// Color de respaldo para nombres no listados (p. ej. datos antiguos).
export const COLOR_DEFAULT = "#8892a0";
