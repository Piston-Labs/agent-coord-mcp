const { chromium } = require('playwright');

async function testMobileResponsiveness() {
  const browser = await chromium.launch({ headless: true });
  
  // Test on iPhone 12 Pro dimensions
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  
  const page = await context.newPage();
  
  console.log('Navigating to hub...');
  await page.goto('https://agent-coord-mcp.vercel.app', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Take screenshot of login page
  await page.screenshot({ path: 'mobile-01-login.png', fullPage: true });
  console.log('Saved: mobile-01-login.png');
  
  // Login with admin credentials
  const loginForm = await page.$('#loginForm');
  if (loginForm) {
    console.log('Logging in as admin...');
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'piston2025');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForTimeout(3000);
    
    await page.screenshot({ path: 'mobile-02-dashboard.png', fullPage: true });
    console.log('Saved: mobile-02-dashboard.png');
  }
  
  // Check if login overlay is gone
  const overlay = await page.$('#loginOverlay');
  const overlayVisible = overlay ? await overlay.isVisible() : false;
  console.log('Login overlay visible:', overlayVisible);
  
  if (!overlayVisible) {
    // Try mobile nav for telemetry
    console.log('Looking for mobile navigation...');
    const mobileNavBtn = await page.$('.mobile-nav-item[data-panel="telemetry"]');
    if (mobileNavBtn) {
      console.log('Found mobile telemetry button, clicking...');
      await mobileNavBtn.click();
      await page.waitForTimeout(2000);
    } else {
      // Try desktop tab
      const desktopTab = await page.$('button[data-tab="telemetry"]');
      if (desktopTab) {
        console.log('Found desktop telemetry tab, clicking...');
        await desktopTab.click();
        await page.waitForTimeout(2000);
      }
    }
    
    await page.screenshot({ path: 'mobile-03-telemetry.png', fullPage: true });
    console.log('Saved: mobile-03-telemetry.png');
    
    // Scroll down to see more content
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'mobile-04-telemetry-scrolled.png', fullPage: true });
    console.log('Saved: mobile-04-telemetry-scrolled.png');
  }
  
  // Get element dimensions for debugging
  const debugInfo = await page.evaluate(() => {
    const info = {};
    
    const telemetryView = document.getElementById('telemetryView');
    if (telemetryView) {
      const rect = telemetryView.getBoundingClientRect();
      info.telemetryView = { width: rect.width, height: rect.height, display: getComputedStyle(telemetryView).display };
    }
    
    const deviceList = document.querySelector('.device-list-container');
    if (deviceList) {
      const rect = deviceList.getBoundingClientRect();
      info.deviceList = { width: rect.width, height: rect.height, overflow: getComputedStyle(deviceList).overflow };
    }
    
    const fleetSummary = document.querySelector('.fleet-summary');
    if (fleetSummary) {
      const rect = fleetSummary.getBoundingClientRect();
      info.fleetSummary = { width: rect.width, display: getComputedStyle(fleetSummary).display, flexWrap: getComputedStyle(fleetSummary).flexWrap };
    }
    
    const table = document.querySelector('.device-list-table');
    if (table) {
      const rect = table.getBoundingClientRect();
      info.table = { width: rect.width, overflow: getComputedStyle(table.parentElement).overflowX };
    }
    
    info.viewport = { width: window.innerWidth, height: window.innerHeight };
    
    return info;
  });
  
  console.log('\n=== Debug Info ===');
  console.log(JSON.stringify(debugInfo, null, 2));
  
  await browser.close();
  console.log('\nDone! Check the PNG files.');
}

testMobileResponsiveness().catch(console.error);
