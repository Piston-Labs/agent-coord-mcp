const { chromium } = require('playwright');

async function testLocalMobile() {
  const browser = await chromium.launch({ headless: true });
  
  const viewports = [
    { name: 'local-iphone-se', width: 375, height: 667 },
    { name: 'local-iphone-14', width: 390, height: 844 },
    { name: 'local-tablet', width: 768, height: 1024 },
  ];

  for (const vp of viewports) {
    console.log(`Testing ${vp.name} (${vp.width}x${vp.height})...`);
    
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    
    const page = await context.newPage();
    
    try {
      await page.goto('http://127.0.0.1:8080', { 
        waitUntil: 'networkidle',
        timeout: 10000 
      });
      
      await page.waitForTimeout(1000);
      
      // Check if login modal shows
      const loginOverlay = await page.$('#loginOverlay');
      if (loginOverlay && await loginOverlay.isVisible()) {
        await page.fill('#loginUsername', 'admin');
        await page.fill('#loginPassword', 'piston2025');
        await page.click('#loginForm button[type="submit"]');
        await page.waitForTimeout(2000);
      }
      
      // Click telemetry tab
      const telemetryTab = await page.$('[data-tab="telemetry"]');
      if (telemetryTab) await telemetryTab.click();
      await page.waitForTimeout(1000);
      
      await page.screenshot({ 
        path: `${vp.name}-telemetry.png`,
        fullPage: true 
      });
      console.log(`  Screenshot: ${vp.name}-telemetry.png`);
      
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
    
    await context.close();
  }

  await browser.close();
  console.log('Done!');
}

testLocalMobile().catch(console.error);
