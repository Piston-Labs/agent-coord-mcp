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
  
  // Screenshot Chat tab (default)
  await page.screenshot({ path: 'tab-chat.png', fullPage: false });
  console.log('Saved: tab-chat.png');
  
  // Check if CRM is visible on Chat tab
  const chatCheck = await page.evaluate(() => {
    const crmView = document.getElementById('crmView');
    const crmPipeline = document.querySelector('.crm-pipeline');
    return {
      crmViewDisplay: crmView ? getComputedStyle(crmView).display : 'not found',
      crmViewVisible: crmView ? crmView.offsetHeight > 0 : false,
      crmPipelineVisible: crmPipeline ? crmPipeline.offsetHeight > 0 : false,
      activeTab: document.querySelector('.tab-btn.active')?.dataset?.tab
    };
  });
  console.log('Chat tab check:', JSON.stringify(chatCheck, null, 2));
  
  // Go to Roadmap
  await page.click('button[data-tab="roadmap"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tab-roadmap.png', fullPage: false });
  console.log('Saved: tab-roadmap.png');
  
  // Go to Telemetry
  await page.click('button[data-tab="telemetry"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tab-telemetry.png', fullPage: false });
  console.log('Saved: tab-telemetry.png');
  
  // Go to CRM
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tab-crm.png', fullPage: false });
  console.log('Saved: tab-crm.png');
  
  await browser.close();
})();
