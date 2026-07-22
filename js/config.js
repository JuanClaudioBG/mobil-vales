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
export const ACCESS_PIN = "2025";

// Nombre de la colección en Firestore.
export const COLLECTION = "vales";

// Opciones permitidas (deben coincidir con firestore.rules).
export const CATEGORIAS = ["Empleado", "Familia"];
export const MONTOS = [200, 300, 500, 1000];

// Orden de los departamentos en el selector de persona.
export const DEPARTAMENTOS = [
  "Familia",
  "Ventas",
  "Administración",
  "Operaciones",
  "Logística",
];

// Directorio fijo de personas. `categoria` se autocompleta a partir de aquí.
// `label` (opcional) es el texto a mostrar en el selector.
export const PERSONAS = [
  // Familia
  { nombre: "Juan Jr", categoria: "Familia", depto: "Familia" },
  { nombre: "Andrea", categoria: "Familia", depto: "Familia" },
  { nombre: "Lorena", categoria: "Familia", depto: "Familia" },
  { nombre: "Juan C Mayor", categoria: "Familia", depto: "Familia", label: "Juan C Mayor (Jefe / Familia)" },
  // Empleados — Ventas
  { nombre: "Erick", categoria: "Empleado", depto: "Ventas" },
  { nombre: "Marcelino", categoria: "Empleado", depto: "Ventas" },
  // Empleados — Administración
  { nombre: "Karen", categoria: "Empleado", depto: "Administración" },
  { nombre: "Aracely", categoria: "Empleado", depto: "Administración" },
  // Empleados — Operaciones
  { nombre: "Yankee", categoria: "Empleado", depto: "Operaciones" },
  { nombre: "Juanjo", categoria: "Empleado", depto: "Operaciones" },
  { nombre: "Héctor", categoria: "Empleado", depto: "Operaciones" },
  // Empleados — Logística
  { nombre: "Alex", categoria: "Empleado", depto: "Logística" },
];
