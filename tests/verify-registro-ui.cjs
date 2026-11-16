// Navegador real + app servida del repositorio. Firestore y config ficticios;
// ninguna petición externa ni escritura. No prueba reglas de Firestore.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-registro-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const out = path.join(root, 'docs/capturas-registro');
const config = `
export const firebaseConfig = { projectId: 'demo-registro-ui' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Mariana Ejemplo',categoria:'Empleado',depto:'Pruebas'},
{nombre:'Persona Ficticia con Nombre Largo de Prueba',categoria:'Familia',depto:'Pruebas'}];
`;
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
export const doc = (_, col, id) => ({col,id});
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => ({});
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const inventory = [200,300,500].flatMap((monto,index) => Array.from({length:[24,6,4][index]},(_,i)=>({folio:String(117700+index*100+i),monto,status:'disponible',vencimiento:'2099-12-31'})));
function rows(q){let a=q.col==='inventario'?inventory:[];for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
async function delay(){await new Promise(r=>setTimeout(r,150));while(window.__holdCounts)await new Promise(r=>setTimeout(r,20))}
export async function getCountFromServer(q){window.__counts++;await delay();if(window.__failCounts)throw Object.assign(new Error('Fallo ficticio'),{code:'permission-denied'});return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){await new Promise(r=>setTimeout(r,50));window.__reads++;return {docs:rows(q).map(d=>({id:d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(){throw new Error('Lectura individual inesperada')}
export function writeBatch(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
export function updateDoc(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
`;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const results=[];
  try {
    for(const width of [360,390]) {
      const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await context.addInitScript(()=>{sessionStorage.setItem('vales_unlocked','1');window.__counts=0;window.__reads=0;window.__writes=0;window.__holdCounts=true;});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*', async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
        if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
        if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
        if(url.pathname==='/') {
          const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/(id="registradoPor"[^>]*value=")[^"]*/, '$1Operador de prueba');
          return route.fulfill({contentType:'text/html',body:html});
        }
        return route.continue();
      });
      await page.goto(base);
      await page.waitForSelector('.denom-stock');
      assert.deepEqual(await page.locator('.denom-stock').allTextContents(),Array(4).fill('Sin consultar'));
      await page.evaluate(()=>window.__holdCounts=false);
      await page.waitForFunction(()=>document.querySelector('.denom-stock').textContent==='24 disponibles');
      assert.deepEqual(await page.locator('.denom-stock').allTextContents(),['24 disponibles','6 disponibles','4 disponibles','Agotado']);
      assert.equal(await page.evaluate(()=>window.__counts),5,'mostrar stock no añade consultas');
      await page.selectOption('#persona','Mariana Ejemplo');
      assert.equal(await page.locator('#persona').inputValue(),'Mariana Ejemplo');
      assert.equal(await page.locator('#persona-resumen').innerText(),'Empleado','el resumen no repite el nombre');
      assert.equal(await page.locator('#cat-auto').innerText(),'Empleado');
      await page.click('[data-monto="200"]');
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 1 vale · $200');
      await page.click('[data-monto="200"]');await page.click('[data-monto="500"]');
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 3 vales · $900');
      const clear=await page.locator('#btn-limpiar').boundingBox();
      const breakdown=await page.locator('#carrito-lista').boundingBox();
      const total=await page.locator('.carrito-footer').boundingBox();
      assert.ok(clear.x>=breakdown.x+breakdown.width && clear.y<breakdown.y+breakdown.height,'Limpiar está junto al desglose');
      assert.ok(clear.y+clear.height<=total.y,'Limpiar no ocupa una fila bajo el total');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(out,`registro-${width}.png`)});
      await page.evaluate(()=>window.__holdCounts=true);
      await page.click('#btn-registrar');
      assert.match(await page.locator('#btn-registrar').innerText(),/Consultando inventario…/);
      assert.equal(await page.locator('#btn-registrar').isDisabled(),true);
      await page.evaluate(()=>document.querySelector('#vale-form').dispatchEvent(new Event('submit',{cancelable:true})));
      assert.equal(await page.evaluate(()=>window.__counts),10,'doble envío no repite consultas');
      await page.evaluate(()=>window.__holdCounts=false);
      await page.waitForSelector('#confirm-modal:not([hidden])');
      assert.deepEqual(await page.locator('#c-folios li').allTextContents(),['$200 · Folio 117,700','$200 · Folio 117,701','$500 · Folio 117,900']);
      assert.equal(await page.locator('#c-total').innerText(),'$900');
      await page.screenshot({path:path.join(out,`confirmacion-${width}.png`)});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const card=await page.locator('#confirm-modal .modal-card').boundingBox();
      assert.ok(card.x>=0 && card.x+card.width<=width);
      await page.click('#btn-cancelar');
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 3 vales · $900');
      await page.locator('.denom-item').filter({has:page.locator('[data-monto="500"]')}).locator('.denom-minus').click();
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 2 vales · $400');
      await page.click('#btn-limpiar');
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar vales');
      await page.selectOption('#persona','Persona Ficticia con Nombre Largo de Prueba');
      for(let i=0;i<20;i++) await page.click('[data-monto="200"]');
      assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 20 vales · $4,000');
      await page.click('#btn-registrar');await page.waitForSelector('#confirm-modal:not([hidden])');
      assert.equal(await page.locator('#c-folios li').count(),20);
      await page.setViewportSize({width,height:640});
      assert.deepEqual(await page.locator('#c-folios li').allTextContents(),Array.from({length:20},(_,i)=>`$200 · Folio ${String(117700+i).replace(/\B(?=(\d{3})+$)/g,',')}`));
      // Revisar cada renglón dentro del área desplazable, no sólo contar nodos.
      for(let i=0;i<20;i++) {
        const row=page.locator('#c-folios li').nth(i);
        await row.scrollIntoViewIfNeeded();
        const visible=await row.evaluate(el=>{
          const r=el.getBoundingClientRect(), list=el.parentElement.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return r.top>=Math.max(0,list.top)-1 && r.bottom<=Math.min(innerHeight,list.bottom)+1 && el.contains(hit);
        });
        assert.ok(visible,`folio ${i+1}/20 legible a ${width}px`);
      }
      assert.ok(await page.locator('#c-folios').evaluate(el=>el.scrollTop>0),'se recorrió la lista hasta el final');
      for(const id of ['#btn-cancelar','#btn-confirmar']) {
        await page.locator(id).scrollIntoViewIfNeeded();
        const button=await page.locator(id).boundingBox();
        assert.ok(button.y>=0 && button.y+button.height<=640,`${id} accesible con 20 vales`);
        await page.locator(id).click({trial:true}); // Comprueba que se puede tocar, sin guardar.
      }
      await page.screenshot({path:path.join(out,`confirmacion-20-${width}.png`)});
      await page.click('#btn-cancelar');await page.click('#btn-limpiar');
      await page.click('[data-monto="1000"]');await page.click('#btn-registrar');
      await page.waitForSelector('#form-error:not([hidden])');
      assert.equal(await page.locator('#confirm-modal').isVisible(),false,'stock cero bloquea confirmación');
      await page.evaluate(()=>window.__failCounts=true);
      await page.click('#btn-registrar');
      await page.waitForFunction(()=>document.querySelector('.denom-stock').textContent==='Sin consultar');
      assert.deepEqual(await page.locator('.denom-stock').allTextContents(),Array(4).fill('Sin consultar'));
      assert.equal(await page.locator('#confirm-modal').isVisible(),false);
      assert.match(await page.locator('#form-error').innerText(),/consultar/i);
      assert.equal(await page.locator('#btn-registrar').isDisabled(),false);
      assert.equal(await page.evaluate(()=>window.__writes),0);
      assert.deepEqual(errors,[]);
      results.push({width,result:'OK',foliosRevisados:20,cancelarYConfirmar:'accesibles a 640px de alto',screenshots:[`registro-${width}.png`,`confirmacion-${width}.png`,`confirmacion-20-${width}.png`],writes:0});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
