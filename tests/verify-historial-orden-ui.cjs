// Navegador real + app servida del repositorio. Firestore y config ficticios;
// ninguna petición externa ni escritura. No prueba reglas de Firestore.
// «Ver» del Historial reabre TODA la orden del vale (mismo batchId), en la
// posición del vale tocado.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-historial-orden-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
// Capturas a 390 px en VALES_CAPTURAS (por omisión, fuera del repo:
// ../capturas-archivo/historial-orden).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const out = process.env.VALES_CAPTURAS || path.resolve(root, '../capturas-archivo/historial-orden');
const width = 390;
const config = `
export const firebaseConfig = { projectId: 'demo-historial-orden' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Mariana Ejemplo',categoria:'Empleado',depto:'Pruebas'}];
`;
// Historial ficticio del mes en curso. Dentro de cada orden los vales van
// DESORDENADOS a propósito: el modal tiene que ordenarlos por folio.
//   orden-a  3 vales vigentes.
//   orden-b  3 vales, el de en medio anulado.
//   orden-c  2 con folio y 2 sin folio (código generado), intercalados.
//   orden-f  2 vales; la fecha de uno se puede «romper» para forzar el fallo.
//   sueltos  sin batchId, con batchId vacío y con batchId que no es texto.
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
export const doc = (_, col, id) => ({col,id});
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => ({});
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const hoy = new Date(); hoy.setHours(12,0,0,0);
const dia = (n) => { const d = new Date(hoy); d.setDate(Math.max(1, hoy.getDate() - n)); return Timestamp.fromDate(d); };
// Fecha que deja de poder leerse cuando la prueba lo pide: así falla la
// preparación de UN vale de la orden sin tocar la app.
const fechaFragil = { toDate(){ if (window.__romperFecha) throw new Error('fecha ilegible (prueba)'); return hoy; } };
const base = {registradoPor:'Operador ficticio', createdAt: dia(0), categoria:'Empleado'};
const conFolio = (id, folio, extra) => ({id, folio, qrCode:'COMBUSA-'+folio, vencimiento:'2099-12-31', fechaVale:dia(0), ...base, ...extra});
const sinFolio = (id, codigo, extra) => ({id, qrCode:codigo, fechaVale:dia(0), ...base, ...extra});
const history = [
  conFolio('a3','117712',{nombre:'Orden De Tres', monto:1000, batchId:'orden-a'}),
  conFolio('a1','117710',{nombre:'Orden De Tres', monto:200, batchId:'orden-a'}),
  conFolio('a2','117711',{nombre:'Orden De Tres', monto:500, batchId:'orden-a'}),
  conFolio('b3','117722',{nombre:'Orden Con Anulado', monto:500, batchId:'orden-b'}),
  conFolio('b2','117721',{nombre:'Orden Con Anulado', monto:300, batchId:'orden-b', anulado:true}),
  conFolio('b1','117720',{nombre:'Orden Con Anulado', monto:200, batchId:'orden-b'}),
  sinFolio('c1','SPECTRO-FUEL-2026-CCCC0001',{nombre:'Orden Mixta', monto:200, batchId:'orden-c'}),
  conFolio('c2','117731',{nombre:'Orden Mixta', monto:300, batchId:'orden-c'}),
  sinFolio('c3','SPECTRO-FUEL-2026-CCCC0003',{nombre:'Orden Mixta', monto:500, batchId:'orden-c'}),
  conFolio('c4','117730',{nombre:'Orden Mixta', monto:1000, batchId:'orden-c'}),
  conFolio('f1','117750',{nombre:'Orden Que Falla', monto:200, batchId:'orden-f'}),
  conFolio('f2','117751',{nombre:'Orden Que Falla', monto:300, batchId:'orden-f', fechaVale:fechaFragil}),
  conFolio('s1','117740',{nombre:'Vale Suelto', monto:500}),
  conFolio('e1','117760',{nombre:'Lote Vacio', monto:200, batchId:''}),
  conFolio('e2','117761',{nombre:'Lote Vacio', monto:300, batchId:''}),
  conFolio('n1','117770',{nombre:'Lote Numerico', monto:200, batchId:7}),
  conFolio('n2','117771',{nombre:'Lote Numerico', monto:300, batchId:7}),
];
function rows(q){let a=q.col==='inventario'?[]:history;for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
// QR de mentira (no es un código válido): rejilla derivada del folio, sólo
// para que la captura se parezca a la pantalla real.
function qrFicticio(folio){
  const n=25, px=12, c=document.createElement('canvas'); c.width=c.height=n*px;
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.fillStyle='#000';
  let s=Number(folio)||1; const azar=()=>(s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(azar()>0.5)x.fillRect(i*px,j*px,px,px);
  x.fillStyle='#fff'; x.fillRect(0,c.height/2-22,c.width,44);
  x.fillStyle='#000'; x.font='bold 22px sans-serif'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText('PRUEBA '+folio,c.width/2,c.height/2);
  return c.toDataURL('image/png').split(',')[1];
}
export async function getCountFromServer(q){window.__counts++;return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){window.__reads++;return {docs:rows(q).map(d=>({id:d.id||d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(ref){window.__docReads.push(ref.col+'/'+ref.id);return {exists:()=>true,data:()=>({vencimiento:'2099-12-31',qrImageBase64:qrFicticio(ref.id)})}}
export function writeBatch(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
export function updateDoc(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
`;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    await context.addInitScript(()=>{sessionStorage.setItem('vales_unlocked','1');window.__reads=0;window.__counts=0;window.__writes=0;window.__docReads=[];window.__romperFecha=false;});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const avisos=[];page.on('dialog',async d=>{avisos.push(d.message());await d.accept();});
    await context.route('**/*', async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
      if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
      if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
      return route.continue();
    });
    await page.goto(base);
    await page.waitForSelector('#vales-body tr');

    const modal=page.locator('#qr-modal');
    const progreso=page.locator('#qr-progress');
    const anterior=page.locator('#qr-prev');
    const siguiente=page.locator('#qr-next');
    const fila=(folio)=>page.locator('#vales-body tr',{hasText:folio});
    // Abre «Ver» de la fila que contiene ese texto y espera al modal.
    const ver=async(texto)=>{
      await fila(texto).locator('.btn-ver').click();
      await page.waitForSelector('#qr-modal:not([hidden])');
    };
    // Lo que identifica al vale en pantalla: «Folio: 117,710» o el código.
    const codigo=async()=>(await page.locator('#qr-code').innerText()).replace(/^Folio:\s*/,'');
    const cerrar=async()=>{
      await page.keyboard.press('Escape');
      await page.waitForSelector('#qr-modal',{state:'hidden'});
    };
    const captura=async(nombre)=>{
      // Con folio se espera a la imagen; los de código generado quedan en texto.
      if(/^\d/.test(await codigo()))await page.waitForSelector('#qr-canvas canvas');
      await page.screenshot({path:path.join(out,`${nombre}-${width}.png`)});
    };
    // Recorre la orden abierta desde el primero hasta el último vale.
    const recorrer=async()=>{
      while(await anterior.isVisible())await anterior.click();
      const vistos=[await codigo()];
      while((await siguiente.innerText())!=='Cerrar'){await siguiente.click();vistos.push(await codigo());}
      return vistos;
    };

    const lecturas=await page.evaluate(()=>({reads:window.__reads,counts:window.__counts}));
    assert.equal(await page.locator('#vales-body tr').count(),16,'16 vigentes; el anulado no se lista');
    await page.locator('#vales-body').evaluate(el=>el.closest('.card').scrollIntoView({block:'start'}));
    await page.screenshot({path:path.join(out,`01-historial-${width}.png`)});

    // ---- Orden de 3: abre en el vale tocado (el 2.º) y se navega a los 3 ----
    await ver('117,711');
    assert.equal(await progreso.isVisible(),true);
    assert.equal(await progreso.innerText(),'Vale 2 de 3');
    assert.equal(await codigo(),'117,711','abre en el vale tocado');
    assert.equal(await page.locator('#qr-monto').innerText(),'$500');
    assert.equal(await anterior.isVisible(),true);
    assert.equal(await siguiente.innerText(),'Siguiente →');
    await captura('02-orden-de-3-abre-en-el-2');
    await anterior.click();
    assert.equal(await progreso.innerText(),'Vale 1 de 3');
    assert.equal(await codigo(),'117,710');
    assert.equal(await anterior.isVisible(),false);
    await siguiente.click();
    await siguiente.click();
    assert.equal(await progreso.innerText(),'Vale 3 de 3');
    assert.equal(await codigo(),'117,712');
    assert.equal(await siguiente.innerText(),'Cerrar');
    await captura('03-orden-de-3-ultimo');
    await siguiente.click(); // «Cerrar» en el último
    await page.waitForSelector('#qr-modal',{state:'hidden'});
    // Tocando el primero o el último, la misma orden abre en su posición.
    await ver('117,710');
    assert.equal(await progreso.innerText(),'Vale 1 de 3');
    await cerrar();
    await ver('117,712');
    assert.equal(await progreso.innerText(),'Vale 3 de 3');
    assert.deepEqual(await recorrer(),['117,710','117,711','117,712'],'por folio ascendente');
    await cerrar();

    // ---- Orden con 1 anulado: se excluye al abrir uno vigente ------------
    await ver('117,722');
    assert.equal(await progreso.innerText(),'Vale 2 de 2');
    assert.equal(await codigo(),'117,722');
    assert.equal(await page.locator('#qr-anulado').isVisible(),false);
    await captura('04-orden-con-anulado-excluido');
    assert.deepEqual(await recorrer(),['117,720','117,722'],'el anulado queda fuera');
    await cerrar();

    // ...salvo que se abra justo el anulado: entonces va con su orden.
    await page.locator('label.filtro-check').tap();
    assert.equal(await page.locator('#vales-body tr.row-hist-anulada').count(),1);
    await ver('117,721');
    assert.equal(await progreso.innerText(),'Vale 2 de 3');
    assert.equal(await codigo(),'117,721');
    assert.equal(await page.locator('#qr-anulado').isVisible(),true,'el anulado sigue en modo consulta');
    assert.equal(await page.locator('#qr-share-actions').isVisible(),false);
    await captura('05-anulado-abierto-con-su-orden');
    await anterior.click();
    assert.equal(await codigo(),'117,720');
    assert.equal(await page.locator('#qr-anulado').isVisible(),false,'los demás no quedan marcados');
    assert.equal(await page.locator('#qr-share-actions').isVisible(),true);
    assert.deepEqual(await recorrer(),['117,720','117,721','117,722']);
    await cerrar();
    // Con los anulados a la vista, abrir un vigente sigue dejándolo fuera.
    await ver('117,720');
    assert.equal(await progreso.innerText(),'Vale 1 de 2');
    assert.deepEqual(await recorrer(),['117,720','117,722']);
    await cerrar();
    await page.locator('#filtro-anulados').uncheck();

    // ---- Sin folio al final, en el orden en que estaban -------------------
    await ver('117,731');
    assert.equal(await progreso.innerText(),'Vale 2 de 4');
    assert.deepEqual(await recorrer(),['117,730','117,731','SPECTRO-FUEL-2026-CCCC0001','SPECTRO-FUEL-2026-CCCC0003']);
    await cerrar();
    await page.locator('#vales-body tr',{hasText:'Orden Mixta'}).filter({hasText:'Sin folio'}).first().locator('.btn-ver').click();
    await page.waitForSelector('#qr-modal:not([hidden])');
    assert.equal(await progreso.innerText(),'Vale 3 de 4');
    assert.equal(await codigo(),'SPECTRO-FUEL-2026-CCCC0001');
    await cerrar();

    // ---- Sin batchId (o vacío, o que no es texto): abre solo, como antes --
    for(const folio of ['117,740','117,760','117,761','117,770']) {
      await ver(folio);
      assert.equal(await progreso.isVisible(),false,`${folio}: sin «Vale n de m»`);
      assert.equal(await codigo(),folio);
      assert.equal(await anterior.isVisible(),false);
      assert.equal(await siguiente.innerText(),'Cerrar');
      if(folio==='117,740')await captura('06-sin-batchid-abre-solo');
      await siguiente.click();
      await page.waitForSelector('#qr-modal',{state:'hidden'});
    }

    // ---- Si un vale de la orden no se puede preparar, no se abre nada -----
    await page.evaluate(()=>{window.__romperFecha=true;});
    await fila('117,750').locator('.btn-ver').click(); // el que falla es el OTRO vale de la orden
    await page.waitForFunction(()=>!document.querySelector('#vales-body .btn-ver[disabled]'));
    assert.deepEqual(avisos,['No se pudo abrir el vale. Inténtalo de nuevo.']);
    assert.equal(await modal.isHidden(),true,'no se abre una orden a medias');
    await page.evaluate(()=>{window.__romperFecha=false;});
    await ver('117,750');
    assert.equal(await progreso.innerText(),'Vale 1 de 2','y al reintentar abre');
    await cerrar();

    // ---- Sólo lectura: ni escrituras ni consultas nuevas -----------------
    assert.equal(await page.evaluate(()=>window.__writes),0);
    assert.deepEqual(await page.evaluate(()=>({reads:window.__reads,counts:window.__counts})),lecturas,'«Ver» no consulta colecciones');
    const docReads=await page.evaluate(()=>window.__docReads);
    assert.ok(docReads.every(r=>r.startsWith('inventario/')),'sólo se leen imágenes de folios');
    assert.equal(new Set(docReads).size,docReads.length,'cada folio se lee una sola vez (caché)');
    assert.equal(avisos.length,1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'sin scroll horizontal');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,result:'OK',ordenDe3:'abre en 2 de 3 y navega a los 3',conAnulado:'excluido (2 de 2); incluido si se abre ese (2 de 3)',sinFolio:'al final',sinBatchId:'abre solo',fallo:'aviso y nada abierto',writes:0,consultasNuevas:0,lecturasDeImagen:docReads.length,capturas:out},null,2));
    await context.close();
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
