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
  apiKey: "REEMPLAZAR_API_KEY",
  authDomain: "REEMPLAZAR_PROJECT_ID.firebaseapp.com",
  projectId: "REEMPLAZAR_PROJECT_ID",
  storageBucket: "REEMPLAZAR_PROJECT_ID.appspot.com",
  messagingSenderId: "REEMPLAZAR_SENDER_ID",
  appId: "REEMPLAZAR_APP_ID",
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
export const ACCESS_PIN = "1234";

// Nombre de la colección en Firestore.
export const COLLECTION = "vales";

// Opciones permitidas (deben coincidir con firestore.rules).
export const CATEGORIAS = ["Empleado", "Familia"];
export const MONTOS = [200, 300, 500, 1000];
