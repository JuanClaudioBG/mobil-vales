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
const out = path.join(root, 'docs/capturas-inventario');
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
function day(offset){const d=new Date();d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
const inventory=[{folio:'007765',monto:200,vencimiento:day(15)},{folio:'117700',monto:500,vencimiento:day(-1)},{folio:'117701',monto:300,vencimiento:null}].map(v=>({...v,status:'disponible',importadoEn:Timestamp.now(),importadoPor:'Operador ficticio'}));
const history = [{folio:'117700',nombre:'Mariana Ejemplo con Apellidos Largos de Prueba',categoria:'Empleado',monto:500,registradoPor:'Operador ficticio',notas:'Entrega de prueba',fechaVale:Timestamp.now(),createdAt:Timestamp.now(),qrCode:'COMBUSA-117700'}, {nombre:'Persona Histórica',categoria:'Familia',monto:200,registradoPor:'Operador ficticio',fechaVale:Timestamp.now(),createdAt:Timestamp.now(),qrCode:'LEGACY-DEMO'}];
inventory.push({folio:'117702',monto:500,status:'asignado',vencimiento:null,asignadoA:'Persona de prueba',asignadoEn:Timestamp.now(),importadoEn:Timestamp.now()});
function rows(q){let a=q.col==='inventario'?inventory:history;for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
async function delay(){await new Promise(r=>setTimeout(r,150));while(window.__holdCounts)await new Promise(r=>setTimeout(r,20))}
export async function getCountFromServer(q){window.__counts++;await delay();if(window.__failCounts)throw Object.assign(new Error('Fallo ficticio'),{code:'permission-denied'});return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){await new Promise(r=>setTimeout(r,50));window.__reads++;return {docs:rows(q).map(d=>({id:d.folio||'historico',data:()=>({...d})}))}}
export async function getDocFromServer(ref){window.__qrRead=ref.id;return {exists:()=>true,data:()=>({qrImageBase64:window.__fixtureQr,vencimiento:'2099-12-31'})}}
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
      await page.evaluate(()=>window.__holdCounts=false);
      await page.click('[data-view="inventario"]');
      await page.waitForSelector('#inv-body tr');
      await page.selectOption('#inv-filtro-status','');
      assert.equal(await page.locator('#inv-body tr').count(),4);
      assert.equal(await page.locator('.inv-vence-pronto').count(),1);
      assert.equal(await page.locator('#inv-body .badge--vencido').count(),1);
      assert.equal(await page.locator('.inv-vencimiento').filter({hasText:'Sin fecha de vencimiento'}).count(),2);
      const available=page.locator('#inv-body tr').filter({hasText:'007,765'});
      assert.equal(await available.locator('td:visible').count(),3);
      const assigned=page.locator('#inv-body tr').filter({hasText:'117,702'});
      assert.equal(await assigned.locator('td:nth-child(5)').isVisible(),true);
      assert.equal(await assigned.locator('td:nth-child(5)').innerText(),'Persona de prueba');
      assert.equal(await assigned.locator('td:nth-child(6)').isVisible(),true);
      assert.notEqual(await assigned.locator('td:nth-child(6)').innerText(),'—');
      const search=await page.locator('#inv-buscar').boundingBox();
      const imports=await page.locator('#inv-filtro-lote').boundingBox();
      assert.ok(search.y<imports.y);
      const reads=await page.evaluate(()=>window.__reads);
      for(const q of ['007765','007,765']) {
        await page.fill('#inv-buscar',q);
        assert.equal(await page.locator('#inv-body tr').count(),1);
        assert.equal(await page.locator('#inv-body .inv-folio').innerText(),'007,765');
      }
      await page.fill('#inv-buscar','');
      assert.equal(await page.evaluate(()=>window.__reads),reads);
      await page.locator('#inv-buscar').blur();
      await page.screenshot({path:path.join(out,`inventario-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>window.__writes),0);
      assert.deepEqual(errors,[]);
      results.push({width,result:'OK',searchWithComma:true,leadingZeros:true,newSearchReads:0,writes:0});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
