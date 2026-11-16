// Navegador real + app servida del repositorio. Firestore y config ficticios;
// ninguna petición externa ni escritura. No prueba reglas de Firestore.
// Casilla «Mostrar anulados» del Historial.
// PLAYWRIGHT_MODULE=/ruta/a/playwright node tests/verify-historial-anulados-ui.cjs
// Servir antes la raíz en http://127.0.0.1:8792 (o VALES_UI_URL).
// Capturas en VALES_CAPTURAS (por omisión, docs/capturas-historial-anulados).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const out = process.env.VALES_CAPTURAS || path.join(root, 'docs/capturas-historial-anulados');
const config = `
export const firebaseConfig = { projectId: 'demo-historial-anulados' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = [{nombre:'Mariana Ejemplo',categoria:'Empleado',depto:'Pruebas'}];
`;
// Historial ficticio del mes en curso: 2 vigentes y 2 anulados (uno con
// anuladoEn y otro antiguo sin esa fecha), más un anulado de OTRO mes y otro
// de otra categoría para comprobar que los filtros también les aplican.
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
const otroMes = Timestamp.fromDate(new Date(hoy.getFullYear() - 1, 0, 15, 12));
const anuladoEn = Timestamp.fromDate(new Date(2026, 10, 12, 10, 30));
const base = {registradoPor:'Operador ficticio', createdAt: dia(0)};
const history = [
  {id:'v1', folio:'117700', qrCode:'COMBUSA-117700', nombre:'Vigente Uno', categoria:'Empleado', monto:500, fechaVale:dia(0), ...base},
  {id:'v2', folio:'117701', qrCode:'COMBUSA-117701', nombre:'Vigente Dos', categoria:'Empleado', monto:200, fechaVale:dia(1), ...base},
  {id:'a1', folio:'117702', qrCode:'COMBUSA-117702', nombre:'Anulado Con Fecha', categoria:'Empleado', monto:1000, fechaVale:dia(1), anulado:true, anuladoEn, ...base},
  {id:'a2', qrCode:'LEGACY-A2', nombre:'Anulado Antiguo', categoria:'Empleado', monto:300, fechaVale:dia(2), anulado:true, ...base},
  {id:'a3', folio:'117703', qrCode:'COMBUSA-117703', nombre:'Anulado Otro Mes', categoria:'Empleado', monto:500, fechaVale:otroMes, anulado:true, ...base},
  {id:'a4', folio:'117704', qrCode:'COMBUSA-117704', nombre:'Anulado Familia', categoria:'Familia', monto:200, fechaVale:dia(0), anulado:true, ...base},
];
function rows(q){let a=q.col==='inventario'?[]:history;for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
export async function getCountFromServer(q){return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){window.__reads++;return {docs:rows(q).map(d=>({id:d.id||d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(ref){return {exists:()=>true,data:()=>({vencimiento:'2099-12-31'})}}
export function writeBatch(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
export function updateDoc(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
`;
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser = await chromium.launch({headless:true});
  const results=[];
  try {
    for(const width of [360,430]) {
      const context=await browser.newContext({viewport:{width,height:900},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await context.addInitScript(()=>{sessionStorage.setItem('vales_unlocked','1');window.__reads=0;window.__writes=0;});
      const page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*', async route=>{
        const url=new URL(route.request().url());
        if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:firebase});
        if(url.origin!==new URL(base).origin)return route.fulfill({contentType:'application/javascript',body:'/* externo desactivado para prueba */'});
        if(url.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
        return route.continue();
      });
      await page.goto(base);
      await page.waitForSelector('#vales-body tr');
      const filas=page.locator('#vales-body tr');
      const nombres=()=>page.locator('#vales-body .hist-nombre').evaluateAll(els=>els.map(e=>e.firstChild.textContent.trim()));
      const casilla=page.locator('#filtro-anulados');
      const etiqueta=page.locator('label.filtro-check');
      const anuladosEl=page.locator('#total-anulados');

      // ---- Apagada (por defecto): igual que antes, sólo vigentes ----------
      assert.equal(await casilla.isChecked(),false,'apagada por defecto');
      assert.deepEqual(await nombres(),['Vigente Uno','Vigente Dos']);
      assert.equal(await page.locator('#total-count').innerText(),'2');
      assert.equal(await page.locator('#total-monto').innerText(),'$700');
      assert.equal(await anuladosEl.isVisible(),false);
      assert.equal(await page.locator('#vales-body .btn-anular').count(),2);
      assert.equal(await page.locator('#vales-body .hist-anulado').count(),0);

      // Blanco táctil y que no desborde.
      const caja=await etiqueta.boundingBox();
      assert.ok(caja.height>=44,`la casilla mide ${caja.height}px de alto`);
      assert.ok(caja.x>=0 && caja.x+caja.width<=width);
      assert.equal(await etiqueta.innerText(),'Mostrar anulados');

      // ---- Encendida: aparecen los anulados del mes y la categoría -------
      await etiqueta.tap(); // tocar el texto también la activa
      assert.equal(await casilla.isChecked(),true);
      assert.deepEqual((await nombres()).sort(),['Anulado Antiguo','Anulado Con Fecha','Anulado Familia','Vigente Dos','Vigente Uno']);
      assert.equal(await page.locator('#total-count').innerText(),'2','el contador sólo cuenta vigentes');
      assert.equal(await page.locator('#total-monto').innerText(),'$700','el total no suma anulados');
      assert.equal(await anuladosEl.isVisible(),true);
      assert.equal(await anuladosEl.innerText(),'3 anulados');

      const anuladas=page.locator('#vales-body tr.row-hist-anulada');
      assert.equal(await anuladas.count(),3);
      assert.equal(await anuladas.locator('.btn-anular').count(),0,'ninguna fila anulada ofrece Anular');
      assert.equal(await anuladas.locator('.btn-ver').count(),3,'todas se pueden Ver');
      assert.equal(await page.locator('#vales-body .btn-anular').count(),2,'los vigentes conservan Anular');
      const conFecha=anuladas.filter({hasText:'Anulado Con Fecha'});
      assert.match(await conFecha.locator('.hist-anulado').innerText(),/^Anulado · 12 nov\.? 2026$/);
      assert.equal(await anuladas.filter({hasText:'Anulado Antiguo'}).locator('.hist-anulado').innerText(),'Anulado','sin anuladoEn no inventa fecha');
      // Atenuada: el texto de la fila usa el gris de la app y el monto va tachado.
      const estilo=await conFecha.locator('.hist-monto').evaluate(el=>({color:getComputedStyle(el).color,deco:getComputedStyle(el).textDecorationLine}));
      const muted=await page.evaluate(()=>{const s=document.createElement('span');s.style.color='var(--muted)';document.body.appendChild(s);const c=getComputedStyle(s).color;s.remove();return c;});
      assert.equal(estilo.color,muted);
      assert.equal(estilo.deco,'line-through');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'sin scroll horizontal');
      await page.locator('#vales-body').evaluate(el=>el.closest('.card').scrollIntoView({block:'start'}));
      await page.screenshot({path:path.join(out,`anulados-${width}.png`),fullPage:false});

      // Los mismos filtros aplican a los anulados.
      await page.selectOption('#filtro-categoria','Familia');
      assert.deepEqual(await nombres(),['Anulado Familia']);
      assert.equal(await page.locator('#total-count').innerText(),'0');
      assert.equal(await page.locator('#total-monto').innerText(),'$0');
      assert.equal(await anuladosEl.innerText(),'1 anulado');
      await page.selectOption('#filtro-categoria','');
      await page.fill('#filtro-nombre','117702');
      assert.deepEqual(await nombres(),['Anulado Con Fecha'],'la búsqueda por folio también');
      await page.fill('#filtro-nombre','');
      await page.fill('#filtro-mes','');
      assert.equal(await filas.count(),6,'sin mes: aparece también el anulado de otro mes');
      assert.equal(await page.locator('#total-monto').innerText(),'$700');
      assert.equal(await anuladosEl.innerText(),'4 anulados');

      // «Ver» de un anulado abre el QR en modo consulta.
      await page.locator('#vales-body tr.row-hist-anulada', {hasText:'Anulado Con Fecha'}).locator('.btn-ver').click();
      await page.waitForSelector('#qr-modal:not([hidden])');
      assert.equal(await page.locator('#qr-anulado').isVisible(),true,'modo consulta');
      await page.click('#qr-next');
      await page.waitForSelector('#qr-modal',{state:'hidden'});

      // ---- Apagada otra vez: vuelve a como estaba -----------------------
      await casilla.uncheck();
      assert.equal(await filas.count(),2);
      assert.equal(await anuladosEl.isVisible(),false);
      assert.equal(await page.locator('#vales-body tr.row-hist-anulada').count(),0);

      // No se persiste: al recargar arranca apagada.
      await casilla.check();
      await page.reload();
      await page.waitForSelector('#vales-body tr');
      assert.equal(await casilla.isChecked(),false,'no se recuerda entre cargas');
      assert.equal(await page.locator('#vales-body tr.row-hist-anulada').count(),0);

      assert.equal(await page.evaluate(()=>window.__writes),0);
      assert.deepEqual(errors,[]);
      results.push({width,result:'OK',apagada:'2 vigentes · $700',encendida:'5 filas · $700 · 3 anulados',sinAnularEnAnulados:true,writes:0,captura:`anulados-${width}.png`});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
