// Navegador real + app servida del repositorio. Firestore y config ficticios en
// memoria; ninguna petición externa. No prueba reglas de Firestore.
// Pulido de UI, de punta a punta:
//   1. doble toque en «Anular» → un solo PIN y un solo lote; tras un error el
//      candado se libera y se puede reintentar;
//   2. pedir un PIN con otro pendiente → el primero queda cancelado;
//   3. inventario vacío → aviso desde el inicio y sin confirmación;
//   4. dos toasts seguidos → el segundo dura su tiempo completo.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-pulido-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
// No guarda capturas. La comprobación unitaria está en tests/verify-pulido.mjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const AVISO_VACIO = 'No hay vales en inventario. Importa el PDF en la pestaña Inventario.';
const config = `
export const firebaseConfig = { projectId: 'demo-pulido' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Mariana Ejemplo',categoria:'Empleado',depto:'Pruebas'}];
`;
// Firestore en memoria. Tres vales vigentes, cada uno con su folio asignado, y
// dos folios libres. Los lotes SÍ se aplican (sólo a esta memoria), para ver el
// efecto real de anular. `window.__sinInventario` deja la colección vacía y
// `window.__commitFalla` hace que el siguiente lote sea rechazado.
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
export const doc = (_, col, id) => ({col,id});
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => Timestamp.now();
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const comun = {categoria:'Empleado', registradoPor:'Operador ficticio', fechaVale:Timestamp.now(), createdAt:Timestamp.now(), esquema:2, anulado:false};
const vale = (id, folio, nombre) => ({id, folio, qrCode:'COMBUSA-'+folio, nombre, monto:200, batchId:'lote-'+id, ...comun});
const vales = [vale('v1','117701','Vale Uno'), vale('v2','117702','Vale Dos'), vale('v3','117703','Vale Tres')];
const inventario = window.__sinInventario ? [] : [
  ...vales.map(v => ({folio:v.folio, monto:200, status:'asignado', batchId:v.batchId, asignadoValeId:v.id, vencimiento:'2099-12-31'})),
  {folio:'117710', monto:200, status:'disponible', vencimiento:'2099-12-31'},
  {folio:'117711', monto:500, status:'disponible', vencimiento:'2099-12-31'},
];
const tabla = (col) => col==='inventario' ? inventario : vales;
const clave = (col) => col==='inventario' ? 'folio' : 'id';
function rows(q){let a=tabla(q.col);for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
export async function getCountFromServer(q){window.__counts++;return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){return {docs:rows(q).map(d=>({id:d[clave(q.col)],data:()=>({...d})}))}}
export async function getDocFromServer(ref){const d=tabla(ref.col).find(x=>x[clave(ref.col)]===ref.id);return {exists:()=>!!d,data:()=>({...d}),metadata:{hasPendingWrites:false}}}
export function writeBatch(){
  window.__lotes++;
  const cambios=[];
  return {
    update(ref,data){cambios.push([ref,data])},
    set(ref,data){cambios.push([ref,data])},
    async commit(){
      window.__commits++;
      if(window.__commitFalla){window.__commitFalla=false;throw Object.assign(new Error('The service is currently unavailable.'),{code:'unavailable'})}
      for(const [ref,data] of cambios){const d=tabla(ref.col).find(x=>x[clave(ref.col)]===ref.id);if(d)Object.assign(d,data)}
    },
  };
}
export function updateDoc(){throw new Error('updateDoc no se usa en esta prueba')}
`;
// Generador de Excel de mentira: siempre falla, con un texto distinto cada vez.
// Es la forma de provocar toasts seguidos desde la interfaz.
const excel = `let n=0; export async function generarLibroExcel(){ throw new Error('fallo ficticio ' + (++n)); }`;

async function abrir(browser, { sinInventario }) {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await context.addInitScript((vacio)=>{
    sessionStorage.setItem('vales_unlocked','1');
    window.__sinInventario=vacio;window.__counts=0;window.__lotes=0;window.__commits=0;window.__commitFalla=false;window.__pines=[];
    // Cada vez que la app pide un PIN escribe la acción en #admin-pin-action.
    addEventListener('DOMContentLoaded',()=>{
      const el=document.querySelector('#admin-pin-action');
      // Un registro por cada escritura (el observador entrega varios de golpe
      // si dos peticiones llegan seguidas): se cuentan todos, no las entregas.
      new MutationObserver(regs=>{for(const r of regs)if(r.addedNodes.length)window.__pines.push(r.addedNodes[0].textContent)}).observe(el,{childList:true});
    });
  },sinInventario);
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const avisos=[];page.on('dialog',async d=>{avisos.push(d.message());await d.accept();});
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
    if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
    if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
    if(url.pathname==='/js/excel-export.js')return route.fulfill({contentType:'application/javascript',body:excel});
    if(url.pathname==='/') {
      const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/(id="registradoPor"[^>]*value=")[^"]*/, '$1Operador de prueba');
      return route.fulfill({contentType:'text/html',body:html});
    }
    return route.continue();
  });
  await page.goto(base);
  await page.waitForSelector('#vales-body tr');
  await page.waitForFunction(()=>document.querySelector('.denom-stock').textContent!=='Sin consultar');
  return {context,page,errors,avisos};
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  try {
    // =====================================================================
    //  Con inventario: anulación, PIN y toasts
    // =====================================================================
    {
      const {context,page,errors,avisos}=await abrir(browser,{sinInventario:false});
      const estado=()=>page.evaluate(()=>({lotes:window.__lotes,commits:window.__commits,pines:window.__pines.length}));
      const fila=(nombre)=>page.locator('#vales-body tr',{hasText:nombre});
      // Dos toques seguidos, sin esperar entre uno y otro (como un doble tap).
      const tocarAnular=(nombre,veces)=>fila(nombre).locator('.btn-anular').evaluate((b,n)=>{for(let i=0;i<n;i++)b.click();},veces);
      const pin=async()=>{
        await page.waitForSelector('#admin-pin-modal:not([hidden])');
        await page.fill('#admin-pin-input','0000');
        await page.click('#admin-pin-ok');
      };
      const toast=page.locator('#toast');

      // Con inventario no hay aviso de «vacío» y se puede registrar.
      assert.equal(await page.locator('#aviso-inventario-vacio').isHidden(),true);
      assert.equal(await page.locator('#btn-registrar').isDisabled(),false);

      // ---- 1a. Doble toque: un solo PIN y un solo lote -------------------
      await tocarAnular('Vale Uno',2);
      await pin();
      await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Vale anulado'));
      await page.waitForFunction(()=>document.querySelectorAll('#vales-body tr').length===2);
      assert.deepEqual(await estado(),{lotes:1,commits:1,pines:1},'un PIN y un lote');
      assert.equal(await page.locator('#admin-pin-modal').isHidden(),true,'no queda un segundo PIN esperando');
      assert.equal(await toast.innerText(),'✅ Vale anulado · folio 117,701 devuelto al inventario');
      assert.deepEqual(avisos,[]);

      // ---- 1b. Tras un error el candado se libera ------------------------
      await page.evaluate(()=>{window.__commitFalla=true;});
      await tocarAnular('Vale Dos',2);
      await pin();
      await page.waitForFunction(()=>window.__commits===2);
      await page.waitForFunction(()=>!window.__commitFalla);
      await expectLength(avisos,1);
      assert.deepEqual(avisos,['Sin conexión con el servidor. Revisa tu señal e inténtalo de nuevo.']);
      assert.deepEqual(await estado(),{lotes:2,commits:2,pines:2},'el doble toque del intento fallido también fue uno solo');
      assert.equal(await page.locator('#vales-body tr').count(),2,'el vale sigue vigente');
      // Reintento: si el candado se hubiera quedado puesto, este toque se ignoraría.
      await tocarAnular('Vale Dos',1);
      await pin();
      await page.waitForFunction(()=>document.querySelectorAll('#vales-body tr').length===1);
      assert.deepEqual(await estado(),{lotes:3,commits:3,pines:3});

      // ---- 2. PIN encimado: el primero queda cancelado -------------------
      await tocarAnular('Vale Tres',1);
      await page.waitForSelector('#admin-pin-modal:not([hidden])');
      assert.match(await page.locator('#admin-pin-action').innerText(),/^Anular el vale de "Vale Tres"/);
      // Con ese PIN abierto, otra acción pide el suyo (se dispara por código:
      // el modal tapa la pantalla, pero dos flujos pueden coincidir igual).
      const eleccion=page.waitForEvent('filechooser');
      await page.evaluate(()=>document.querySelector('#btn-importar-pdf').click());
      assert.match(await page.locator('#admin-pin-action').innerText(),/^Importar el PDF/);
      await page.fill('#admin-pin-input','0000');
      await page.click('#admin-pin-ok');
      await eleccion; // el PIN correcto fue para la importación...
      assert.equal(await page.locator('#admin-pin-modal').isHidden(),true);
      assert.equal((await estado()).lotes,3,'...y NO anuló el vale del PIN anterior');
      assert.equal(await page.locator('#vales-body tr').count(),1);
      // La anulación anterior no quedó colgada: resolvió «cancelado» y soltó su
      // candado, así que el mismo vale se puede volver a anular.
      await tocarAnular('Vale Tres',1);
      await page.waitForSelector('#admin-pin-modal:not([hidden])');
      assert.match(await page.locator('#admin-pin-action').innerText(),/^Anular el vale de "Vale Tres"/);
      await page.click('#admin-pin-cancel');
      assert.equal((await estado()).lotes,3);

      // ---- 4. Dos toasts seguidos ---------------------------------------
      await page.click('.tab[data-view="admin"]');
      const visible=()=>toast.evaluate(el=>!el.hidden&&el.classList.contains('show'));
      await page.waitForFunction(()=>document.querySelector('#toast').hidden); // sin toasts de antes
      await page.click('#btn-excel');
      await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('fallo ficticio 1'));
      // El segundo llega cuando el primero ya se está desvaneciendo (3 s + un poco).
      await page.waitForTimeout(3100);
      assert.equal(await toast.evaluate(el=>el.classList.contains('show')),false,'el primero ya se está ocultando');
      await page.click('#btn-excel');
      await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('fallo ficticio 2'));
      const inicio=Date.now();
      await page.waitForTimeout(600); // aquí el ocultado pendiente del primero lo escondía
      assert.equal(await visible(),true,'el segundo sigue a la vista');
      await page.waitForTimeout(1900);
      assert.equal(await visible(),true,'a los 2,5 s sigue a la vista');
      await page.waitForFunction(()=>document.querySelector('#toast').hidden);
      const duracion=Date.now()-inicio;
      assert.ok(duracion>=3000,`el segundo toast duró ${duracion} ms (debe durar sus 3 s)`);

      assert.deepEqual(errors,[]);
      await context.close();
    }

    // =====================================================================
    //  Sin inventario: aviso desde el inicio y sin confirmación
    // =====================================================================
    {
      const {context,page,errors}=await abrir(browser,{sinInventario:true});
      const aviso=page.locator('#aviso-inventario-vacio');
      assert.equal(await aviso.isVisible(),true,'el aviso está desde el inicio');
      assert.equal(await aviso.innerText(),AVISO_VACIO);
      assert.deepEqual(await page.locator('.denom-stock').allTextContents(),Array(4).fill('Agotado'));
      assert.equal(await page.locator('#btn-registrar').isDisabled(),true);
      // Aun con el formulario completo, «Registrar» no abre la confirmación...
      await page.selectOption('#persona','Mariana Ejemplo');
      await page.click('[data-monto="200"]');
      assert.equal(await page.locator('#btn-registrar').isDisabled(),true,'sigue bloqueado con vales en el carrito');
      assert.equal(await aviso.isVisible(),true);
      // ...ni siquiera enviando el formulario por otra vía (Enter, por ejemplo).
      await page.evaluate(()=>document.querySelector('#vale-form').dispatchEvent(new Event('submit',{cancelable:true})));
      await page.waitForFunction((t)=>document.querySelector('#form-error').textContent===t,AVISO_VACIO);
      assert.equal(await page.locator('#form-error').isVisible(),true);
      assert.equal(await page.locator('#confirm-modal').isHidden(),true,'la confirmación no se abre');
      assert.equal(await page.evaluate(()=>window.__lotes),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'sin scroll horizontal');
      assert.deepEqual(errors,[]);
      await context.close();
    }

    console.log(JSON.stringify({result:'OK',anular:'doble toque = 1 PIN y 1 lote; tras error se puede reintentar',pin:'el anterior queda cancelado',inventarioVacio:'aviso desde el inicio y sin confirmación',toasts:'el segundo dura sus 3 s'},null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

// Espera a que lleguen los diálogos (alert) que la app iba a mostrar.
async function expectLength(lista,n){
  for(let i=0;i<100&&lista.length<n;i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(lista.length,n);
}
