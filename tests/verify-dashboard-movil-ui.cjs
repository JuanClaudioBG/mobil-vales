// Navegador real + app servida del repositorio. Firestore y config ficticios;
// ninguna petición externa ni escritura. No prueba reglas de Firestore.
// Dashboard: gráfica «Total por mes» en móvil (5 personas + «Otros», desglose) y
// comparación por solicitante vs el mes anterior en el Top.
//
//   python3 -m http.server 8792 --bind 127.0.0.1 &      # desde la raíz
//   PLAYWRIGHT_MODULE=/ruta/a/playwright CHART_JS=/ruta/chart.umd.min.js \
//     VALES_CAPTURAS=/ruta/fuera/de/docs node tests/verify-dashboard-movil-ui.cjs
//
// CHART_JS: copia local de chart.js@4.4.1/dist/chart.umd.min.js (la prueba
// bloquea toda red externa). Capturas en VALES_CAPTURAS (por omisión, una
// carpeta temporal del sistema: no se guardan en docs/).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = process.env.VALES_UI_URL || 'http://127.0.0.1:8792';
const out = process.env.VALES_CAPTURAS || path.join(os.tmpdir(), 'capturas-dashboard-movil');
const chartJs = process.env.CHART_JS;
assert.ok(chartJs && fs.existsSync(chartJs), 'Indica CHART_JS con chart.umd.min.js 4.4.1');

const NOMBRES = {
  A: 'Ana Prueba', B: 'Beto Ejemplo', C: 'Carla Demo', D: 'Dario Ficticio', E: 'Elena Muestra',
  F: 'Fede Simulado', G: 'Gina Test', H: 'Hugo Caso', I: 'Irene Ensayo', J: 'Jorge Piloto',
  K: 'Karla Borrador', L: 'Luis Modelo', M: 'Mario Supuesto', N: 'Nora Hipótesis',
};
const config = `
export const firebaseConfig = { projectId: 'demo-dashboard-movil' };
export const ACCESS_PIN = '0000', ADMIN_PIN = '0000';
export const COLLECTION = 'vales', INVENTARIO_COLLECTION = 'inventario';
export const CATEGORIAS = ['Empleado','Familia','Socio'];
export const MONTOS = [200,300,500,1000], INVENTARIO_MONTOS = MONTOS;
export const INVENTARIO_STATUS = ['disponible','revision_requerida','asignado','canjeado','vencido'];
export const DEPARTAMENTOS = ['Pruebas'];
export const PERSONAS = ${JSON.stringify(Object.values(NOMBRES).slice(0, 8).map((nombre) => ({ nombre, categoria: 'Empleado', depto: 'Pruebas' })))};
`;
// [clave, categoría, monto, mesesAtrás (0 = mes en curso), día, anulado]
const VALES = [
  ['A','Empleado',1000,0,2], ['A','Empleado',500,0,6], ['A','Empleado',1000,0,7,true],
  ['B','Empleado',500,0,3], ['C','Familia',300,0,4], ['D','Empleado',1000,0,5],
  ['E','Familia',200,0,6], ['E','Familia',200,0,9], ['F','Socio',1000,0,7],
  ['G','Empleado',300,0,8], ['H','Empleado',200,0,9], ['I','Familia',500,0,10],
  ['J','Empleado',1000,0,2], ['J','Empleado',1000,0,11], ['K','Familia',200,0,12],
  ['L','Empleado',500,0,13], ['N','Empleado',1000,0,14,true],
  // Mes anterior
  ['A','Empleado',1000,1,3], ['B','Empleado',1000,1,4], ['B','Empleado',200,1,20],
  ['C','Familia',300,1,5], ['E','Familia',500,1,6], ['F','Socio',500,1,7],
  ['G','Empleado',700,1,8,true], ['H','Empleado',200,1,9], ['I','Familia',300,1,10],
  ['J','Empleado',1000,1,11], ['L','Empleado',500,1,12], ['M','Empleado',1000,1,13],
  // Dos meses atrás
  ['A','Empleado',500,2,3], ['B','Empleado',500,2,4], ['J','Empleado',700,2,5],
];
const firebase = `
export const initializeApp = () => ({}), initializeFirestore = () => ({});
export const collection = (_, col) => ({col});
export const doc = (_, col, id) => ({col,id});
export const where = (f, op, v) => ({f,v}), limit = n => ({n});
export const query = (ref,...cons) => ({...ref,cons});
export const serverTimestamp = () => ({});
export class Timestamp { constructor(d) {this.d=d} toDate(){return this.d} static fromDate(d){return new Timestamp(d)} static now(){return new Timestamp(new Date())} }
const NOMBRES = ${JSON.stringify(NOMBRES)};
const hoy = new Date();
const fecha = (atras, dia) => Timestamp.fromDate(new Date(hoy.getFullYear(), hoy.getMonth() - atras, dia, 12));
const history = ${JSON.stringify(VALES)}.map(([k,categoria,monto,atras,dia,anulado],i) => ({
  id:'v'+i, qrCode:'PRUEBA-'+i, nombre:NOMBRES[k], categoria, monto, fechaVale:fecha(atras,dia),
  createdAt:fecha(atras,dia), registradoPor:'Operador ficticio', ...(anulado?{anulado:true}:{}),
}));
function rows(q){let a=q.col==='inventario'?[]:history;for(const c of q.cons||[]){if(c.f)a=a.filter(d=>d[c.f]===c.v);if(c.n)a=a.slice(0,c.n)}return a}
export async function getCountFromServer(q){return {data:()=>({count:rows(q).length})}}
export async function getDocsFromServer(q){return {docs:rows(q).map(d=>({id:d.id||d.folio,data:()=>({...d})}))}}
export async function getDocFromServer(ref){return {exists:()=>true,data:()=>({vencimiento:'2099-12-31'})}}
export function writeBatch(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
export function updateDoc(){window.__writes++;throw new Error('Escrituras prohibidas en esta prueba de interfaz')}
`;
const n = (k) => NOMBRES[k];
const monthKey = (atras) => { const h = new Date(); const d = new Date(h.getFullYear(), h.getMonth() - atras, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
// Ranking esperado del mes en curso (importe desc → vales desc → nombre).
const RANK_ACTUAL = [
  [n('J'),'$2,000'], [n('A'),'$1,500'], [n('D'),'$1,000'], [n('F'),'$1,000'], [n('B'),'$500'], [n('I'),'$500'],
  [n('L'),'$500'], [n('E'),'$400'], [n('C'),'$300'], [n('G'),'$300'], [n('H'),'$200'], [n('K'),'$200'],
];
const DELTA_ACTUAL = {
  [n('J')]: '↑ $1,000', [n('A')]: '↑ $500', [n('D')]: 'nuevo', [n('F')]: '↑ $500', [n('B')]: '↓ $700',
  [n('I')]: '↑ $200', [n('L')]: '=', [n('E')]: '↓ $100', [n('C')]: '=', [n('G')]: 'nuevo', [n('H')]: '=', [n('K')]: 'nuevo',
};
const DELTA_CLASE = { '↑': 'stat-trend--up', '↓': 'stat-trend--down', '=': 'stat-trend--flat', 'n': 'stat-trend--flat' };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [360, 430, 1024]) {
      const mobile = width < 600;
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      await context.addInitScript(() => { sessionStorage.setItem('vales_unlocked', '1'); window.__writes = 0; });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'application/javascript', body: firebase });
        if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/chart.js@4.4.1/')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(chartJs) });
        if (url.origin !== new URL(base).origin) return route.fulfill({ contentType: 'application/javascript', body: '/* externo desactivado para prueba */' });
        if (url.pathname === '/js/config.js') return route.fulfill({ contentType: 'application/javascript', body: config });
        return route.continue();
      });
      await page.goto(base);
      await page.waitForSelector('#vales-body tr');
      await page.click('[data-view="dashboard"]');
      await page.waitForFunction(() => window.Chart?.getChart(document.querySelector('#dash-chart')));
      const chart = () => page.evaluate(() => {
        const c = window.Chart.getChart(document.querySelector('#dash-chart'));
        return { datasets: c.data.datasets.map((d) => ({ label: d.label, stack: d.stack, bg: d.backgroundColor })), labels: c.data.labels, tooltip: c.options.plugins.tooltip.enabled };
      });
      const desglose = () => page.locator('#dash-desglose-list .desg-row').evaluateAll((els) => els.map((e) => [e.querySelector('.desg-name').textContent, e.querySelector('.desg-amount').textContent]));
      const deltas = () => page.locator('#dash-top .lb-row').evaluateAll((els) => Object.fromEntries(els.map((e) => {
        const d = e.querySelector('.lb-delta');
        return [e.dataset.name, d ? [d.querySelector('[aria-hidden]').textContent, d.className, d.querySelector('.sr-only').textContent] : null];
      })));
      const res = { width };
      // Estado de la gráfica tras terminar la animación: series, sumas por mes
      // y marca del eje (negrita + color de texto) por columna.
      const estado = () => page.evaluate(async () => {
        const ch = window.Chart.getChart(document.querySelector('#dash-chart'));
        await new Promise((r) => { const t = () => (window.Chart.animator.running(ch) ? setTimeout(t, 50) : r()); requestAnimationFrame(() => requestAnimationFrame(t)); });
        const t = ch.config.options.scales.x.ticks;
        return {
          series: ch.data.datasets.map((d) => ({ label: d.label, otros: Boolean(d.isOtros), bg: d.backgroundColor, stack: d.stack })),
          sumas: ch.data.labels.map((_, i) => ch.data.datasets.reduce((s, d) => s + d.data[i], 0)),
          negrita: ch.data.labels.map((_, i) => (typeof t.font === 'function' ? t.font({ index: i }).weight : 400)),
          color: ch.data.labels.map((_, i) => (typeof t.color === 'function' ? t.color({ index: i }) : t.color)),
          labels: ch.data.labels,
        };
      });
      // Centro del segmento `label` en la columna `i` (o zona vacía arriba si label = null).
      const punto = (label, i) => page.evaluate(async ([label, i]) => {
        const ch = window.Chart.getChart(document.querySelector('#dash-chart'));
        await new Promise((r) => { const t = () => (window.Chart.animator.running(ch) ? setTimeout(t, 50) : r()); requestAnimationFrame(() => requestAnimationFrame(t)); });
        if (label == null) { const bar = ch.getDatasetMeta(0).data.at(i); return { x: bar.x, y: ch.chartArea.top + 4 }; }
        const d = ch.data.datasets.findIndex((x) => x.label === label);
        const bar = ch.getDatasetMeta(d).data.at(i);
        return { x: bar.x, y: (bar.y + bar.base) / 2 };
      }, [label, i]);
      const assertMarca = (e, sel) => {
        assert.deepEqual(e.negrita, e.labels.map((_, i) => (i === sel ? 700 : 400)), 'sólo la etiqueta elegida en negrita');
        assert.deepEqual(e.color, e.labels.map((_, i) => (i === sel ? '#e7ecf3' : '#97a1b0')), 'sólo la elegida en color de texto principal');
      };
      // Total esperado por mes (activos), de más antiguo a más reciente.
      const totales = (finAtras) => [5, 4, 3, 2, 1, 0].map((k) => VALES
        .filter((v) => v[3] === k + finAtras && !v[5]).reduce((s, v) => s + v[2], 0));
      // Capturas sin animación de Chart.js ni desplazamiento suave a medias.
      const quieto = async () => {
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.waitForFunction(() => { const c = window.Chart.getChart(document.querySelector('#dash-chart')); return c && !window.Chart.animator.running(c); });
        await page.evaluate(() => new Promise((r) => { let y = -1; const t = () => (y === scrollY ? r() : ((y = scrollY), setTimeout(t, 120))); t(); }));
      };

      // ---- Comparación vs mes anterior (todas las anchuras) ---------------
      await page.click('#dash-vertodos');
      const dAct = await deltas();
      assert.equal(Object.keys(dAct).length, 12, '12 solicitantes en el mes');
      for (const [name, exp] of Object.entries(DELTA_ACTUAL)) {
        assert.ok(dAct[name], `delta de ${name}`);
        assert.equal(dAct[name][0], exp, `delta de ${name}`);
        assert.match(dAct[name][1], new RegExp(DELTA_CLASE[exp[0]]), `clase de ${name}`);
      }
      assert.ok(!(n('M') in dAct) && !(n('N') in dAct), 'quien ya no aparece no tiene fila');
      assert.match(dAct[n('B')][2], /baja \$700 vs /);
      res.comparacion = 'sube/baja/=/nuevo OK';

      if (mobile) {
        // ---- Apilada con ≤5 personas + «Otros», mini leyenda, desglose -----
        await page.click('#dash-vertodos'); // vuelve a «Ver menos» (no afecta la gráfica)
        let e = await estado();
        // Top 5 de la ventana (6 meses al mes en curso): Jorge 3700, Ana 3000,
        // Beto 2200, Fede 1500, Luis 1000 (2 vales; empata en importe con Dario y Mario).
        assert.deepEqual(e.series.map((x) => x.label), [n('J'), n('A'), n('B'), n('F'), n('L'), 'Otros'], 'top 5 de la ventana + Otros');
        assert.ok(e.series.length <= 6 && e.series.at(-1).otros, 'la última serie es «Otros»');
        assert.equal(e.series.at(-1).bg, '#5b6573');
        assert.ok(e.series.every((x) => x.stack === 'total'), 'apilada');
        assert.deepEqual(e.sumas, totales(0), 'las series suman el total de cada mes');
        assertMarca(e, e.labels.length - 1);
        const leyenda = await page.locator('#dash-legend .legend-item').allInnerTexts();
        assert.deepEqual(leyenda.map((t) => t.trim()), e.series.map((x) => x.label), 'mini leyenda con las mismas ≤6 entradas');
        assert.equal(await page.locator('#dash-chart-hint').innerText(), 'Toca un mes para ver su desglose; toca un color para ver el detalle.');
        assert.equal(await page.locator('#dash-legend').isVisible(), true);
        assert.equal(await page.locator('#dash-desglose').isVisible(), true);
        assert.match(await page.locator('#dash-desglose-title').innerText(), /^Desglose de \S+ de \d{4}$/i);
        assert.deepEqual(await desglose(), RANK_ACTUAL, 'desglose ordenado de mayor a menor');
        const alturas = await page.locator('#dash-desglose-list .desg-row').evaluateAll((els) => els.map((x) => x.getBoundingClientRect().height));
        assert.ok(alturas.every((h) => h >= 44), `filas ≥44px (${Math.min(...alturas)})`);
        res.filaMin = Math.round(Math.min(...alturas));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'sin scroll horizontal');
        // Filtros: con Tipo = Familia hay 4 personas → sin «Otros»; el desglose también filtra.
        await page.selectOption('#dash-tipo', 'Familia');
        e = await estado();
        assert.deepEqual(e.series.map((x) => x.label), [n('E'), n('I'), n('C'), n('K')], 'top de la ventana con Tipo = Familia');
        assert.ok(!e.series.some((x) => x.otros));
        assert.deepEqual(await desglose(), [[n('I'),'$500'], [n('E'),'$400'], [n('C'),'$300'], [n('K'),'$200']]);
        await page.selectOption('#dash-tipo', '');
        await page.locator('#dash-chart').scrollIntoViewIfNeeded();
        await quieto();
        await page.screenshot({ path: path.join(out, `dashboard-movil-${width}.png`), fullPage: true });

        // ---- Tocar «Otros» (mes anterior: C+E+H+I+M = $2,300): sólo cambia el mes
        await page.locator('#dash-chart').tap({ position: await punto('Otros', -2) });
        await page.waitForFunction((k) => document.querySelector('#dash-mes').value === k, monthKey(1));
        assert.equal(await page.locator('#dash-detail').isHidden(), true, '«Otros» no abre detalle');
        e = await estado();
        assert.deepEqual(e.sumas, totales(1), 'sumas = total en la nueva ventana');
        assertMarca(e, e.labels.length - 1);

        // ---- Tocar un segmento de color: su mes + detalle de esa persona ----
        await page.locator('#dash-chart').tap({ position: await punto(n('A'), -2) });
        await page.waitForSelector('#dash-detail:not([hidden])');
        assert.equal(await page.locator('#dash-detail-name').innerText(), n('A'));
        assert.equal(await page.inputValue('#dash-mes'), monthKey(2), 'el segmento también elige su mes');
        assert.match(await page.locator('#dash-detail-summary').innerText(), /1 vale activo · \$500/);
        await page.click('#dash-detail-close');
        await page.waitForSelector('#dash-detail', { state: 'hidden' });

        // ---- Tocar la zona vacía de una columna: sólo cambia el mes ----------
        await page.locator('#dash-chart').tap({ position: await punto(null, -2) });
        await page.waitForFunction((k) => document.querySelector('#dash-mes').value === k, monthKey(3));
        assert.equal(await page.locator('#dash-detail').isHidden(), true, 'zona vacía no abre detalle');
        await page.fill('#dash-mes', monthKey(1));
        await page.locator('#dash-mes').dispatchEvent('change');
        await page.waitForFunction((k) => document.querySelector('#dash-mes').value === k && !document.querySelector('#dash-detail:not([hidden])'), monthKey(1));
        e = await estado();
        // chartMonths() termina la ventana en el mes elegido: pasa a ser la última columna.
        const mesTocado = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
          .toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
        assert.equal(e.labels.at(-1), mesTocado, 'la ventana termina en el mes elegido');
        assert.ok(e.series.length <= 6 && e.series.at(-1).otros);
        assert.deepEqual(e.sumas, totales(1));
        assertMarca(e, e.labels.length - 1);
        assert.deepEqual((await desglose()).map((r) => r[0]),
          [n('B'), n('A'), n('J'), n('M'), n('E'), n('F'), n('L'), n('C'), n('I'), n('H')], 'desglose del mes elegido');
        const dPrev = await deltas();
        assert.equal(dPrev[n('B')][0], '↑ $700'); assert.equal(dPrev[n('A')][0], '↑ $500');
        await page.locator('#dash-chart').scrollIntoViewIfNeeded();
        await quieto();
        await page.screenshot({ path: path.join(out, `dashboard-movil-${width}-mes-tocado.png`), fullPage: true });

        // ---- Tocar un nombre del desglose abre el detalle ----------------
        await page.locator('#dash-desglose-list .desg-row', { hasText: n('M') }).tap();
        await page.waitForSelector('#dash-detail:not([hidden])');
        assert.equal(await page.locator('#dash-detail-name').innerText(), n('M'));
        assert.match(await page.locator('#dash-detail-summary').innerText(), /1 vale activo · \$1,000/);
        assert.equal(await page.locator('#dash-desglose-list .desg-row--selected').innerText().then((t) => t.includes(n('M'))), true);
        await quieto();
        await page.screenshot({ path: path.join(out, `dashboard-movil-${width}-detalle.png`) });
        await page.click('#dash-detail-close');

        // ---- Cruzar el umbral: ≥600 todas las series; <600 vuelve a ≤6 -------
        await page.setViewportSize({ width: 700, height: 900 });
        await page.waitForFunction(() => window.Chart.getChart(document.querySelector('#dash-chart')).data.datasets.length > 6);
        assert.equal(await page.locator('#dash-desglose').isVisible(), false);
        assert.ok(await page.locator('#dash-legend .legend-item').count() > 6);
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() => window.Chart.getChart(document.querySelector('#dash-chart')).data.datasets.length <= 6);
        assert.equal(await page.locator('#dash-desglose').isVisible(), true);
        res.movil = 'top5+Otros · sumas = total · segmento → mes + detalle · Otros/zona vacía → sólo mes · umbral OK';
      } else {
        // ---- Escritorio: apilada con leyenda, sin desglose ---------------
        const c = await chart();
        assert.ok(c.datasets.length >= 13, `apilada por solicitante (${c.datasets.length})`);
        assert.ok(c.datasets.every((d) => d.stack === 'total'));
        assert.notEqual(c.tooltip, false);
        assert.equal(await page.locator('#dash-legend .legend-item').count(), c.datasets.length);
        assert.equal(await page.locator('#dash-legend').isVisible(), true);
        assert.equal(await page.locator('#dash-desglose').isVisible(), false);
        assert.match(await page.locator('#dash-chart-hint').innerText(), /toca un segmento para abrir el detalle/);
        // Clic en el segmento de Jorge del mes en curso → detalle (como antes).
        await page.waitForFunction(() => !window.Chart.animator.running(window.Chart.getChart(document.querySelector('#dash-chart'))));
        const pos = await page.evaluate((name) => {
          const ch = window.Chart.getChart(document.querySelector('#dash-chart'));
          const i = ch.data.datasets.findIndex((d) => d.label === name);
          const bar = ch.getDatasetMeta(i).data.at(-1);
          return { x: bar.x, y: (bar.y + bar.base) / 2 };
        }, n('J'));
        await page.locator('#dash-chart').click({ position: pos });
        await page.waitForSelector('#dash-detail:not([hidden])');
        assert.equal(await page.locator('#dash-detail-name').innerText(), n('J'));
        await page.click('#dash-detail-close');
        await quieto();
        await page.screenshot({ path: path.join(out, `dashboard-escritorio-${width}.png`), fullPage: true });
        res.escritorio = `apilada (${c.datasets.length} series) · leyenda · clic en segmento → detalle`;
      }

      // ---- Rango personalizado: sin comparación ---------------------------
      await page.fill('#dash-from', `${monthKey(1)}-05`);
      await page.locator('#dash-from').dispatchEvent('change');
      await page.waitForFunction(() => !document.querySelector('#dash-mes').value);
      assert.equal(await page.locator('#dash-top .lb-delta').count(), 0, 'sin comparación con rango personalizado');
      res.rangoPersonalizado = 'sin marcas';

      assert.equal(await page.evaluate(() => window.__writes), 0);
      assert.deepEqual(errors, []);
      results.push(res);
      await context.close();
    }
    console.log(JSON.stringify({ capturas: out, results }, null, 2));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
