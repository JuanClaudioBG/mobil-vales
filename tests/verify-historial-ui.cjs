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
const out = path.join(root, 'docs/capturas-historial');
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
const history = [{folio:'117700',nombre:'Mariana Ejemplo con Apellidos Largos de Prueba',categoria:'Empleado',monto:500,registradoPor:'Operador ficticio',notas:'Entrega de prueba',fechaVale:Timestamp.now(),createdAt:Timestamp.now(),qrCode:'COMBUSA-117700'}, {nombre:'Persona Histórica',categoria:'Familia',monto:200,registradoPor:'Operador ficticio',fechaVale:Timestamp.now(),createdAt:Timestamp.now(),qrCode:'LEGACY-DEMO'}];
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
      await page.evaluate(()=>{
        window.__holdCounts=false;
        const c=document.createElement('canvas');c.width=64;c.height=64;
        const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,64,64);x.fillStyle='black';x.fillRect(8,8,24,24);
        window.__fixtureQr=c.toDataURL('image/png').split(',')[1];
      });
      await page.waitForSelector('#vales-body tr');
      await page.fill('#filtro-mes','');
      assert.equal(await page.locator('#vales-body tr').count(),2);
      assert.equal(await page.locator('.hist-folio').last().innerText(),'Sin folio');
      const name=await page.locator('.hist-nombre').first().boundingBox();
      const amount=await page.locator('.hist-monto').first().boundingBox();
      assert.ok(name.height>35 && name.x+name.width<=amount.x && amount.x+amount.width<=width);
      assert.equal(await page.locator('.hist-nombre').first().evaluate(el=>getComputedStyle(el).overflowWrap),'normal');
      await page.locator('#filtro-mes').blur();
      await page.locator('#vales-body').evaluate(el=>el.closest('.card').scrollIntoView({block:'start'}));
      await page.screenshot({path:path.join(out,`historial-${width}.png`)});
      for(const query of ['117700','117,700']) {
        await page.fill('#filtro-nombre',query);
        assert.equal(await page.locator('#vales-body tr').count(),1);
        assert.match(await page.locator('.hist-folio').innerText(),/117,700/);
      }
      await page.locator('#vales-body .btn-ver').click();
      await page.waitForSelector('#qr-modal:not([hidden])');
      await page.waitForSelector('#qr-canvas canvas');
      assert.equal(await page.evaluate(()=>window.__qrRead),'117700');
      assert.equal(await page.locator('#qr-canvas canvas').evaluate(el=>el.toDataURL('image/png').split(',')[1]),await page.evaluate(()=>window.__fixtureQr));
      assert.match(await page.locator('#qr-code').innerText(),/117,700/);
      assert.equal(await page.locator('#vales-body .btn-anular').count(),1);
      assert.equal(await page.evaluate(()=>window.__writes),0);
      assert.deepEqual(errors,[]);
      results.push({width,result:'OK',longName:true,legacy:true,searchWithComma:true,qrFolio:'117700',writes:0});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
