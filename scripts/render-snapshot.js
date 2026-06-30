#!/usr/bin/env node
// ============================================================================
// Rede de segurança pra refatoração de páginas (consolidação — item 2).
// Captura um snapshot NORMALIZADO do DOM renderizado de cada página e compara
// com o baseline. Zero diff = zero drift visual/funcional.
//
// Uso:
//   node scripts/render-snapshot.js --baseline    # captura o estado ATUAL (antes)
//   node scripts/render-snapshot.js               # compara com o baseline (depois)
//
// Precisa do `wrangler dev` rodando em localhost:8787 e credenciais no .dev.vars.
// Normaliza partes voláteis (timestamps "atualizado…", datas geradas) pra não
// gerar falso-positivo entre a captura antes e depois.
// ============================================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const SNAP_DIR = path.join(__dirname, '__snapshots__');
const MODE = process.argv.includes('--baseline') ? 'baseline' : 'compare';

// Páginas a cobrir + o container cujo HTML renderizado vira o snapshot, e quanto
// esperar (as que fazem JQL + render precisam de mais tempo).
const PAGES = [
  { name: 'fst-report',   path: '/fst/',         sel: '#content, body', waitMs: 6000 },
  { name: 'pgm-report',   path: '/pgm/',         sel: '#content, body', waitMs: 6000 },
  { name: 'vena-report',  path: '/vena/roadmap', sel: '#content, body', waitMs: 6000 },
];

function creds() {
  const v = {};
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.dev.vars'), 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.length > 1 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) val = val.slice(1, -1);
    v[m[1]] = val;
  }
  return Buffer.from(`${v.DASHBOARD_USER}:${v.DASHBOARD_PASSWORD}`).toString('base64');
}

// Remove ruído volátil que muda entre cargas (mas não é "drift" de verdade).
function normalize(html) {
  return html
    // timestamps de "atualizado em DD/MM/YYYY HH:MM:SS"
    .replace(/\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}(:\d{2})?/g, '«TS»')
    .replace(/atualizado[^<·]*/gi, 'atualizado «TS»')
    // ids de bibliotecas (gridjs) que mudam por carga
    .replace(/gridjs-\w+/g, 'gridjs-«id»')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
  const auth = creds();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  // viewport fixo → gantt SVG (clientWidth-dependent) determinístico
  let pass = 0, fail = 0;
  for (const P of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1200 });
    await page.setExtraHTTPHeaders({ Authorization: 'Basic ' + auth });
    let snap = '';
    try {
      await page.goto(BASE + P.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, P.waitMs));
      snap = await page.evaluate(s => {
        const el = document.querySelector(s.split(',')[0].trim()) || document.body;
        return el.innerHTML;
      }, P.sel);
    } catch (e) { snap = 'ERROR: ' + e.message; }
    await page.close();
    snap = normalize(snap);
    const file = path.join(SNAP_DIR, P.name + '.html');
    if (MODE === 'baseline') {
      fs.writeFileSync(file, snap);
      console.log(`  📸 baseline ${P.name} (${snap.length} chars)`);
      pass++;
    } else {
      if (!fs.existsSync(file)) { console.log(`  ❌ ${P.name} — sem baseline`); fail++; continue; }
      const base = fs.readFileSync(file, 'utf8');
      if (base === snap) { console.log(`  ✅ ${P.name} — render idêntico (${snap.length} chars)`); pass++; }
      else {
        fail++;
        // acha o primeiro ponto de divergência pra orientar
        let i = 0; while (i < base.length && i < snap.length && base[i] === snap[i]) i++;
        console.log(`  ❌ ${P.name} — DRIFT no char ${i}`);
        console.log(`     baseline: …${base.slice(Math.max(0, i - 40), i + 60)}…`);
        console.log(`     atual:    …${snap.slice(Math.max(0, i - 40), i + 60)}…`);
      }
    }
  }
  await browser.close();
  console.log(`\n${MODE === 'baseline' ? 'Baselines gravados' : 'RESULTADO'}: ${pass} ok, ${fail} drift`);
  process.exit(fail ? 1 : 0);
})();
