const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  
  const timestamp = Date.now();
  await page.goto(`https://agent-coord-mcp.vercel.app/?v=${timestamp}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Login
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'piston2025');
  await page.click('button:has-text("Login")');
  await page.waitForTimeout(3000);
  await page.waitForSelector('#loginOverlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
  
  // Navigate to Telemetry
  await page.click('button[data-tab="telemetry"]');
  await page.waitForTimeout(2000);
  
  // Screenshot telemetry view
  await page.screenshot({ path: 'telemetry-view.png', fullPage: false });
  console.log('Saved: telemetry-view.png');
  
  // Get telemetry API data
  const apiData = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/telemetry');
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  });
  
  console.log('\n=== Telemetry API Data ===');
  console.log(JSON.stringify(apiData, null, 2));
  
  await browser.close();
})();
