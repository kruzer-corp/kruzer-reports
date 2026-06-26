// Smoke test pós-deploy / pós-refactor.
// Atualizado 2026-06-25 pra refletir rotas atuais e novo /ops/.
// Uso: `npm run dev` em outro terminal, depois `node scripts/verify-dashboards.js`.

const puppeteer = require('puppeteer');

const DASHBOARD_USER = process.env.DASHBOARD_USER || 'kruzer';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'troque-essa-senha';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
const auth = Buffer.from(`${DASHBOARD_USER}:${DASHBOARD_PASSWORD}`).toString('base64');

// Cada rota declara seletores essenciais que precisam existir após o load.
// Manter conservador: só seletores que provam que o JS rodou e o DOM renderizou.
const ROUTES = [
  { path: '/',           name: 'Home',              selectors: ['a.card.ops', 'a.card.krzr', 'a.card.vena'] },
  { path: '/ops/',       name: 'Ops · Cockpit',     selectors: ['#healthGrid', '#riskList', '#milesSvg'] },
  { path: '/krzr/',      name: 'KRZR · Service',    selectors: ['canvas', 'table, .gridjs-wrapper'] },
  { path: '/krzr/hml',   name: 'KRZR HML · v2',     selectors: ['canvas', 'table, .gridjs-wrapper'] },
  { path: '/vena/',      name: 'VENA · Dev',        selectors: ['canvas', 'table, .gridjs-wrapper'] },
  { path: '/vena/capacity', name: 'VENA · Planner', selectors: ['.lane', '.kpi, .block, .lane-head'] },
  { path: '/vena/roadmap',  name: 'VENA · Report',  selectors: ['#ganttSvg, svg', 'table, .gridjs-wrapper'] },
  { path: '/fst/',          name: 'FST · Report',   selectors: ['#ganttSvg, svg', 'table, .gridjs-wrapper'] },
  { path: '/fst/capacity',  name: 'FST · Planner',  selectors: ['.lane', '.kpi, .block, .lane-head'] },
  { path: '/pgm/',          name: 'PGM · Report',   selectors: ['#ganttSvg, svg', 'table, .gridjs-wrapper'] },
  { path: '/pgm/capacity',  name: 'PGM · Planner',  selectors: ['.lane', '.kpi, .block, .lane-head'] },
  { path: '/timeline/',     name: 'Cross · Gantt',  selectors: ['#ganttSvg'] },
];

async function checkRoute(page, route) {
  console.log(`\n🧪 ${route.name} (${route.path})`);
  try {
    const response = await page.goto(BASE_URL + route.path, { waitUntil: 'networkidle2', timeout: 30000 });
    if (!response.ok()) { console.log(`  ❌ HTTP ${response.status()}`); return false; }

    // Espera o JS terminar de pendurar o DOM (delay maior pros que fazem JQL).
    const delay = route.path === '/' ? 1000 : (route.path.includes('/krzr') ? 5000 : 3000);
    await page.evaluate(ms => new Promise(r => setTimeout(r, ms)), delay);

    let found = 0;
    for (const sel of route.selectors) {
      const exists = await page.$(sel) !== null;
      console.log(`  ${exists ? '✅' : '⚠️'}  ${sel}`);
      if (exists) found++;
    }

    const dataLoaded = await page.evaluate(() => {
      const content = document.getElementById('content');
      const loading = document.getElementById('loadingBox');
      const error = document.getElementById('errorBox')?.textContent || '';
      return {
        hasContent: !content || content.style.display !== 'none',
        stillLoading: loading && loading.style.display !== 'none',
        error,
      };
    });
    if (dataLoaded.error) console.log(`  ⚠️  Erro na página: ${dataLoaded.error.substring(0, 120)}`);
    if (dataLoaded.stillLoading) console.log(`  ⚠️  Ainda carregando após ${delay}ms`);

    return found >= Math.ceil(route.selectors.length * 0.8) && !dataLoaded.error && !dataLoaded.stillLoading;
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    return false;
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ Authorization: `Basic ${auth}` });

  console.log(`🚀 Verifying ${BASE_URL}`);

  const results = {};
  for (const route of ROUTES) {
    results[route.name] = await checkRoute(page, route);
  }
  await browser.close();

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  let pass = 0, fail = 0;
  for (const [name, ok] of Object.entries(results)) {
    console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n${pass}/${pass + fail} routes passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
