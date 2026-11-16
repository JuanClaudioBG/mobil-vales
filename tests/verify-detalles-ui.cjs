// Navegador real + app servida del repositorio. Firestore, config, PDF.js y
// jsQR ficticios; ninguna petición externa ni escritura. No prueba reglas.
// Detalles menores, de punta a punta:
//   1. jsQR no se pide al abrir la app y sí al importar un PDF; una sola
//      inyección aunque se importe dos veces; si falla, mismo mensaje y se
//      puede reintentar.
//   2. Al compartir, el vencimiento sale con el formato del modal.
//   3. Un monto inválido se pinta «—» (Historial y Admin), no «$NaN».
//   4. El fallo al exportar a Excel se traduce con mensajeError.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-detalles-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
// No guarda capturas. La comprobación unitaria está en tests/verify-detalles.mjs.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const AVISO_JSQR = 'No se pudo cargar jsQR desde la CDN. Revisa la conexión e inténtalo de nuevo.';
const config = `
export const firebaseConfig = { projectId: 'demo-detalles' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Mariana Ejemplo',categoria:'Empleado',depto:'Pruebas'}];
`;
// Historial: un vale normal con folio y vencimiento, y tres con el monto roto.
// Inventario: ya contiene el folio del PDF ficticio, así la importación llega
// hasta validar el QR pero no tiene nada nuevo que escribir.
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
export const doc = (_, col, id) => ({col,id});
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => ({});
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const base = {categoria:'Empleado', registradoPor:'Operador ficticio', fechaVale:Timestamp.now(), createdAt:Timestamp.now()};
const history = [
  {id:'ok', folio:'117700', qrCode:'COMBUSA-117700', vencimiento:'2026-12-31', nombre:'Vale Normal', monto:500, ...base},
  {id:'m1', qrCode:'SPECTRO-FUEL-2026-MONTO001', nombre:'Monto Texto', monto:'abc', ...base},
  {id:'m2', qrCode:'SPECTRO-FUEL-2026-MONTO002', nombre:'Monto Ausente', ...base},
  {id:'m3', qrCode:'SPECTRO-FUEL-2026-MONTO003', nombre:'Monto No Numerico', monto:NaN, ...base},
];
const inventory = [{folio:'117700', monto:500, status:'asignado', vencimiento:'2026-12-31', asignadoA:'Vale Normal', asignadoEn:Timestamp.now(), importadoEn:Timestamp.now(), importadoPor:'Operador ficticio'}];
function rows(q){let a=q.col==='inventario'?inventory:history;for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
function qrFicticio(){const c=document.createElement('canvas');c.width=c.height=120;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,120,120);x.fillStyle='#000';x.fillRect(20,20,40,40);x.fillRect(70,70,30,30);return c.toDataURL('image/png').split(',')[1]}
export async function getCountFromServer(q){return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){return {docs:rows(q).map(d=>({id:d.id||d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(ref){return {exists:()=>true,data:()=>({vencimiento:'2026-12-31',qrImageBase64:qrFicticio()})}}
export function writeBatch(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
export function updateDoc(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
`;
// PDF.js de mentira: una página con un vale (folio, monto, vencimiento y una
// imagen). Lo justo para que el lector real de js/pdf-vales.js recorra su
// camino completo y llegue a validar el QR con jsQR.
const pdfjs = `
window.pdfjsLib = {
  GlobalWorkerOptions: {},
  OPS: {save:1, restore:2, transform:3, paintImageXObject:4, paintImageMaskXObject:5, paintInlineImageXObject:6},
  getDocument() {
    const page = {
      getViewport: ({scale}) => ({width:612*scale, height:792*scale, convertToViewportPoint:(x,y)=>[x*scale,(792-y)*scale]}),
      getTextContent: async () => ({items:[
        {str:'Folio: 117,700', transform:[1,0,0,1,250,700], width:100, height:10},
        {str:'$500', transform:[1,0,0,1,280,680], width:40, height:10},
        {str:'Vence 31 DICIEMBRE 2026', transform:[1,0,0,1,250,660], width:100, height:10},
      ]}),
      getOperatorList: async () => ({fnArray:[1,3,4,2], argsArray:[null,[200,0,0,200,200,400],['img'],null]}),
      render({canvasContext:x}) {
        const {width:w,height:h} = x.canvas;
        x.fillStyle='#fff'; x.fillRect(0,0,w,h); x.fillStyle='#000';
        x.fillRect(w*0.2,h*0.2,w*0.25,h*0.25); x.fillRect(w*0.55,h*0.5,w*0.2,h*0.3);
        return {promise:Promise.resolve()};
      },
      cleanup() {},
    };
    return {promise:Promise.resolve({numPages:1, getPage: async () => page, destroy() {}})};
  },
};
`;
const jsqr = `window.jsQR = function(){ window.__jsqrUsos++; return {data:'https://combusa.example/vale/117700'}; };`;
// Generador de Excel de mentira: falla con el error que le deje la prueba.
const excel = `export async function generarLibroExcel(){ throw window.__excelError(); }`;

(async()=>{
  const browser = await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await context.addInitScript(()=>{
      sessionStorage.setItem('vales_unlocked','1');
      window.__writes=0;window.__jsqrUsos=0;window.__compartido=null;
      // Web Share de mentira: guarda lo que la app iba a compartir.
      navigator.canShare=()=>true;
      navigator.share=async(d)=>{window.__compartido={title:d.title,text:d.text,archivo:d.files[0].name};};
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const pedidosJsqr=[];
    let jsqrFalla=false;
    await context.route('**/*', async route=>{
      const url=new URL(route.request().url());
      if(/jsqr/i.test(url.href)) {
        pedidosJsqr.push(url.href);
        return jsqrFalla?route.abort('failed'):route.fulfill({contentType:'application/javascript',body:jsqr});
      }
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
      if(/pdf\.min\.js$/.test(url.pathname))return route.fulfill({contentType:'application/javascript',body:pdfjs});
      if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
      if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
      if(url.pathname==='/js/excel-export.js')return route.fulfill({contentType:'application/javascript',body:excel});
      return route.continue();
    });
    const scriptsJsqr=()=>page.locator('script[src*="jsqr" i]').count();
    const tab=(vista)=>page.click(`.tab[data-view="${vista}"]`);

    await page.goto(base);
    await page.waitForSelector('#vales-body tr');

    // ---- 1a. Al abrir la app, jsQR ni se pide ni se inyecta --------------
    for(const vista of ['dashboard','admin','inventario','registro'])await tab(vista);
    await page.waitForLoadState('networkidle');
    assert.deepEqual(pedidosJsqr,[],'jsQR no se pide al abrir ni al recorrer las pestañas');
    assert.equal(await scriptsJsqr(),0);
    assert.equal(await page.evaluate(()=>typeof window.jsQR),'undefined');

    // ---- 3. «—» en vez de «$NaN» ----------------------------------------
    const montos=(cuerpo,celda)=>page.locator(`${cuerpo} tr`).evaluateAll((trs,sel)=>Object.fromEntries(trs.map(tr=>[tr.cells[0].firstChild.textContent.trim(),tr.querySelector(sel).textContent.trim()])),celda);
    const esperado={'Vale Normal':'$500','Monto Texto':'—','Monto Ausente':'—','Monto No Numerico':'—'};
    assert.deepEqual(await montos('#vales-body','.hist-monto'),esperado,'Historial');
    await tab('admin');
    assert.deepEqual(await montos('#admin-vales-body','td.num'),esperado,'Admin');
    for(const cuerpo of ['#vales-body','#admin-vales-body'])assert.doesNotMatch(await page.locator(cuerpo).innerText(),/NaN/);

    // ---- 4. Mensaje del fallo al exportar a Excel ------------------------
    const exportar=async(fabrica)=>{
      await page.evaluate(`window.__excelError=${fabrica}`);
      await page.click('#btn-excel');
      await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('No se pudo generar el Excel')&&!document.querySelector('#btn-excel').disabled);
      const texto=await page.locator('#toast').innerText();
      await page.evaluate(()=>{document.querySelector('#toast').textContent='';});
      return texto;
    };
    assert.equal(
      await exportar(`()=>Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'})`),
      '⚠️ No se pudo generar el Excel: No tienes permiso para exportar el Excel o el registro cambió. Pulsa «Actualizar» e inténtalo de nuevo; si sigue, avisa al administrador.');
    assert.equal(
      await exportar(`()=>Object.assign(new Error('The service is currently unavailable.'),{code:'unavailable'})`),
      '⚠️ No se pudo generar el Excel: Sin conexión con el servidor. Revisa tu señal e inténtalo de nuevo.');
    assert.equal(
      await exportar(`()=>new Error('ExcelJS no se registró')`),
      '⚠️ No se pudo generar el Excel: ExcelJS no se registró','sin code conserva su mensaje');

    // ---- 2. Vencimiento al compartir ------------------------------------
    await tab('registro');
    await page.locator('#vales-body tr',{hasText:'Vale Normal'}).locator('.btn-ver').click();
    await page.waitForSelector('#qr-canvas canvas');
    const vence=await page.locator('#qr-vence').innerText();
    assert.equal(vence,'Vence: 31 de diciembre de 2026');
    await page.click('#qr-share');
    await page.waitForFunction(()=>window.__compartido);
    const compartido=await page.evaluate(()=>window.__compartido);
    const lineas=compartido.text.split('\n');
    assert.equal(lineas[lineas.length-1],vence,'la última línea es la misma que #qr-vence');
    assert.ok(!compartido.text.includes('2026-12-31'),'sin la fecha ISO cruda');
    assert.ok(!compartido.archivo.includes('2026-12-31'));
    assert.ok(lineas.includes('Folio: 117,700'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#qr-modal',{state:'hidden'});

    // ---- 1b. Al importar un PDF sí se carga ------------------------------
    await tab('inventario');
    const importar=async()=>{
      const eleccion=page.waitForEvent('filechooser');
      await page.click('#btn-importar-pdf');
      await page.fill('#admin-pin-input','0000');
      await page.click('#admin-pin-ok');
      await (await eleccion).setFiles({name:'vales-ficticios.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-ficticio')});
      await page.waitForFunction(()=>!document.querySelector('#btn-importar-pdf').disabled&&(!document.querySelector('#inv-error').hidden||!document.querySelector('#inv-resumen').hidden));
    };
    // Primero con la CDN caída: mismo aviso de siempre, y nada memorizado.
    jsqrFalla=true;
    await importar();
    assert.deepEqual(pedidosJsqr,[JSQR_URL],'al importar sí se pide, con la misma URL y versión');
    assert.equal(await page.locator('#inv-error').isVisible(),true);
    assert.equal(await page.locator('#inv-error').innerText(),AVISO_JSQR);
    assert.equal(await scriptsJsqr(),0,'el <script> que falló se quita');
    // Reintento con la CDN de vuelta: vuelve a pedirlo y la importación sigue.
    jsqrFalla=false;
    await importar();
    assert.deepEqual(pedidosJsqr,[JSQR_URL,JSQR_URL],'el fallo no quedó memorizado');
    assert.equal(await page.locator('#inv-error').isVisible(),false);
    assert.match(await page.locator('#inv-resumen').innerText(),/No se importó ningún vale nuevo: los 1 folios del PDF ya estaban en el inventario/);
    assert.equal(await scriptsJsqr(),1);
    assert.equal(await page.evaluate(()=>window.__jsqrUsos),1,'el QR del PDF se validó con jsQR');
    // Otra importación: se reutiliza, sin pedirlo ni inyectarlo de nuevo.
    await importar();
    assert.equal(pedidosJsqr.length,2,'una sola carga aunque se importe dos veces');
    assert.equal(await scriptsJsqr(),1,'una sola inyección');
    assert.equal(await page.evaluate(()=>window.__jsqrUsos),2);

    assert.equal(await page.evaluate(()=>window.__writes),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'OK',jsqr:'no al abrir · sí al importar · 1 inyección · fallo = mismo aviso y reintenta',compartir:vence,montoInvalido:'— en Historial y Admin',excel:'mensajeError con code; message sin code',writes:0},null,2));
    await context.close();
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
