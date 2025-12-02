const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  // Clear cache by using new context
  const context = await browser.newContext({ 
    viewport: { width: 1400, height: 900 },
    bypassCSP: true
  });
  const page = await context.newPage();
  
  // Clear all caches
  await context.clearCookies();
  
  const timestamp = Date.now();
  console.log('Loading with timestamp:', timestamp);
  await page.goto(`https://agent-coord-mcp.vercel.app/?nocache=${timestamp}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check if formatTimeAgo fix is present
  const fixPresent = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return html.includes("if (!dateString) return 'N/A'");
  });
  console.log('Fix present in page:', fixPresent);
  
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
  await page.screenshot({ path: 'crm-nan-test2.png', fullPage: false });
  
  // Search for NaN or N/A text in the CRM area only
  const crmText = await page.evaluate(() => {
    const crm = document.querySelector('#crmContent');
    if (!crm) return { error: 'CRM content not found' };
    
    const cards = crm.querySelectorAll('.crm-shop-card');
    const results = [];
    
    cards.forEach((card, i) => {
      const footer = card.querySelector('.crm-shop-footer');
      const lastContact = card.querySelector('.crm-last-contact');
      results.push({
        cardIndex: i,
        footerText: footer?.textContent?.trim(),
        lastContactText: lastContact?.textContent?.trim()
      });
    });
    
    return results;
  });
  
  console.log('\n=== Shop Card Footer Contents ===');
  console.log(JSON.stringify(crmText, null, 2));
  
  // Check what formatTimeAgo returns for various inputs
  const testResults = await page.evaluate(() => {
    // Find the function in the page
    if (typeof formatTimeAgo === 'function') {
      return {
        null: formatTimeAgo(null),
        undefined: formatTimeAgo(undefined),
        empty: formatTimeAgo(''),
        invalid: formatTimeAgo('invalid'),
        valid: formatTimeAgo('2025-12-02T00:02:48.217Z')
      };
    }
    return { error: 'formatTimeAgo not found' };
  });
  
  console.log('\n=== formatTimeAgo test results ===');
  console.log(JSON.stringify(testResults, null, 2));
  
  await browser.close();
})();
