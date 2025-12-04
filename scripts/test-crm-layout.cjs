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
  
  // Navigate to CRM
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(2000);
  
  // Screenshot pipeline view
  await page.screenshot({ path: 'crm-layout-fixed.png', fullPage: false });
  console.log('Screenshot saved: crm-layout-fixed.png');
  
  // Check if pipeline bleeds over
  const layoutCheck = await page.evaluate(() => {
    const pipeline = document.querySelector('.crm-pipeline');
    const rightPanel = document.querySelector('aside, .panel:last-child');
    
    if (!pipeline) return { error: 'Pipeline not found' };
    
    const pipelineRect = pipeline.getBoundingClientRect();
    const rightPanelRect = rightPanel?.getBoundingClientRect();
    
    return {
      pipelineRight: pipelineRect.right,
      pipelineWidth: pipelineRect.width,
      rightPanelLeft: rightPanelRect?.left,
      viewportWidth: window.innerWidth,
      overflowsViewport: pipelineRect.right > window.innerWidth,
      overflowsRightPanel: rightPanelRect ? pipelineRect.right > rightPanelRect.left : false,
      scrollWidth: pipeline.scrollWidth,
      clientWidth: pipeline.clientWidth,
      hasHorizontalScroll: pipeline.scrollWidth > pipeline.clientWidth
    };
  });
  
  console.log('\n=== Layout Check ===');
  console.log(JSON.stringify(layoutCheck, null, 2));
  
  await browser.close();
})();
