// ============================================================================
//  Verificación de firestore.rules contra el EMULADOR de Firestore
// ============================================================================
//  A diferencia del resto de tests/, éste NO es análisis estático: ejecuta las
//  reglas de verdad. Necesita el emulador (y Java). Desde la raíz del repo:
//
//      npx -y firebase-tools@latest emulators:exec --only firestore \
//          --project demo-vales "node tests/verify-reglas.mjs"
//
//  `demo-vales` es un proyecto ficticio (prefijo demo-): el emulador nunca
//  toca producción ni pide credenciales. Sin dependencias: se habla con el
//  emulador por su API REST, que evalúa las reglas igual que con el SDK.
//
//    · Peticiones SIN cabecera Authorization  → pasan por firestore.rules
//      (es exactamente lo que hace la app, que no usa Firebase Auth).
//    · Authorization: Bearer owner            → se saltan las reglas. Sólo se
//      usa para SEMBRAR datos y para LEER el estado final.
//
//  Qué se comprueba (auditoría de noviembre 2026, folio duplicado al anular
//  desde una pantalla desactualizada):
//    1. anulación válida con devolución del folio;
//    2. una segunda anulación del mismo vale se rechaza;
//    3. no se puede devolver un folio que ya se reasignó a otro vale;
//    4. no se puede asignar un folio que no está disponible;
//    5. si una parte del lote falla, no queda NINGÚN cambio parcial;
//    6. el escenario completo V → anular → reasignar a V2 → anular V otra vez.
// ============================================================================
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) {
  console.error(
    "✖ No hay emulador (falta FIRESTORE_EMULATOR_HOST). Las reglas NO quedan verificadas.\n" +
      "  Ejecuta:  npx -y firebase-tools@latest emulators:exec --only firestore " +
      '--project demo-vales "node tests/verify-reglas.mjs"'
  );
  process.exit(1);
}
if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(HOST)) {
  console.error(`✖ FIRESTORE_EMULATOR_HOST=${HOST} no es local: no se ejecuta contra nada que no sea el emulador.`);
  process.exit(1);
}

const PROJECT = process.env.GCLOUD_PROJECT || "demo-vales";
assert.match(PROJECT, /^demo-/, "las pruebas destructivas sólo usan proyectos demo- del emulador");
const DB = `projects/${PROJECT}/databases/(default)`;
const DOCS = `${DB}/documents`;
const API = `http://${HOST}/v1/${DOCS}`;
const OWNER = { Authorization: "Bearer owner" };
const REGLAS_HEAD = process.env.VALES_RULES_BASELINE === "head";

// --- Codificación de valores de Firestore (REST) ----------------------------
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}
const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, enc(v)]));
function dec(f) {
  if (!f) return undefined;
  if ("nullValue" in f) return null;
  if ("booleanValue" in f) return f.booleanValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("timestampValue" in f) return f.timestampValue;
  return f.stringValue;
}
const name = (col, id) => `${DOCS}/${col}/${id}`;
const AHORA = { setToServerValue: "REQUEST_TIME" };

// --- Escrituras tal y como las manda la app ---------------------------------
// Vale nuevo (doSave): set() con createdAt = serverTimestamp().
function wCrearVale(id, datos) {
  return {
    update: { name: name("vales", id), fields: fields(REGLAS_HEAD ? datos : { esquema: 2, ...datos }) },
    updateTransforms: [{ fieldPath: "createdAt", ...AHORA }],
  };
}
// Asignación del folio (camposAsignacion): update() de cuatro campos.
function wAsignar(folio, nombre, batchId, valeId) {
  const datos = { status: "asignado", asignadoA: nombre, batchId };
  if (!REGLAS_HEAD && valeId !== undefined) datos.asignadoValeId = valeId;
  return {
    update: { name: name("inventario", folio), fields: fields(datos) },
    updateMask: { fieldPaths: Object.keys(datos) },
    updateTransforms: [{ fieldPath: "asignadoEn", ...AHORA }],
    currentDocument: { exists: true },
  };
}
// Anulación (anularVale): update() de anulado + anuladoEn.
function wAnular(id) {
  return {
    update: { name: name("vales", id), fields: fields({ anulado: true }) },
    updateMask: { fieldPaths: ["anulado"] },
    updateTransforms: [{ fieldPath: "anuladoEn", ...AHORA }],
    currentDocument: { exists: true },
  };
}
// Devolución del folio (camposDevolucion). `valeId` undefined = cliente
// ANTIGUO, que no mandaba devueltoPorVale.
function wDevolver(folio, valeId) {
  const datos = { status: "disponible", asignadoA: null, asignadoEn: null, batchId: null };
  if (valeId !== undefined) {
    datos.devueltoPorVale = valeId;
    if (!REGLAS_HEAD) datos.asignadoValeId = null;
  }
  return {
    update: { name: name("inventario", folio), fields: fields(datos) },
    updateMask: { fieldPaths: Object.keys(datos) },
    currentDocument: { exists: true },
  };
}

async function commit(writes, headers = {}) {
  const res = await fetch(`${API}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ writes }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, code: body.error && body.error.status, body };
}
// Lote enviado como lo envía la app: SIN credenciales ⇒ pasa por las reglas.
const comoApp = (writes) => commit(writes);

async function leer(col, id) {
  const res = await fetch(`${API}/${col}/${id}`, { headers: OWNER });
  if (res.status === 404) return null;
  assert.ok(res.ok, `lectura de fixture falló: HTTP ${res.status}`);
  const doc = await res.json();
  return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, dec(v)]));
}

async function limpiar() {
  const res = await fetch(`http://${HOST}/emulator/v1/${DOCS}`, { method: "DELETE" });
  assert.ok(res.ok, "no se pudo vaciar el emulador");
}

// Siembra (saltándose las reglas) un folio importado y disponible.
async function sembrarFolio(folio, monto = 200, extra = {}) {
  const r = await commit(
    [{
      update: {
        name: name("inventario", folio),
        fields: fields({
          folio, monto, status: "disponible", vencimiento: "2027-03-31",
          qrImageBase64: "UE5H", asignadoA: null, asignadoEn: null, batchId: null,
          importadoEn: new Date("2026-10-01T12:00:00Z"), importadoPor: "Pruebas",
          ...extra,
        }),
      },
    }],
    OWNER
  );
  assert.ok(r.ok, "siembra de inventario: " + JSON.stringify(r.body));
}

const valeDatos = (folio, batchId, nombre = "Persona Uno", monto = 200) => ({
  nombre, categoria: "Empleado", monto, registradoPor: "Pruebas",
  fechaVale: new Date("2026-11-10T06:00:00Z"), anulado: false, batchId,
  qrCode: `COMBUSA-${folio}`, folio, vencimiento: "2027-03-31",
});

async function sembrarVale(id, datos) {
  const r = await commit([{ update: { name: name("vales", id), fields: fields(datos) } }], OWNER);
  assert.ok(r.ok, "siembra de vale: " + JSON.stringify(r.body));
}

// Registro normal, por las reglas: crea el vale y asigna el folio en UN lote.
async function registrar(valeId, folio, batchId, nombre) {
  const r = await comoApp([wCrearVale(valeId, valeDatos(folio, batchId, nombre)), wAsignar(folio, nombre || "Persona Uno", batchId, valeId)]);
  assert.ok(r.ok, `el registro normal debe pasar las reglas: ${JSON.stringify(r.body)}`);
}

function rechazado(r, que) {
  assert.equal(r.ok, false, `${que}: debía rechazarse y se aceptó`);
  // 403 PERMISSION_DENIED = lo rechazaron LAS REGLAS. Un 400 sería una
  // petición mal formada y la prueba no estaría demostrando nada.
  assert.equal(r.code, "PERMISSION_DENIED", `${que}: se esperaba PERMISSION_DENIED, llegó ${r.status} ${JSON.stringify(r.body)}`);
}

let n = 0;
async function prueba(nombre, fn) {
  await limpiar();
  await fn();
  n++;
  console.log("  ✓", nombre);
}

console.log(`\nReglas de Firestore contra el emulador (${HOST}, proyecto ${PROJECT})\n`);

// Control del motor, en OTRO emulador cargado con tests/fixtures/presupuesto.rules.
// Demuestra que aceptar el carrito máximo no se debe a ignorar globalmente
// los límites: las referencias aquí están fuera del conjunto de escrituras.
if (process.env.VALES_RULES_BASELINE === "presupuesto") {
  async function referencias(n) {
    const r = await commit(Array.from({ length: n }, (_, i) => ({
      update: { name: name("referencias", `R${i}`), fields: fields({ valido: true }) },
    })), OWNER);
    assert.ok(r.ok);
  }
  for (const cantidad of [20, 21, 40]) {
    await prueba(`${cantidad} lecturas externas distintas por lote: ${cantidad <= 20 ? "aceptado" : "rechazado"}`, async () => {
      await referencias(cantidad);
      const r = await comoApp(Array.from({ length: cantidad }, (_, i) => ({
        update: { name: name("externos", `R${i}`), fields: fields({ valido: true }) },
      })));
      if (cantidad <= 20) assert.ok(r.ok);
      else rechazado(r, "presupuesto global");
      for (let i = 0; i < cantidad; i++) {
        assert.equal((await leer("externos", `R${i}`)) !== null, cantidad <= 20);
      }
    });
  }
  await prueba("11 accesos externos en una operación: rechazado", async () => {
    await referencias(11);
    rechazado(await comoApp([{ update: { name: name("excesos", "control"), fields: fields({ valido: true }) } }]), "presupuesto por operación");
    assert.equal(await leer("excesos", "control"), null);
  });
  console.log(`\n✅ ${n} controles de presupuesto OK (emulador)\n`);
  process.exit(0);
}

// Se ejecuta por separado con el emulador cargando `git show HEAD:firestore.rules`.
// HEAD es la referencia local anterior, NO prueba de qué reglas hay publicadas.
if (process.env.VALES_RULES_BASELINE === "head") {
  await prueba("reglas HEAD: registro y devolución del cliente anterior funcionan", async () => {
    await sembrarFolio("117700");
    await registrar("V1", "117700", "lote-1");
    assert.ok((await comoApp([wAnular("V1"), wDevolver("117700")])).ok);
  });
  await prueba("reglas HEAD: devolución nueva rechazada, lote intacto", async () => {
    await sembrarFolio("117700");
    await registrar("V1", "117700", "lote-1");
    const antes = await leer("inventario", "117700");
    rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "campo nuevo");
    assert.deepEqual(await leer("inventario", "117700"), antes);
    assert.equal((await leer("vales", "V1")).anulado, false);
  });
  await prueba("reglas HEAD: rollback bloquea reasignar inventario con devueltoPorVale", async () => {
    await sembrarFolio("117700", 200, { devueltoPorVale: "VANTERIOR" });
    rechazado(await comoApp([
      wCrearVale("V1", valeDatos("117700", "lote-1")), wAsignar("117700", "Persona Uno", "lote-1", "V1"),
    ]), "inventario con campo aditivo bajo reglas antiguas");
    assert.equal(await leer("vales", "V1"), null);
    assert.equal((await leer("inventario", "117700")).status, "disponible");
  });
  await prueba("reglas HEAD: sólo fecha legacy se rechaza; no es una regresión nueva", async () => {
    await sembrarVale("VIEJO", {
      nombre: "Fixture", categoria: "Familia", monto: 4000, registradoPor: "Pruebas",
      fecha: new Date("2026-07-01T06:00:00Z"),
    });
    rechazado(await comoApp([wAnular("VIEJO")]), "legacy fecha");
  });
  await prueba("reglas HEAD: se reproduce la segunda anulación que libera un folio reasignado", async () => {
    await sembrarFolio("117700");
    await registrar("V1", "117700", "lote-1");
    assert.ok((await comoApp([wAnular("V1"), wDevolver("117700")])).ok);
    await registrar("V2", "117700", "lote-2");
    assert.ok((await comoApp([wAnular("V1"), wDevolver("117700")])).ok);
    assert.equal((await leer("vales", "V2")).anulado, false);
    assert.equal((await leer("inventario", "117700")).status, "disponible");
  });
  await prueba("reglas HEAD: el cliente de esquema 2 no puede registrar; ningún documento parcial", async () => {
    await sembrarFolio("117700");
    const alta = wCrearVale("V1", { ...valeDatos("117700", "lote-1"), esquema: 2 });
    const asignacion = wAsignar("117700", "Persona Uno", "lote-1");
    asignacion.update.fields.asignadoValeId = enc("V1");
    asignacion.updateMask.fieldPaths.push("asignadoValeId");
    rechazado(await comoApp([asignacion, alta]), "cliente esquema 2 con reglas anteriores");
    assert.equal(await leer("vales", "V1"), null);
    assert.equal((await leer("inventario", "117700")).status, "disponible");
  });
  console.log(`\n✅ ${n} comprobaciones de compatibilidad con reglas HEAD OK\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
console.log("== Registro y asignación ==");

const MAX_VALES = Number(readFileSync("js/app.js", "utf8").match(/const MAX_VALES = (\d+);/)[1]);
assert.equal(MAX_VALES, 20, "revisar el presupuesto de reglas si cambia el máximo");

await prueba(`máximo real: ${MAX_VALES} vales + ${MAX_VALES} asignaciones en un commit`, async () => {
  for (let i = 0; i < MAX_VALES; i++) await sembrarFolio(String(120000 + i));
  const writes = Array.from({ length: MAX_VALES }, (_, i) => [
    // Mismo orden que doSave: asignar inventario antes de batch.set(vale).
    wAsignar(String(120000 + i), "Fixture máximo", "lote-max", `MAX${i}`),
    wCrearVale(`MAX${i}`, valeDatos(String(120000 + i), "lote-max", "Fixture máximo")),
  ]).flat();
  const r = await comoApp(writes);
  assert.ok(r.ok, `el máximo NO puede fallar por accesos: ${JSON.stringify(r.body)}`);
  for (let i = 0; i < MAX_VALES; i++) {
    const inv = await leer("inventario", String(120000 + i));
    const vale = await leer("vales", `MAX${i}`);
    assert.equal(inv.asignadoValeId, `MAX${i}`);
    assert.equal(inv.batchId, vale.batchId);
    assert.equal(vale.esquema, 2);
    assert.equal(vale.folio, inv.folio);
    assert.equal(vale.anulado, false);
  }
});

await prueba("dos carritos máximos concurrentes: un ganador completo y cero documentos perdedores", async () => {
  const comun = "125000";
  await sembrarFolio(comun);
  const carritos = [0, 1].map((c) => Array.from({ length: MAX_VALES }, (_, i) => ({
    id: `C${c}V${i}`, folio: i === 0 ? comun : String(125100 + c * MAX_VALES + i), lote: `carrito-${c}`,
  })));
  for (const carrito of carritos) for (const v of carrito.slice(1)) await sembrarFolio(v.folio);
  const resultados = await Promise.all(carritos.map((carrito) => comoApp(carrito.flatMap((v) => [
    wAsignar(v.folio, "Fixture", v.lote, v.id),
    wCrearVale(v.id, valeDatos(v.folio, v.lote, "Fixture")),
  ]))));
  assert.equal(resultados.filter((r) => r.ok).length, 1);
  for (const [c, carrito] of carritos.entries()) {
    if (!resultados[c].ok) rechazado(resultados[c], "carrito máximo perdedor");
    for (const v of carrito) {
      const vale = await leer("vales", v.id);
      const inv = await leer("inventario", v.folio);
      if (resultados[c].ok) {
        assert.equal(vale.batchId, v.lote);
        assert.equal(inv.asignadoValeId, v.id);
        assert.equal(inv.batchId, v.lote);
      } else {
        assert.equal(vale, null);
        if (v.folio !== comun) assert.equal(inv.status, "disponible");
        assert.notEqual(inv.asignadoValeId, v.id);
      }
    }
  }
});

await prueba("cliente anterior no puede crear nuevos registros históricos", async () => {
  await sembrarFolio("117700");
  const alta = wCrearVale("V1", valeDatos("117700", "lote-1"));
  delete alta.update.fields.esquema;
  rechazado(await comoApp([wAsignar("117700", "Persona Uno", "lote-1"), alta]), "cliente sin esquema ni dueño exacto");
  assert.equal(await leer("vales", "V1"), null);
  assert.equal((await leer("inventario", "117700")).status, "disponible");
});

await prueba("dos altas para el mismo folio en un lote: rechazo completo", async () => {
  await sembrarFolio("117700");
  rechazado(await comoApp([
    wCrearVale("V1", valeDatos("117700", "lote-1")),
    wCrearVale("COPIA", valeDatos("117700", "lote-1")),
    wAsignar("117700", "Persona Uno", "lote-1", "V1"),
  ]), "dos vales para una asignación");
  assert.equal(await leer("vales", "V1"), null);
  assert.equal(await leer("vales", "COPIA"), null);
  assert.equal((await leer("inventario", "117700")).status, "disponible");
});

await prueba("asignación suelta, a vale inexistente o histórico: rechazada", async () => {
  await sembrarFolio("117700");
  rechazado(await comoApp([wAsignar("117700", "Persona Uno", "lote-1", "NOEXISTE")]), "no existe vale");
  await sembrarVale("HISTORICO", valeDatos("117700", "lote-1"));
  rechazado(await comoApp([wAsignar("117700", "Persona Uno", "lote-1", "HISTORICO")]), "vale ya existía");
  assert.equal((await leer("inventario", "117700")).status, "disponible");
});

await prueba("alta no puede omitir esquema/folio, declararse legacy ni nacer anulada", async () => {
  await sembrarFolio("117700");
  const variantes = [
    (d) => { delete d.esquema; },
    (d) => { d.esquema = enc(1); },
    (d) => { d.esquema = enc(null); },
    (d) => { delete d.folio; },
    (d) => { d.anulado = enc(true); },
    (d) => { d.createdAt = enc(new Date("2020-01-01T00:00:00Z")); },
  ];
  for (const [i, cambiar] of variantes.entries()) {
    const alta = wCrearVale(`N${i}`, valeDatos("117700", "lote-1"));
    if (i === 5) delete alta.updateTransforms;
    cambiar(alta.update.fields);
    rechazado(await comoApp([alta, wAsignar("117700", "Persona Uno", "lote-1", `N${i}`)]), "alta se hace pasar por histórica");
    assert.equal(await leer("vales", `N${i}`), null);
    assert.equal((await leer("inventario", "117700")).status, "disponible");
  }
});

await prueba("no se puede quitar el esquema nuevo ni añadirlo a un histórico al anular", async () => {
  await sembrarFolio("117700");
  await registrar("NUEVO", "117700", "lote-1");
  const sinEsquema = wAnular("NUEVO");
  sinEsquema.updateMask.fieldPaths.push("esquema"); // borrado del campo
  rechazado(await comoApp([sinEsquema, wDevolver("117700", "NUEVO")]), "quitar esquema");
  assert.equal((await leer("vales", "NUEVO")).esquema, 2);
  await sembrarVale("HISTORICO", valeDatos("117700", "lote-1"));
  const conEsquema = wAnular("HISTORICO");
  conEsquema.updateMask.fieldPaths.push("esquema");
  conEsquema.update.fields.esquema = enc(2);
  rechazado(await comoApp([conEsquema, wDevolver("117700", "HISTORICO")]), "añadir esquema a histórico");
  assert.equal((await leer("vales", "HISTORICO")).anulado, false);
  assert.equal((await leer("inventario", "117700")).asignadoValeId, "NUEVO");
});

await prueba("inventario histórico asignado sin ID exacto no se devuelve aunque coincida el lote", async () => {
  await sembrarFolio("117700", 200, { status: "asignado", batchId: "lote-1" });
  // Incluso con un vale marcado como nuevo por fuera de reglas, el lote solo
  // no acredita propiedad de una asignación histórica.
  await sembrarVale("V1", { ...valeDatos("117700", "lote-1"), esquema: 2 });
  const antes = await leer("inventario", "117700");
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "sin dueño exacto");
  assert.equal((await leer("vales", "V1")).anulado, false);
  assert.deepEqual(await leer("inventario", "117700"), antes);
});

await prueba("reasignar requiere un vale NUEVO; no revive un dueño anterior", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  assert.ok((await comoApp([wAnular("V1"), wDevolver("117700", "V1")])).ok);
  const antes = await leer("inventario", "117700");
  rechazado(await comoApp([wAsignar("117700", "Persona Uno", "lote-1", "V1")]), "reasignar vale antiguo");
  assert.deepEqual(await leer("inventario", "117700"), antes);
  assert.equal((await leer("vales", "V1")).anulado, true);
});

await prueba("ID, folio, lote y monto cruzados: ninguna asignación parcial", async () => {
  await sembrarFolio("117700");
  await sembrarFolio("117701");
  for (const [id, folio, lote, monto] of [
    ["OTRO", "117700", "lote-1", 200],
    ["V1", "117701", "lote-1", 200],
    ["V1", "117700", "lote-2", 200],
    ["V1", "117700", "lote-1", 500],
  ]) {
    rechazado(await comoApp([
      wCrearVale("V1", valeDatos(folio, lote, "Persona Uno", monto)),
      wAsignar("117700", "Persona Uno", "lote-1", id),
    ]), "vínculo cruzado");
    assert.equal(await leer("vales", "V1"), null);
    assert.equal((await leer("inventario", "117700")).status, "disponible");
  }
});

await prueba("registro normal: crea el vale y asigna el folio", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  const inv = await leer("inventario", "117700");
  assert.equal(inv.status, "asignado");
  assert.equal(inv.batchId, "lote-1");
  assert.equal(inv.asignadoValeId, "V1");
  assert.equal(inv.asignadoA, "Persona Uno");
});

await prueba("asignar un folio NO disponible se rechaza (y no se crea el vale)", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  // Otro dispositivo intenta llevarse el mismo folio.
  const r = await comoApp([
    wCrearVale("V2", valeDatos("117700", "lote-2", "Persona Dos")),
    wAsignar("117700", "Persona Dos", "lote-2", "V2"),
  ]);
  rechazado(r, "asignación de un folio ya asignado");
  assert.equal(await leer("vales", "V2"), null, "el vale del lote rechazado no debe existir");
  const inv = await leer("inventario", "117700");
  assert.equal(inv.batchId, "lote-1", "la asignación original queda intacta");
  assert.equal(inv.asignadoA, "Persona Uno");
});

await prueba("un folio en revisión tampoco se puede asignar", async () => {
  await sembrarFolio("117701", 200, { status: "revision_requerida", decodeError: true, decodedPayload: null });
  const r = await comoApp([wCrearVale("V1", valeDatos("117701", "lote-1")), wAsignar("117701", "Persona Uno", "lote-1", "V1")]);
  rechazado(r, "asignación de un folio en revisión");
  assert.equal(await leer("vales", "V1"), null);
});

await prueba("dos lotes concurrentes: exactamente uno gana y el perdedor no deja documentos parciales", async () => {
  // Cada contendiente incluye otro vale/folio libre: también deben revertirse
  // los documentos que NO son objeto de la colisión. No hay await entre envíos.
  for (let ronda = 0; ronda < 5; ronda++) {
    const comun = String(118000 + ronda * 3);
    const propios = [String(Number(comun) + 1), String(Number(comun) + 2)];
    for (const f of [comun, ...propios]) await sembrarFolio(f);
    const contendientes = [0, 1].map((i) => ({
      id: `R${ronda}V${i}`, extra: `R${ronda}E${i}`, lote: `R${ronda}L${i}`,
      persona: `Fixture ${i}`, propio: propios[i],
    }));
    const resultados = await Promise.all(contendientes.map((c) => comoApp([
      wCrearVale(c.extra, valeDatos(c.propio, c.lote, c.persona)),
      wAsignar(c.propio, c.persona, c.lote, c.extra),
      wCrearVale(c.id, valeDatos(comun, c.lote, c.persona)),
      wAsignar(comun, c.persona, c.lote, c.id),
    ])));
    assert.equal(resultados.filter((r) => r.ok).length, 1, "exactamente un commit exitoso");
    const ganador = contendientes[resultados.findIndex((r) => r.ok)];
    const perdedor = contendientes[resultados.findIndex((r) => !r.ok)];
    rechazado(resultados.find((r) => !r.ok), "lote concurrente perdedor");
    assert.equal(await leer("vales", perdedor.id), null);
    assert.equal(await leer("vales", perdedor.extra), null);
    assert.equal((await leer("inventario", perdedor.propio)).status, "disponible");
    const inv = await leer("inventario", comun);
    const vale = await leer("vales", ganador.id);
    assert.equal(inv.status, "asignado");
    assert.equal(inv.batchId, ganador.lote);
    assert.equal(inv.batchId, vale.batchId);
    assert.equal(inv.folio, vale.folio);
    assert.equal(inv.asignadoA, vale.nombre);
    assert.equal(inv.asignadoValeId, ganador.id);
    assert.ok(await leer("vales", ganador.extra));
    assert.equal((await leer("inventario", ganador.propio)).batchId, ganador.lote);
  }
});

// ---------------------------------------------------------------------------
console.log("\n== Anulación y devolución ==");

await prueba("anulación válida: anula el vale y devuelve el folio en un lote", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  const r = await comoApp([wAnular("V1"), wDevolver("117700", "V1")]);
  assert.ok(r.ok, "la anulación normal debe pasar: " + JSON.stringify(r.body));
  const vale = await leer("vales", "V1");
  const inv = await leer("inventario", "117700");
  assert.equal(vale.anulado, true);
  assert.ok(vale.anuladoEn, "queda la marca de tiempo de la anulación");
  assert.equal(inv.status, "disponible");
  assert.equal(inv.asignadoA, null);
  assert.equal(inv.batchId, null);
  assert.equal(inv.devueltoPorVale, "V1");
  assert.equal(inv.asignadoValeId, null);
  assert.equal(inv.monto, 200, "los datos físicos del folio no cambian");
});

await prueba("asignar → devolver → reasignar → devolver: marcador conservado y después sustituido", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  assert.ok((await comoApp([wAnular("V1"), wDevolver("117700", "V1")])).ok);
  await registrar("V2", "117700", "lote-2", "Persona Dos");
  const inv = await leer("inventario", "117700");
  assert.equal(inv.status, "asignado");
  assert.equal(inv.batchId, "lote-2");
  assert.equal(inv.asignadoValeId, "V2");
  assert.equal(inv.devueltoPorVale, "V1", "asignar conserva la última devolución");
  rechazado(await comoApp([wAnular("V2"), wDevolver("117700")]), "cliente anterior conserva marcador obsoleto");
  rechazado(await comoApp([wAnular("V2"), wDevolver("117700", "V1")]), "devolución con marcador anterior");
  assert.equal((await leer("vales", "V2")).anulado, false);
  assert.deepEqual(await leer("inventario", "117700"), inv);
  assert.ok((await comoApp([wAnular("V2"), wDevolver("117700", "V2")])).ok);
  const devuelto = await leer("inventario", "117700");
  assert.equal(devuelto.devueltoPorVale, "V2");
  assert.equal(devuelto.status, "disponible");
  assert.equal(devuelto.batchId, null);
  assert.equal(devuelto.asignadoA, null);
  assert.equal(devuelto.asignadoEn, null);
  assert.equal(devuelto.asignadoValeId, null);
  assert.equal((await leer("vales", "V2")).anulado, true);
});

await prueba("cliente anterior con reglas nuevas: devolución sin marcador rechazada atómicamente", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  const antes = await leer("inventario", "117700");
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700")]), "cliente anterior");
  assert.deepEqual(await leer("inventario", "117700"), antes);
  assert.equal((await leer("vales", "V1")).anulado, false);
});

await prueba("segunda anulación del mismo vale: rechazada", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  assert.ok((await comoApp([wAnular("V1"), wDevolver("117700", "V1")])).ok);
  const antes = await leer("vales", "V1");
  rechazado(await comoApp([wAnular("V1")]), "re-anular sin devolución");
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "re-anular con devolución");
  const despues = await leer("vales", "V1");
  assert.equal(despues.anuladoEn, antes.anuladoEn, "la fecha de anulación original no se reescribe");
});

await prueba("anular SIN devolver el folio propio: rechazado (anular y devolver van juntos)", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  rechazado(await comoApp([wAnular("V1")]), "anular dejando el folio asignado");
  assert.equal((await leer("vales", "V1")).anulado, false);
  assert.equal((await leer("inventario", "117700")).status, "asignado");
});

await prueba("devolver SIN anular: rechazado", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  rechazado(await comoApp([wDevolver("117700", "V1")]), "devolución suelta citando al vale dueño");
  rechazado(await comoApp([wDevolver("117700")]), "devolución suelta sin vale (cliente antiguo)");
  rechazado(await comoApp([wDevolver("117700", "no-existe")]), "devolución citando un vale inexistente");
  assert.equal((await leer("inventario", "117700")).status, "asignado");
});

await prueba("devolver un folio reasignado desde un vale ajeno: rechazado", async () => {
  /* V1 activo dice tener el folio 117700 con el lote-1, pero el inventario lo
     tiene asignado al lote-2 (V2). Anular V1 no puede llevarse el folio de V2. */
  await sembrarFolio("117700");
  await registrar("V2", "117700", "lote-2", "Persona Dos");
  const r0 = await commit([{ update: { name: name("vales", "V1"), fields: fields({ ...valeDatos("117700", "lote-1"), createdAt: new Date() }) } }], OWNER);
  assert.ok(r0.ok);
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "devolución con batchId distinto al de la asignación vigente");
  // Tampoco citando al dueño real sin anularlo.
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V2")]), "devolución citando al dueño vigente sin anularlo");
  const inv = await leer("inventario", "117700");
  assert.equal(inv.status, "asignado");
  assert.equal(inv.batchId, "lote-2");
  assert.equal((await leer("vales", "V1")).anulado, false, "lote atómico: V1 tampoco quedó anulado");
});

await prueba("vale activo cuyo folio pertenece a OTRO registro: anulación bloqueada, nada cambia", async () => {
  await sembrarFolio("117700");
  await registrar("V2", "117700", "lote-2", "Persona Dos"); // dueño vigente del folio
  // V1 activo con el mismo folio pero otro lote; y V0 igual pero SIN batchId.
  for (const [id, lote] of [["V1", "lote-1"], ["V0", null]]) {
    const d = { ...valeDatos("117700", lote || "x"), createdAt: new Date("2026-11-01T12:00:00Z") };
    if (!lote) delete d.batchId;
    assert.ok((await commit([{ update: { name: name("vales", id), fields: fields(d) } }], OWNER)).ok);
  }
  const antes = {
    V0: await leer("vales", "V0"), V1: await leer("vales", "V1"),
    V2: await leer("vales", "V2"), inv: await leer("inventario", "117700"),
  };
  rechazado(await comoApp([wAnular("V1")]), "anular V1 a secas");
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "anular V1 devolviendo el folio ajeno");
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V2")]), "anular V1 citando a V2");
  rechazado(await comoApp([wAnular("V0")]), "anular un vale sin batchId cuyo folio es de otro");
  assert.deepEqual(await leer("vales", "V0"), antes.V0, "V0 intacto");
  assert.deepEqual(await leer("vales", "V1"), antes.V1, "V1 intacto");
  assert.deepEqual(await leer("vales", "V2"), antes.V2, "V2 intacto");
  assert.deepEqual(await leer("inventario", "117700"), antes.inv, "inventario intacto");
  assert.equal(antes.V1.anulado, false);
  assert.equal(antes.inv.batchId, "lote-2");
  // El dueño vigente sí puede anular y devolver con normalidad.
  assert.ok((await comoApp([wAnular("V2"), wDevolver("117700", "V2")])).ok, "V2 sigue pudiendo anularse");
});

await prueba("histórico con folio DISPONIBLE: requiere revisión, no se anula", async () => {
  await sembrarFolio("117700");
  const d = { ...valeDatos("117700", "lote-1"), createdAt: new Date("2026-11-01T12:00:00Z") };
  assert.ok((await commit([{ update: { name: name("vales", "V1"), fields: fields(d) } }], OWNER)).ok);
  rechazado(await comoApp([wAnular("V1")]), "histórico sin dueño demostrable");
  assert.equal((await leer("vales", "V1")).anulado, false);
  assert.equal((await leer("inventario", "117700")).status, "disponible");
});

await prueba("histórico con folio ausente: requiere revisión, no se anula", async () => {
  // Folios de pruebas antiguas, borrados de la colección.
  const r0 = await commit([{ update: { name: name("vales", "V1"), fields: fields({ ...valeDatos("999001", "lote-x"), createdAt: new Date() }) } }], OWNER);
  assert.ok(r0.ok);
  rechazado(await comoApp([wAnular("V1")]), "folio ausente sin dueño demostrable");
  assert.equal((await leer("vales", "V1")).anulado, false);
});

await prueba("vale antiguo (campo `fecha`, sin folio ni batchId): se sigue pudiendo anular", async () => {
  const r0 = await commit([{ update: { name: name("vales", "VIEJO"), fields: fields({
    nombre: "Persona Uno", categoria: "Familia", monto: 4000, registradoPor: "Pruebas",
    fecha: new Date("2026-07-01T06:00:00Z"),
  }) } }], OWNER);
  assert.ok(r0.ok);
  assert.ok((await comoApp([wAnular("VIEJO")])).ok, "los vales del esquema antiguo deben poder anularse");
  rechazado(await comoApp([wAnular("VIEJO")]), "re-anular un vale antiguo");
});

// ---------------------------------------------------------------------------
console.log("\n== Atomicidad ==");

await prueba("si una parte del lote falla no queda ningún cambio parcial", async () => {
  await sembrarFolio("117700");
  await sembrarFolio("117704");
  await registrar("V0", "117704", "lote-0", "Persona Cero"); // 117704 ya no está disponible
  // Lote de dos vales: el primero es perfectamente válido, el segundo no.
  const r = await comoApp([
    wCrearVale("VA", valeDatos("117700", "lote-3")),
    wAsignar("117700", "Persona Uno", "lote-3", "VA"),
    wCrearVale("VB", valeDatos("117704", "lote-3")),
    wAsignar("117704", "Persona Uno", "lote-3", "VB"),
  ]);
  rechazado(r, "lote con un folio no disponible");
  assert.equal(await leer("vales", "VA"), null, "el vale válido del lote tampoco se guarda");
  assert.equal(await leer("vales", "VB"), null);
  assert.equal((await leer("inventario", "117700")).status, "disponible", "el folio libre sigue libre");
  assert.equal((await leer("inventario", "117704")).batchId, "lote-0");
});

await prueba("anulación con devolución inválida: el vale NO queda anulado", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  // Devolución que intenta además cambiar el monto del folio.
  const mala = wDevolver("117700", "V1");
  mala.update.fields.monto = enc(1000);
  mala.updateMask.fieldPaths.push("monto");
  rechazado(await comoApp([wAnular("V1"), mala]), "devolución que altera datos físicos");
  assert.equal((await leer("vales", "V1")).anulado, false);
  const inv = await leer("inventario", "117700");
  assert.equal(inv.status, "asignado");
  assert.equal(inv.monto, 200);
});

// ---------------------------------------------------------------------------
console.log("\n== Escenario completo: anulación desde una pantalla desactualizada ==");

await prueba("V→anular→F pasa a V2→anular V otra vez: rechazado, V2 intacto", async () => {
  await sembrarFolio("117700");
  // 1. Se emite V con el folio F.
  await registrar("V", "117700", "lote-1", "Persona Uno");
  // 2. El dispositivo A anula V y devuelve F.
  assert.ok((await comoApp([wAnular("V"), wDevolver("117700", "V")])).ok);
  // 3. F se asigna al vale nuevo V2.
  await registrar("V2", "117700", "lote-2", "Persona Dos");
  const v2Antes = await leer("vales", "V2");
  const invAntes = await leer("inventario", "117700");

  // 4. El dispositivo B, con la lista vieja (V todavía "activo"), anula V.
  //    Se prueban el cliente nuevo, el cliente antiguo y la anulación a secas.
  rechazado(await comoApp([wAnular("V"), wDevolver("117700", "V")]), "paso 4 (cliente nuevo)");
  rechazado(await comoApp([wAnular("V"), wDevolver("117700")]), "paso 4 (cliente antiguo, sin devueltoPorVale)");
  rechazado(await comoApp([wAnular("V")]), "paso 4 (sólo el vale)");
  rechazado(await comoApp([wDevolver("117700", "V")]), "paso 4 (sólo la devolución)");

  assert.deepEqual(await leer("vales", "V2"), v2Antes, "V2 no cambia");
  assert.deepEqual(await leer("inventario", "117700"), invAntes, "el inventario de V2 no cambia");
  assert.equal(invAntes.status, "asignado");
  assert.equal(invAntes.batchId, "lote-2");
});

console.log("\n== Esquemas históricos y límites de la política vigente ==");

for (const estado of ["ausente", "disponible", "asignado"]) {
  for (const lote of [undefined, "otro-lote", null, ""]) {
    await prueba(`compatibilidad: folio ${estado}, batchId ${String(lote)}`, async () => {
      if (estado !== "ausente") {
        await sembrarFolio("117700");
        if (estado === "asignado") await registrar("DUENO", "117700", "lote-vigente");
      }
      const datos = valeDatos("117700", lote);
      if (lote === undefined) delete datos.batchId;
      await sembrarVale("LEGACY", datos);
      const antes = await leer("inventario", "117700");
      const r = await comoApp([wAnular("LEGACY")]);
      rechazado(r, "histórico con folio sin vínculo demostrable");
      assert.equal((await leer("vales", "LEGACY")).anulado, false);
      assert.deepEqual(await leer("inventario", "117700"), antes);
    });
  }
}

await prueba("inventario asignado sin batchId: se bloquea aunque el vale tenga lote", async () => {
  await sembrarFolio("117700", 200, { status: "asignado", batchId: null });
  await sembrarVale("V1", valeDatos("117700", "lote-1"));
  rechazado(await comoApp([wAnular("V1"), wDevolver("117700", "V1")]), "inventario sin lote");
  assert.equal((await leer("vales", "V1")).anulado, false);
});

await prueba("ID histórico fuera del formato de devueltoPorVale: devolución bloqueada sin cambios", async () => {
  await sembrarFolio("117700");
  await sembrarFolio("117700", 200, { status: "asignado", batchId: "lote-1" });
  await sembrarVale("legacy.vale", valeDatos("117700", "lote-1"));
  rechazado(await comoApp([wAnular("legacy.vale"), wDevolver("117700", "legacy.vale")]), "ID con punto");
  assert.equal((await leer("vales", "legacy.vale")).anulado, false);
  assert.equal((await leer("inventario", "117700")).status, "asignado");
});

await prueba("fecha ausente, folio numérico o campos extra: esquemas inválidos siguen bloqueados", async () => {
  const casos = [
    { ...valeDatos("999001", "lote-1"), folio: 999001 },
    { ...valeDatos("999001", "lote-1"), campoExtra: "fixture" },
    { ...valeDatos("999001", "lote-1"), fechaVale: "2026-11-10", createdAt: new Date() },
  ];
  for (const [i, datos] of casos.entries()) {
    await sembrarVale(`INVALIDO${i}`, datos);
    rechazado(await comoApp([wAnular(`INVALIDO${i}`)]), "validación del documento completo");
    assert.equal((await leer("vales", `INVALIDO${i}`)).anulado, false);
  }
});

await prueba("reasignar no permite borrar ni alterar devueltoPorVale", async () => {
  await sembrarFolio("117700");
  await registrar("V1", "117700", "lote-1");
  assert.ok((await comoApp([wAnular("V1"), wDevolver("117700", "V1")])).ok);
  const antes = await leer("inventario", "117700");
  for (const valor of [undefined, "OTRO"]) {
    const asignacion = wAsignar("117700", "Persona Dos", "lote-2", "V2");
    asignacion.updateMask.fieldPaths.push("devueltoPorVale");
    if (valor !== undefined) asignacion.update.fields.devueltoPorVale = enc(valor);
    rechazado(await comoApp([
      wCrearVale("V2", valeDatos("117700", "lote-2")), asignacion,
    ]), "alterar historial de devolución al asignar");
    assert.equal(await leer("vales", "V2"), null);
    assert.deepEqual(await leer("inventario", "117700"), antes);
  }
});

await prueba("lectura previa disponible, asignación ajena antes del commit: anulación rechazada", async () => {
  await sembrarFolio("117700");
  await sembrarVale("LEGACY", valeDatos("117700", "lote-viejo"));
  assert.equal((await leer("inventario", "117700")).status, "disponible");
  // Otro dispositivo registra después de esa lectura; el cliente viejo aún
  // intentaría anular a secas, pero las reglas leen el estado del commit.
  await registrar("NUEVO", "117700", "lote-nuevo");
  rechazado(await comoApp([wAnular("LEGACY")]), "lectura previa obsoleta");
  assert.equal((await leer("vales", "LEGACY")).anulado, false);
  assert.equal((await leer("inventario", "117700")).batchId, "lote-nuevo");
});

for (const status of ["revision_requerida", "canjeado", "vencido"]) {
  await prueba(`histórico con inventario ${status}: anulación bloqueada`, async () => {
    await sembrarFolio("117700", 200, {
      status, ...(status === "revision_requerida" ? { decodeError: true, decodedPayload: null } : {}),
    });
    await sembrarVale("V1", valeDatos("117700", "lote-1"));
    const antes = await leer("inventario", "117700");
    rechazado(await comoApp([wAnular("V1")]), "histórico sin asignación verificable");
    assert.equal((await leer("vales", "V1")).anulado, false);
    assert.deepEqual(await leer("inventario", "117700"), antes);
  });
}

await prueba("altas recientes sin asignación NO aprovechan excepciones históricas", async () => {
  await sembrarFolio("117700");
  for (const [id, folio] of [["DISPONIBLE", "117700"], ["AUSENTE", "999001"]]) {
    rechazado(await comoApp([wCrearVale(id, valeDatos(folio, "lote-reciente"))]), "alta sin asignación");
    assert.equal(await leer("vales", id), null);
  }
});

await prueba("duplicar folio + batchId es rechazado; una copia previa tampoco devuelve", async () => {
  await sembrarFolio("117700");
  await registrar("ORIGINAL", "117700", "lote-1");
  const antes = await leer("inventario", "117700");
  rechazado(await comoApp([wCrearVale("COPIA", valeDatos("117700", "lote-1"))]), "alta copiada");
  assert.equal(await leer("vales", "COPIA"), null);
  // Defensa ante una copia preexistente/inconsistente sembrada fuera de reglas.
  await sembrarVale("COPIA", { ...valeDatos("117700", "lote-1"), esquema: 2 });
  rechazado(await comoApp([wAnular("COPIA"), wDevolver("117700", "COPIA")]), "copia devuelve");
  rechazado(await comoApp([wAnular("COPIA"), wDevolver("117700", "ORIGINAL")]), "copia cita al dueño");
  rechazado(await comoApp([wAnular("COPIA")]), "copia se anula sola");
  assert.equal((await leer("vales", "COPIA")).anulado, false);
  assert.equal((await leer("vales", "ORIGINAL")).anulado, false);
  assert.deepEqual(await leer("inventario", "117700"), antes);
});

console.log("\n== Histórico con folio (sin esquema): anulación por lote y monto ==");

// Histórico como los que hay hoy en producción: vale sin `esquema`, con folio
// y batchId; su folio 'asignado' con el mismo lote y SIN asignadoValeId.
async function sembrarHistorico({ valeId = "H1", lote = "lote-h", invLote = "lote-h", monto = 200,
  invMonto = 200, asignadoValeId, sinLote = false } = {}) {
  const extra = { status: "asignado", batchId: invLote, asignadoA: "Persona Uno",
    asignadoEn: new Date("2026-10-15T12:00:00Z") };
  if (asignadoValeId !== undefined) extra.asignadoValeId = asignadoValeId;
  await sembrarFolio("117700", invMonto, extra);
  const datos = { ...valeDatos("117700", lote, "Persona Uno", monto), createdAt: new Date("2026-10-15T12:00:00Z") };
  if (sinLote) delete datos.batchId;
  await sembrarVale(valeId, datos);
  return { vale: await leer("vales", valeId), inv: await leer("inventario", "117700") };
}
async function intacto(valeId, antes) {
  assert.deepEqual(await leer("vales", valeId), antes.vale, "el vale no cambia");
  assert.deepEqual(await leer("inventario", "117700"), antes.inv, "el inventario no cambia");
}

await prueba("histórico con folio y lote correctos: se anula y el folio vuelve a disponible", async () => {
  await sembrarHistorico();
  const r = await comoApp([wAnular("H1"), wDevolver("117700", "H1")]);
  assert.ok(r.ok, "anulación histórica válida: " + JSON.stringify(r.body));
  const vale = await leer("vales", "H1");
  const inv = await leer("inventario", "117700");
  assert.equal(vale.anulado, true);
  assert.ok(vale.anuladoEn);
  assert.equal("esquema" in vale, false, "no se le añade esquema al anular");
  assert.equal(inv.status, "disponible");
  assert.equal(inv.batchId, null);
  assert.equal(inv.asignadoValeId, null);
  assert.equal(inv.devueltoPorVale, "H1");
  assert.equal(inv.monto, 200);
});

await prueba("histórico: el folio devuelto se puede reasignar a un vale nuevo", async () => {
  await sembrarHistorico();
  assert.ok((await comoApp([wAnular("H1"), wDevolver("117700", "H1")])).ok);
  await registrar("V2", "117700", "lote-2", "Persona Dos");
  assert.equal((await leer("inventario", "117700")).asignadoValeId, "V2");
});

await prueba("histórico: segunda anulación rechazada", async () => {
  await sembrarHistorico();
  assert.ok((await comoApp([wAnular("H1"), wDevolver("117700", "H1")])).ok);
  const antes = { vale: await leer("vales", "H1"), inv: await leer("inventario", "117700") };
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "re-anular histórico con devolución");
  rechazado(await comoApp([wAnular("H1")]), "re-anular histórico sin devolución");
  await intacto("H1", antes);
});

await prueba("histórico: segunda anulación tras reasignar el folio rechazada, el vale nuevo intacto", async () => {
  await sembrarHistorico();
  assert.ok((await comoApp([wAnular("H1"), wDevolver("117700", "H1")])).ok);
  await registrar("V2", "117700", "lote-2", "Persona Dos");
  const antes = { vale: await leer("vales", "V2"), inv: await leer("inventario", "117700") };
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "pantalla desactualizada");
  await intacto("V2", antes);
});

await prueba("histórico sin batchId: rechazado sin cambios", async () => {
  const antes = await sembrarHistorico({ sinLote: true });
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "sin batchId");
  rechazado(await comoApp([wAnular("H1")]), "sin batchId, sin devolver");
  await intacto("H1", antes);
});

await prueba("histórico con batchId vacío: rechazado sin cambios", async () => {
  const antes = await sembrarHistorico({ lote: "", invLote: "" });
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "batchId vacío");
  await intacto("H1", antes);
});

await prueba("histórico con batchId distinto al del inventario: rechazado sin cambios", async () => {
  const antes = await sembrarHistorico({ lote: "lote-x", invLote: "lote-h" });
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "lote distinto");
  await intacto("H1", antes);
});

await prueba("histórico con monto distinto al del folio: rechazado sin cambios", async () => {
  const antes = await sembrarHistorico({ monto: 500, invMonto: 200 });
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "monto distinto");
  await intacto("H1", antes);
});

await prueba("histórico cuyo folio tiene asignadoValeId de OTRO vale: rechazado sin cambios", async () => {
  const antes = await sembrarHistorico({ asignadoValeId: "OTRO" });
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "H1")]), "folio de otro vale");
  rechazado(await comoApp([wAnular("H1"), wDevolver("117700", "OTRO")]), "citando al otro vale");
  rechazado(await comoApp([wAnular("H1")]), "anular a secas");
  await intacto("H1", antes);
});

await prueba("histórico: devolver el folio SIN anular el vale, rechazado", async () => {
  const antes = await sembrarHistorico();
  rechazado(await comoApp([wDevolver("117700", "H1")]), "devolución suelta");
  await intacto("H1", antes);
});

await prueba("histórico: anular SIN devolver el folio, rechazado", async () => {
  const antes = await sembrarHistorico();
  rechazado(await comoApp([wAnular("H1")]), "anular dejando el folio asignado");
  await intacto("H1", antes);
});

await prueba("crear un vale nuevo SIN esquema imitando un histórico: rechazado", async () => {
  // Folio asignado como un histórico y un alta que copia su lote y monto.
  const antes = await sembrarHistorico({ valeId: "H1" });
  const imitacion = wCrearVale("FALSO", valeDatos("117700", "lote-h"));
  delete imitacion.update.fields.esquema;
  rechazado(await comoApp([imitacion]), "alta sin esquema");
  rechazado(await comoApp([imitacion, wDevolver("117700", "FALSO")]), "alta sin esquema + devolución");
  // Y en un folio libre, con su asignación, tampoco.
  await sembrarFolio("117701");
  const otra = wCrearVale("FALSO2", valeDatos("117701", "lote-z"));
  delete otra.update.fields.esquema;
  rechazado(await comoApp([otra, wAsignar("117701", "Persona Uno", "lote-z", "FALSO2")]), "alta sin esquema con asignación");
  rechazado(await comoApp([otra, wAsignar("117701", "Persona Uno", "lote-z")]), "alta sin esquema, asignación sin ID");
  assert.equal(await leer("vales", "FALSO"), null);
  assert.equal(await leer("vales", "FALSO2"), null);
  assert.equal((await leer("inventario", "117701")).status, "disponible");
  await intacto("H1", antes);
});

await prueba("vale esquema 2 no puede usar la ruta histórica (inventario sin asignadoValeId)", async () => {
  await sembrarFolio("117700", 200, { status: "asignado", batchId: "lote-h" });
  await sembrarVale("E2", { ...valeDatos("117700", "lote-h"), esquema: 2, createdAt: new Date() });
  const antes = { vale: await leer("vales", "E2"), inv: await leer("inventario", "117700") };
  rechazado(await comoApp([wAnular("E2"), wDevolver("117700", "E2")]), "esquema 2 por la ruta histórica");
  await intacto("E2", antes);
});

console.log(`\n✅ ${n} comprobaciones de reglas OK (emulador; vínculo por ID exacto)\n`);
