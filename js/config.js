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
