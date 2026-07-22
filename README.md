# ⛽ Registro de Vales de Gasolina

App web sencilla (HTML + CSS + JavaScript vanilla, **sin paso de build**) para
registrar vales de gasolina en Firestore. Se despliega directamente en **GitHub
Pages**.

- Colección única en Firestore: `vales`
- Acceso mediante **PIN del lado del cliente** (ver advertencia de seguridad)
- Actualizaciones en tiempo real con `onSnapshot`

---

## ⚠️ Advertencia de seguridad (léela)

El PIN **sólo oculta la interfaz**. No es seguridad real:

- La configuración de Firebase viaja al navegador de cualquier visitante.
- Cualquiera con el `projectId` puede leer/escribir en `vales` **sin** el PIN.
- Las reglas de Firestore validan la **forma y el tamaño** de los documentos,
  pero **no controlan quién** accede.

Esto es aceptable **sólo** porque el equipo es de confianza y los datos no son
sensibles. Si eso cambia, migra a **Firebase Authentication**.

---

## 1. Configurar Firebase (manual)

1. Crea un proyecto en la [Consola de Firebase](https://console.firebase.google.com/).
2. Crea una base de datos **Cloud Firestore** (modo producción).
3. Registra una **App web** y copia el objeto de configuración.
4. Pega esos valores en **`js/config.js`** (reemplaza los `REEMPLAZAR_…`).
5. Cambia el `ACCESS_PIN` en el mismo archivo.

### Publicar las reglas de seguridad

```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use <TU_PROJECT_ID>
npx -y firebase-tools@latest deploy --only firestore:rules
```

> Consejo: valida antes con
> `npx -y firebase-tools@latest deploy --only firestore:rules --dry-run`

---

## 2. Probar localmente

Como usa módulos ES, ábrelo con un servidor local (no con `file://`):

```bash
cd Mobil
python3 -m http.server 8000
# abre http://localhost:8000
```

---

## 3. Desplegar en GitHub Pages

1. Sube este directorio a un repositorio de GitHub.
2. En el repo: **Settings → Pages**.
3. En **Source**, elige la rama (p. ej. `main`) y la carpeta `/ (root)`.
4. Guarda. Tu app estará en `https://<usuario>.github.io/<repo>/`.

El archivo `.nojekyll` ya está incluido para que GitHub Pages sirva los archivos
tal cual.

---

## Estructura del proyecto

```
Mobil/
├── index.html            # Interfaz (pantalla de PIN + captura + tabla)
├── css/styles.css        # Estilos
├── js/
│   ├── config.js         # ⚙️  Config de Firebase + PIN  (EDITAR AQUÍ)
│   └── app.js            # Lógica de la app + Firestore
├── firestore.rules       # Reglas de seguridad (prototipo)
├── firestore.indexes.json
├── firebase.json
├── .nojekyll
└── README.md
```

## Modelo de datos (`vales`)

| Campo           | Tipo      | Requerido | Restricción                  |
| --------------- | --------- | --------- | ---------------------------- |
| `nombre`        | string    | sí        | 1–100 caracteres             |
| `categoria`     | string    | sí        | `Empleado` o `Familia`       |
| `monto`         | number    | sí        | 200, 300, 500 o 1000         |
| `fecha`         | timestamp | sí        | `serverTimestamp()`          |
| `registradoPor` | string    | sí        | 1–100 caracteres             |
| `notas`         | string    | no        | 0–500 caracteres             |
