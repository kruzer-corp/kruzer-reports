const puppeteer = require('puppeteer');

const DASHBOARD_USER = 'kruzer';
const DASHBOARD_PASSWORD = 'troque-essa-senha';
const BASE_URL = 'http://localhost:8787';

const auth = Buffer.from(`${DASHBOARD_USER}:${DASHBOARD_PASSWORD}`).toString('base64');

async function testDashboard(page, path, name, expectedElements) {
  console.log(`\n🧪 Testing ${name} (${path})...`);
  
  try {
    // Navigate with auth header
    await page.setExtraHTTPHeaders({
      'Authorization': `Basic ${auth}`
    });
    
    const response = await page.goto(`${BASE_URL}${path}`, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    if (!response.ok()) {
      console.log(`❌ Failed to load: HTTP ${response.status()}`);
      return false;
    }
    
    // Wait for content to load (increase timeout for KRZR)
    const delay = name.includes('KRZR') ? 5000 : 3000;
    await page.evaluate((ms) => new Promise(r => setTimeout(r, ms)), delay);
    
    // Check for expected elements
    let foundCount = 0;
    for (const selector of expectedElements) {
      const exists = await page.$(selector) !== null;
      if (exists) {
        console.log(`  ✅ Found: ${selector}`);
        foundCount++;
      } else {
        console.log(`  ⚠️ Missing: ${selector}`);
      }
    }
    
    // Get page title
    const title = await page.title();
    console.log(`  📄 Title: ${title}`);
    
    // Check data loading
    const dataLoaded = await page.evaluate(() => {
      return {
        hasContent: document.getElementById('content') && 
                   document.getElementById('content').style.display !== 'none',
        hasLoading: document.getElementById('loadingBox') && 
                   document.getElementById('loadingBox').style.display !== 'none',
        errorBox: document.getElementById('errorBox')?.textContent || ''
      };
    });
    
    console.log(`  📊 Data loaded: ${dataLoaded.hasContent}`);
    console.log(`  ⏳ Still loading: ${dataLoaded.hasLoading}`);
    if (dataLoaded.errorBox) console.log(`  ⚠️ Error: ${dataLoaded.errorBox.substring(0, 150)}`);
    
    // PASS if content is loaded and at least 80% of elements found
    const success = dataLoaded.hasContent && !dataLoaded.hasLoading && 
                    (foundCount / expectedElements.length) >= 0.8 && 
                    !dataLoaded.errorBox;
    
    return success;
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    return false;
  }
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set larger viewport
  await page.setViewport({ width: 1280, height: 800 });
  
  console.log('🚀 Verifying Kruzer Dashboards...');
  
  // Test homepage
  console.log('\n📍 Testing Homepage');
  await page.setExtraHTTPHeaders({
    'Authorization': `Basic ${auth}`
  });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  const homepage = await page.$eval('h1', el => el.textContent);
  console.log(`  ✅ Title: ${homepage}`);
  
  // Test each dashboard
  const results = {};
  
  results.krzr = await testDashboard(page, '/krzr.html', 'KRZR Service Desk', [
    '#statusChart',
    '#agingBracketChart', 
    '#trendChart',
    '#agingTable'
  ]);
  
  results.vena = await testDashboard(page, '/vena.html', 'VENA Dev', [
    '#statusChart',
    '#typeChart',
    '#agingBracketChart',
    '#trendChart',
    '#agingTable'
  ]);
  
  results.fst = await testDashboard(page, '/fst.html', 'FST FastShop', [
    '#demandsTable',
    '#swimlane',
    '#kpis'
  ]);
  
  await browser.close();
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY:');
  console.log(`  KRZR: ${results.krzr ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  VENA: ${results.vena ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  FST:  ${results.fst ? '✅ PASS' : '❌ FAIL'}`);
  
  process.exit(Object.values(results).every(r => r) ? 0 : 1);
}

main().catch(console.error);
