const { chromium } = require('playwright');

async function auditMobile() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  
  // Go to hub
  await page.goto('https://agent-coord-mcp.vercel.app');
  await page.waitForTimeout(2000);
  
  // Login
  await page.fill('input[placeholder="Enter username"]', 'tyler3');
  await page.fill('input[placeholder="Enter password"]', 'piston');
  await page.click('button:has-text("Login")');
  await page.waitForTimeout(3000);
  
  // Screenshot home/dashboard
  await page.screenshot({ path: 'mobile-01-dashboard.png', fullPage: false });
  
  // Click Chat tab
  await page.click('.mobile-nav-item:has-text("Chat")').catch(() => {
    console.log('Chat nav not found, trying alternative');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-02-chat.png', fullPage: false });
  
  // Click CRM/Sales tab
  await page.click('.mobile-nav-item:has-text("CRM")').catch(() => {
    console.log('CRM nav not found');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-03-crm.png', fullPage: false });
  
  // Click Research tab
  await page.click('text=Research').catch(() => {
    console.log('Research nav not found');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-04-research.png', fullPage: false });
  
  // Click Philosophy tab
  await page.click('text=Philosophy').catch(() => {
    console.log('Philosophy nav not found');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-05-philosophy.png', fullPage: false });
  
  // Click Fleet tab
  await page.click('text=Fleet').catch(() => {
    console.log('Fleet nav not found');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-06-fleet.png', fullPage: false });
  
  // Click Telemetry tab
  await page.click('text=Telemetry').catch(() => {
    console.log('Telemetry nav not found');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'mobile-07-telemetry.png', fullPage: false });
  
  await browser.close();
  console.log('Mobile audit screenshots complete');
}

auditMobile().catch(console.error);
