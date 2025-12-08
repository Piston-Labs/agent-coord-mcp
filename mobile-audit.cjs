const { chromium } = require('playwright');

async function auditMobile() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();
  
  // Go to hub
  console.log('Navigating to hub...');
  await page.goto('https://agent-coord-mcp.vercel.app');
  await page.waitForTimeout(3000);
  
  // Login using correct credentials (admin/piston2025)
  console.log('Logging in...');
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'piston2025');
  
  // Click the login button via form submit
  await page.click('#loginForm button[type="submit"]');
  await page.waitForTimeout(4000);
  
  // Screenshot after login - dashboard
  console.log('Taking dashboard screenshot...');
  await page.screenshot({ path: 'mobile-01-dashboard.png', fullPage: false });
  
  // Navigate to each section using JavaScript
  const sections = [
    { name: 'chat', selector: 'Chat' },
    { name: 'crm', selector: 'CRM' },
    { name: 'research', selector: 'Research' },
    { name: 'philosophy', selector: 'Philosophy' },
    { name: 'fleet', selector: 'Fleet' },
    { name: 'telemetry', selector: 'Telemetry' }
  ];
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    console.log(`Navigating to ${section.name}...`);
    
    // Try to click via mobile nav or nav tabs
    await page.evaluate((sectionName) => {
      // Try mobile nav items first
      const mobileNav = document.querySelectorAll('.mobile-nav-item');
      for (const item of mobileNav) {
        if (item.textContent && item.textContent.toLowerCase().includes(sectionName.toLowerCase())) {
          item.click();
          return 'clicked mobile-nav';
        }
      }
      // Try nav tabs
      const navTabs = document.querySelectorAll('.nav-tab, [data-tab]');
      for (const tab of navTabs) {
        if (tab.textContent && tab.textContent.toLowerCase().includes(sectionName.toLowerCase())) {
          tab.click();
          return 'clicked nav-tab';
        }
      }
      // Try any element with the text
      const allElements = document.querySelectorAll('span, div, button, a');
      for (const el of allElements) {
        if (el.textContent && el.textContent.trim().toLowerCase() === sectionName.toLowerCase()) {
          el.click();
          return 'clicked element';
        }
      }
      return 'not found';
    }, section.selector);
    
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `mobile-0${i+2}-${section.name}.png`, fullPage: false });
  }
  
  // Take full page screenshot
  console.log('Taking full page screenshot...');
  await page.screenshot({ path: 'mobile-fullpage.png', fullPage: true });
  
  await browser.close();
  console.log('Mobile audit complete!');
}

auditMobile().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
