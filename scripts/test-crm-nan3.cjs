const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  
  const timestamp = Date.now();
  console.log('Loading with timestamp:', timestamp);
  await page.goto(`https://agent-coord-mcp.vercel.app/?v=${timestamp}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Login
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'piston2025');
  await page.click('button:has-text("Login")');
  await page.waitForTimeout(3000);
  await page.waitForSelector('#loginOverlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
  
  // Navigate to CRM
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(3000);
  
  // Screenshot pipeline view
  await page.screenshot({ path: 'crm-nan-fixed.png', fullPage: false });
  console.log('Screenshot saved: crm-nan-fixed.png');
  
  // Test formatTimeAgo
  const testResults = await page.evaluate(() => {
    if (typeof formatTimeAgo === 'function') {
      return {
        null: formatTimeAgo(null),
        undefined: formatTimeAgo(undefined),
        empty: formatTimeAgo(''),
        invalid: formatTimeAgo('invalid'),
        valid: formatTimeAgo('2025-12-02T00:02:48.217Z'),
        recent: formatTimeAgo(new Date().toISOString())
      };
    }
    return { error: 'formatTimeAgo not found' };
  });
  
  console.log('\n=== formatTimeAgo test results ===');
  console.log(JSON.stringify(testResults, null, 2));
  
  // Check for NaN in the page
  const nanFound = await page.evaluate(() => {
    const crm = document.querySelector('#crmContent');
    return crm ? crm.textContent.includes('NaN') : 'CRM not found';
  });
  
  console.log('\nNaN found in CRM:', nanFound);
  
  await browser.close();
})();
