// Cliente real + SDK 10.12.0 real + emulador. Sólo proyecto demo-ui-release.
// PLAYWRIGHT_MODULE=/ruta/playwright SDK_CACHE=/ruta/cache node tests/verify-ui-release.cjs
// Requiere el repo servido en 8793 y el emulador en 8089 con las reglas que use producción.
// Comandos que funcionaron (macOS, Java de Homebrew, jar del emulador en caché):
//   java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar \
//     --host 127.0.0.1 --port 8089 --rules "$PWD/firestore.rules" &
//   python3 -m http.server 8793 --bind 127.0.0.1 &
//   PLAYWRIGHT_MODULE=… SDK_CACHE=… node tests/verify-ui-release.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),cache=process.env.SDK_CACHE;
assert.ok(cache,'Indica SDK_CACHE con firebase-app.js y firebase-firestore.js 10.12.0');
const project='demo-ui-release',origin='http://127.0.0.1:8793',host='http://127.0.0.1:8089';
const api=`${host}/v1/projects/${project}/databases/(default)/documents`;
const enc=v=>v===null?{nullValue:null}:v instanceof Date?{timestampValue:v.toISOString()}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
async function seed(p,data){const r=await fetch(api+'/'+p,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,enc(v)]))})});assert.ok(r.ok,await r.text());}
async function get(p){const r=await fetch(api+'/'+p);assert.ok(r.ok);return r.json();}
const field=(d,k)=>Object.values(d.fields[k]||{})[0];
const config=`export const firebaseConfig={projectId:'${project}',apiKey:'demo-key',appId:'demo-app'};
export const ACCESS_PIN='0000',ADMIN_PIN='0000',COLLECTION='vales',INVENTARIO_COLLECTION='inventario';
export const CATEGORIAS=['Empleado','Familia','Socio'],MONTOS=[200,300,500,1000],INVENTARIO_MONTOS=MONTOS;
export const INVENTARIO_STATUS=['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS=['Pruebas'];export const PERSONAS=[{nombre:'Mariana Ejemplo con Apellidos Largos de Prueba',categoria:'Empleado',depto:'Pruebas'}];`;
(async()=>{
 // Chromium reciente aplica «Local Network Access» y deniega el fetch al emulador
 // («blocked by CORS policy: Permission was denied»). Sólo en pruebas.
 const browser=await chromium.launch({headless:true,args:['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults']});const results=[];
 try{for(const width of [360,390]){
  await fetch(`${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>sessionStorage.setItem('vales_unlocked','1'));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  // El emulador queda FUERA de la interceptación: Playwright rompe el
  // preflight CORS de las peticiones interceptadas y el SDK no llega a leer.
  await context.route(u=>new URL(u).origin!==host,async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(cache,path.basename(u.pathname)))});
   if(u.origin!==origin)return route.fulfill({contentType:'application/javascript',body:'/* externa desactivada */'});
   if(u.pathname==='/js/config.js')return route.fulfill({contentType:'application/javascript',body:config});
   if(u.pathname==='/js/app.js'){
    const code=fs.readFileSync(path.join(root,'js/app.js'),'utf8').replace('  initializeFirestore,','  initializeFirestore,\n  connectFirestoreEmulator,').replace('const valesRef =','connectFirestoreEmulator(db,"127.0.0.1",8089);\nconst valesRef =');
    return route.fulfill({contentType:'application/javascript',body:code});
   }
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/(id="registradoPor"[^>]*value=")[^"]*/,'$1Operador ficticio')});
   return route.continue();
  });
  // Imagen ficticia verificable; no QR ni datos de producción.
  await page.goto(origin);const qr=await page.evaluate(()=>{let c=document.createElement('canvas');c.width=c.height=64;let x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,64,64);x.fillStyle='black';x.fillRect(8,8,24,24);return c.toDataURL().split(',')[1]});
  const inv=(folio,monto,vencimiento)=>({folio,monto,status:'disponible',vencimiento,qrImageBase64:qr,asignadoA:null,asignadoEn:null,batchId:null,importadoEn:new Date(),importadoPor:'Prueba'});
  const day=n=>{let d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  await seed('inventario/007765',inv('007765',200,day(10)));
  await seed('inventario/117700',inv('117700',500,day(-1)));
  await seed('inventario/117701',inv('117701',300,null));
  const legacy={nombre:'Histórico de prueba',categoria:'Familia',monto:4000,registradoPor:'Operador ficticio',fechaVale:new Date(),anulado:false};
  await seed('vales/legacy',legacy);
  await seed('vales/legacy-missing',{...legacy,nombre:'Histórico con folio ausente',monto:200,folio:'999999',batchId:'historico'});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#stock-200')?.textContent==='1 disponible');
  await page.selectOption('#persona','Mariana Ejemplo con Apellidos Largos de Prueba');await page.click('[data-monto="200"]');
  assert.equal(await page.locator('#btn-registrar').innerText(),'Registrar 1 vale · $200');
  const out=path.join(root,'docs/capturas-ui-release');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,`registro-${width}.png`),fullPage:true});
  await page.click('#btn-registrar');await page.waitForSelector('#confirm-modal:not([hidden])');
  assert.equal(await page.locator('#c-folios').innerText(),'$200 · Folio 007,765');
  await page.screenshot({path:path.join(out,`confirmacion-${width}.png`)});
  await page.click('#btn-confirmar');await page.waitForSelector('#qr-modal:not([hidden])');await page.waitForSelector('#qr-canvas canvas');
  const all=await get('vales');const created=all.documents.find(d=>field(d,'folio')==='007765');assert.ok(created);
  assert.equal(field(await get('inventario/007765'),'status'),'asignado');
  assert.equal('esquema' in created.fields,false);
  const assigned=await get('inventario/007765');assert.equal('asignadoValeId' in assigned.fields,false);assert.equal('devueltoPorVale' in assigned.fields,false);
  await page.keyboard.press('Escape');
  await page.locator('#vales-body').evaluate(el=>el.closest('.card').scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(out,`historial-${width}.png`),fullPage:true});
  for(const q of ['007765','007,765']){await page.fill('#filtro-nombre',q);assert.equal(await page.locator('#vales-body tr').count(),1);}
  await page.locator('#vales-body .btn-ver').click();await page.waitForSelector('#qr-canvas canvas');
  assert.match(await page.locator('#qr-code').innerText(),/007,765/);
  assert.equal(await page.locator('#qr-canvas canvas').evaluate(c=>c.toDataURL().split(',')[1]),qr);
  await page.keyboard.press('Escape');
  async function annul(){await page.locator('#vales-body .btn-anular').click();await page.fill('#admin-pin-input','0000');await page.click('#admin-pin-ok');await page.waitForFunction(()=>document.querySelectorAll('#vales-body tr').length===0);}
  await annul();assert.equal(field(await get('inventario/007765'),'status'),'disponible');assert.equal(field(await get('vales/'+created.name.split('/').pop()),'anulado'),true);
  for(const [q,id] of [['Histórico de prueba','legacy'],['999999','legacy-missing']]){await page.fill('#filtro-nombre',q);await annul();assert.equal(field(await get('vales/'+id),'anulado'),true);}
  await page.click('[data-view="inventario"]');await page.selectOption('#inv-filtro-status','');await page.waitForSelector('#inv-body tr');
  assert.equal(await page.locator('#inv-body tr').count(),3);assert.equal(await page.locator('.inv-vence-pronto').count(),1);
  await page.screenshot({path:path.join(out,`inventario-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);results.push({width,alta:true,qr:true,anulacionDevolucion:true,historicoSinFolio:true,historicoFolioAusente:true});await context.close();
 }console.log(JSON.stringify(results,null,2));}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
