// Navegador real + app servida del repositorio. Firestore y config ficticios;
// ninguna petición externa. Los commits los controla la prueba: tardan más que
// el tiempo de espera y luego se confirman o se rechazan. No prueba reglas.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-guardado-incierto-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
// Capturas en VALES_CAPTURAS (por omisión, docs/capturas-guardado-incierto).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const out = process.env.VALES_CAPTURAS || path.join(root, 'docs/capturas-guardado-incierto');
const config = `
export const firebaseConfig = { projectId: 'demo-guardado-incierto' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Persona Ficticia con Nombre Largo de Prueba',categoria:'Empleado',depto:'Pruebas'}];
`;
// SDK simulado. Cada batch.commit() deja una promesa en window.__commits que
// la prueba resuelve o rechaza a mano. getDocFromServer de un vale responde
// según window.__valesServidor (id -> batchId).
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
let auto = 0;
export const doc = (a, col, id) => col === undefined ? {col:a.col, id:'AUTO' + (++auto)} : {col,id};
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => ({});
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const inventory = [200,300,500].flatMap((monto,index) => Array.from({length:[24,6,4][index]},(_,i)=>({folio:String(117700+index*100+i),monto,status:'disponible',vencimiento:'2099-12-31'})));
function rows(q){let a=q.col==='inventario'?inventory:[];for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
export async function getCountFromServer(q){window.__counts++;await new Promise(r=>setTimeout(r,20));return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){await new Promise(r=>setTimeout(r,20));window.__reads++;return {docs:rows(q).map(d=>({id:d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(ref){
  window.__docReads.push(ref.col + '/' + ref.id);
  if(ref.col!=='vales') throw new Error('Lectura individual inesperada: ' + ref.col);
  const lote = window.__valesServidor[ref.id];
  return {id:ref.id, exists:()=>Boolean(lote), metadata:{hasPendingWrites:false}, data:()=>({batchId:lote})};
}
export function writeBatch(){
  const ops = [];
  return {
    set(ref,data){ops.push({tipo:'set',id:ref.id,batchId:data.batchId})},
    update(ref,data){ops.push({tipo:'update',folio:ref.id})},
    commit(){
      let resolve, reject;
      const p = new Promise((res,rej)=>{resolve=res;reject=rej});
      // Confirmar aplica el lote entero (folios asignados); rechazar, nada.
      const confirmar = () => {
        for (const o of ops) if (o.tipo==='update') inventory.find(d=>d.folio===o.folio).status='asignado';
        resolve();
      };
      window.__commits.push({ops,resolve:confirmar,reject});
      return p;
    },
  };
}
export function updateDoc(){throw new Error('updateDoc inesperado en esta prueba')}
`;
const MSG_TARDA = /El guardado está tardando más de lo normal y sigue en curso/;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const results=[];
  try {
    for(const width of [360,430]) {
      const context=await browser.newContext({viewport:{width,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await context.addInitScript(()=>{sessionStorage.setItem('vales_unlocked','1');Object.assign(window,{__counts:0,__reads:0,__commits:[],__docReads:[],__valesServidor:{}});});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*', async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
        if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
        if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
        // Sólo en la prueba: tiempo de espera de 30 s → 600 ms y pausa de reintento corta.
        if(url.pathname==='/js/utils.js') {
          const src=fs.readFileSync(path.join(root,'js/utils.js'),'utf8');
          const corto=src.replace('FIRESTORE_TIMEOUT_MS = 30_000','FIRESTORE_TIMEOUT_MS = 600').replace('RETRY_DELAY_MS = 2_500','RETRY_DELAY_MS = 50');
          assert.notEqual(corto,src,'no se pudo acortar el tiempo de espera');
          return route.fulfill({contentType:'application/javascript',body:corto});
        }
        if(url.pathname==='/') {
          const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/(id="registradoPor"[^>]*value=")[^"]*/, '$1Operador de prueba');
          return route.fulfill({contentType:'text/html',body:html});
        }
        return route.continue();
      });
      await page.goto(base);
      await page.waitForFunction(()=>document.querySelector('.denom-stock').textContent==='24 disponibles');
      const btn=page.locator('#btn-registrar'), aviso=page.locator('#guardado-incierto');
      const comprobar=page.locator('#btn-comprobar-guardado');
      assert.equal(await aviso.isVisible(),false,'el aviso arranca oculto');

      // Llena el formulario y llega hasta el commit, que se queda colgado.
      const registrarYConfirmar=async()=>{
        await page.selectOption('#persona','Persona Ficticia con Nombre Largo de Prueba');
        await page.click('[data-monto="200"]');await page.click('[data-monto="500"]');
        assert.equal(await btn.innerText(),'Registrar 2 vales · $700');
        await btn.click();
        await page.waitForSelector('#confirm-modal:not([hidden])');
        await page.click('#btn-confirmar');
        await aviso.waitFor({state:'visible'});
      };
      const noHayScrollHorizontal=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

      // ---- 1. Tarda más que el timeout y luego SE CONFIRMA -------------------
      await registrarYConfirmar();
      assert.match(await aviso.innerText(),MSG_TARDA);
      assert.equal(await btn.isDisabled(),true);
      assert.equal((await btn.innerText()).trim(),'Verificando guardado anterior…');
      assert.equal(await page.locator('#confirm-modal').isVisible(),false);
      assert.equal(await page.locator('#form-error').isVisible(),false,'no se pinta como error');
      assert.equal(await page.evaluate(()=>window.__commits.length),1);
      const lote1=await page.evaluate(()=>window.__commits[0].ops);
      assert.deepEqual(lote1.filter(o=>o.tipo==='update').map(o=>o.folio),['117700','117900']);
      // El aviso cabe y el botón se puede tocar.
      assert.equal(await noHayScrollHorizontal(),true);
      await aviso.scrollIntoViewIfNeeded();
      const caja=await aviso.boundingBox(), boton=await comprobar.boundingBox();
      assert.ok(caja.x>=0 && caja.x+caja.width<=width,`aviso dentro de ${width}px`);
      assert.ok(boton.height>=44,'blanco táctil de al menos 44px');
      await page.screenshot({path:path.join(out,`aviso-${width}.png`)});

      // Intentos de registrar otro lote: ni reserva ni commit.
      const antes=await page.evaluate(()=>({counts:window.__counts,reads:window.__reads}));
      await page.evaluate(()=>document.querySelector('#vale-form').dispatchEvent(new Event('submit',{cancelable:true})));
      await page.evaluate(()=>document.querySelector('#btn-confirmar').click());
      await page.click('[data-monto="300"]'); // tocar el carrito no desbloquea
      assert.equal(await btn.isDisabled(),true);
      assert.equal((await btn.innerText()).trim(),'Verificando guardado anterior…');
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(()=>({counts:window.__counts,reads:window.__reads})),antes,'no se consultó ni reservó otra vez');
      assert.equal(await page.locator('#confirm-modal').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.__commits.length),1,'no hubo segundo batch');
      await page.locator('.denom-item').filter({has:page.locator('[data-monto="300"]')}).locator('.denom-minus').click();

      // «Comprobar ahora» sin el vale en el servidor: sigue bloqueado y lo dice.
      await comprobar.click();
      await page.waitForFunction(()=>/Todavía no aparece confirmado/.test(document.querySelector('#guardado-incierto').innerText));
      assert.deepEqual(await page.evaluate(()=>window.__docReads),['vales/'+lote1.find(o=>o.tipo==='set').id],'una lectura del primer vale');
      assert.equal(await btn.isDisabled(),true);
      assert.equal(await comprobar.isDisabled(),false);
      assert.equal(await page.evaluate(()=>window.__commits.length),1,'comprobar no escribe');
      assert.equal(await noHayScrollHorizontal(),true);
      await page.screenshot({path:path.join(out,`sin-confirmar-${width}.png`)});

      // Llega la confirmación tardía → éxito normal.
      await page.evaluate(()=>window.__commits[0].resolve());
      await page.waitForSelector('#qr-modal:not([hidden])');
      assert.match(await page.locator('#toast').innerText(),/2 vales registrados — \$700 total/);
      assert.equal(await aviso.isVisible(),false);
      assert.equal(await page.locator('#qr-progress').innerText(),'Vale 1 de 2');
      assert.match(await page.locator('#qr-code').innerText(),/117,700/);
      assert.equal(await page.locator('#persona').inputValue(),'','formulario reiniciado');
      assert.equal(await btn.isDisabled(),false);
      assert.equal(await btn.innerText(),'Registrar vales','carrito vacío');
      await page.screenshot({path:path.join(out,`exito-tardio-${width}.png`)});
      await page.click('#qr-next');await page.click('#qr-next'); // cierra tras el último
      await page.waitForSelector('#qr-modal',{state:'hidden'});

      // ---- 2. Tarda más que el timeout y luego SE RECHAZA --------------------
      await registrarYConfirmar();
      assert.equal(await page.evaluate(()=>window.__commits.length),2);
      const lote2=await page.evaluate(()=>window.__commits[1].ops);
      assert.deepEqual(lote2.filter(o=>o.tipo==='update').map(o=>o.folio),['117701','117901'],'el primer lote ya consumió 117700/117900');
      assert.equal(await btn.isDisabled(),true);
      await page.evaluate(()=>window.__commits[1].reject(Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})));
      await page.waitForSelector('#form-error:not([hidden])');
      assert.equal(await page.locator('#form-error').innerText(),'No tienes permiso para guardar el registro o el registro cambió. Pulsa «Actualizar» e inténtalo de nuevo; si sigue, avisa al administrador.');
      assert.equal(await aviso.isVisible(),false);
      assert.equal(await page.locator('#qr-modal').isVisible(),false);
      assert.equal(await btn.isDisabled(),false);
      assert.equal(await btn.innerText(),'Registrar 2 vales · $700','el carrito queda para reintentar a mano');
      assert.equal(await noHayScrollHorizontal(),true);
      await page.locator('#form-error').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(out,`rechazo-tardio-${width}.png`)});

      // ---- 3. «Comprobar ahora» encuentra el vale antes que la respuesta ----
      await btn.click();
      await page.waitForSelector('#confirm-modal:not([hidden])');
      await page.click('#btn-confirmar');
      await aviso.waitFor({state:'visible'});
      const lote3=await page.evaluate(()=>window.__commits[2].ops);
      const primerId=lote3.find(o=>o.tipo==='set').id;
      await page.evaluate(([id,b])=>{window.__valesServidor[id]=b;},[primerId,lote3.find(o=>o.tipo==='set').batchId]);
      await comprobar.click();
      await page.waitForSelector('#qr-modal:not([hidden])');
      assert.equal(await aviso.isVisible(),false);
      assert.equal(await btn.isDisabled(),false);
      assert.equal(await page.evaluate(()=>window.__docReads.at(-1)),'vales/'+primerId);
      await page.evaluate(()=>window.__commits[2].resolve()); // llega después: no duplica
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#qr-progress').innerText(),'Vale 1 de 2','no se reabrió ni duplicó el QR');

      assert.equal(await page.evaluate(()=>window.__commits.length),3,'un commit por registro, sin reintentos');
      assert.deepEqual(errors,[]);
      results.push({width,result:'OK',escenarios:['tarda→confirma','tarda→rechaza','comprobar→encontrado'],commits:3,capturas:[`aviso-${width}.png`,`sin-confirmar-${width}.png`,`exito-tardio-${width}.png`,`rechazo-tardio-${width}.png`]});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
