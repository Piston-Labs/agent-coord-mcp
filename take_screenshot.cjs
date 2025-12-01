const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Set viewport to a good desktop size
  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('Navigating to dashboard...');
  await page.goto('https://agent-coord-mcp.vercel.app/', { waitUntil: 'networkidle' });

  // Wait for loading screen to disappear
  console.log('Waiting for loading screen to disappear...');
  await page.waitForSelector('#loadingScreen', { state: 'hidden', timeout: 15000 }).catch(() => {
    console.log('Loading screen timeout - continuing anyway');
  });

  // Wait a bit more for content
  await page.waitForTimeout(2000);

  // Take screenshot of initial view
  console.log('Taking screenshot of Chat tab...');
  await page.screenshot({ path: 'screenshot_chat.png', fullPage: true });

  // Click on Telemetry tab
  console.log('Clicking Telemetry tab...');
  await page.click('button[data-tab="telemetry"]');

  // Wait for telemetry content to load
  await page.waitForTimeout(3000);

  // Take screenshot of telemetry view
  console.log('Taking screenshot of Telemetry tab...');
  await page.screenshot({ path: 'screenshot_telemetry.png', fullPage: true });

  // Scroll down to see if there's more content
  await page.evaluate(() => {
    const tabContent = document.querySelector('.tab-content.active');
    if (tabContent) tabContent.scrollTop = tabContent.scrollHeight;
  });
  await page.waitForTimeout(1000);

  // Take screenshot after scrolling
  console.log('Taking screenshot after scrolling...');
  await page.screenshot({ path: 'screenshot_telemetry_scrolled.png', fullPage: true });

  // Get some debug info
  const tableExists = await page.evaluate(() => {
    const tbody = document.getElementById('deviceListBody');
    const container = document.getElementById('deviceListContainer');
    return {
      tbodyExists: !!tbody,
      tbodyRowCount: tbody ? tbody.children.length : 0,
      tbodyHTML: tbody ? tbody.innerHTML.substring(0, 500) : 'N/A',
      containerExists: !!container,
      containerDisplay: container ? getComputedStyle(container).display : 'N/A',
      containerVisibility: container ? getComputedStyle(container).visibility : 'N/A',
      containerHeight: container ? container.offsetHeight : 0
    };
  });

  console.log('Debug info:', JSON.stringify(tableExists, null, 2));

  await browser.close();
  console.log('Done!');
})();
