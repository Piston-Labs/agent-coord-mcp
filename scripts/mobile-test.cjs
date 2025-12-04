const { chromium } = require('playwright');

async function testMobileResponsiveness() {
  const browser = await chromium.launch({ headless: true });
  
  // Test different mobile viewport sizes
  const viewports = [
    { name: 'iphone-se', width: 375, height: 667 },
    { name: 'iphone-14', width: 390, height: 844 },
    { name: 'iphone-14-pro-max', width: 430, height: 932 },
    { name: 'pixel-7', width: 412, height: 915 },
    { name: 'tablet', width: 768, height: 1024 },
  ];

  for (const vp of viewports) {
    console.log(`\nTesting ${vp.name} (${vp.width}x${vp.height})...`);
    
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    
    const page = await context.newPage();
    
    try {
      // Go to the hub
      await page.goto('https://agent-coord-mcp.vercel.app', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait for page to load
      await page.waitForTimeout(2000);
      
      // Check if login modal is showing and login
      const loginOverlay = await page.$('#loginOverlay');
      const isLoginVisible = loginOverlay ? await loginOverlay.isVisible() : false;
      
      if (isLoginVisible) {
        console.log('  Logging in...');
        
        // Fill login form
        await page.fill('#loginUsername', 'admin');
        await page.fill('#loginPassword', 'piston2025');
        
        // Submit
        await page.click('#loginForm button[type="submit"]');
        
        // Wait for login to complete
        await page.waitForTimeout(3000);
        
        // Check if login was successful
        const stillVisible = await loginOverlay.isVisible();
        if (stillVisible) {
          console.log('  Login may have failed, taking screenshot anyway');
          await page.screenshot({ path: `screenshot-${vp.name}-login-failed.png` });
          await context.close();
          continue;
        }
        
        console.log('  Login successful!');
      }
      
      // Now navigate to telemetry tab
      await page.waitForTimeout(1000);
      
      // Try clicking telemetry tab - check for mobile nav first
      const mobileNav = await page.$('.mobile-nav');
      const isMobileNavVisible = mobileNav ? await mobileNav.isVisible() : false;
      
      if (isMobileNavVisible) {
        console.log('  Using mobile navigation');
        const telemetryMobileBtn = await page.$('.mobile-nav-item[data-panel="telemetry"]');
        if (telemetryMobileBtn) {
          await telemetryMobileBtn.click();
        }
      } else {
        console.log('  Using desktop tab navigation');
        const telemetryTab = await page.$('[data-tab="telemetry"], .tab:has-text("Telemetry")');
        if (telemetryTab) {
          await telemetryTab.click();
        }
      }
      
      await page.waitForTimeout(2000);
      
      // Take screenshot of telemetry section
      await page.screenshot({ 
        path: `screenshot-${vp.name}-telemetry.png`,
        fullPage: true 
      });
      console.log(`  Screenshot saved: screenshot-${vp.name}-telemetry.png`);
      
    } catch (error) {
      console.log(`  Error: ${error.message}`);
      await page.screenshot({ 
        path: `screenshot-${vp.name}-error.png`,
        fullPage: false 
      });
    }
    
    await context.close();
  }

  await browser.close();
  console.log('\nDone! Check the screenshot files.');
}

testMobileResponsiveness().catch(console.error);
