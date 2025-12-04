const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('Navigating to dashboard...');
  await page.goto('https://agent-coord-mcp.vercel.app/', { waitUntil: 'networkidle' });

  console.log('Waiting for loading screen to disappear...');
  await page.waitForSelector('#loadingScreen', { state: 'hidden', timeout: 15000 }).catch(() => {
    console.log('Loading screen timeout - continuing anyway');
  });

  await page.waitForTimeout(2000);

  // Click on Telemetry tab
  console.log('Clicking Telemetry tab...');
  await page.click('button[data-tab="telemetry"]');

  await page.waitForTimeout(3000);

  console.log('Taking screenshot of Telemetry tab...');
  await page.screenshot({ path: 'screenshot_telemetry_new.png', fullPage: true });

  // Get debug info
  const info = await page.evaluate(() => {
    const grid = document.getElementById('telemetryGrid');
    const list = document.getElementById('deviceListContainer');
    const tbody = document.getElementById('deviceListBody');
    return {
      gridDisplay: grid ? getComputedStyle(grid).display : 'N/A',
      gridHeight: grid ? grid.offsetHeight : 0,
      gridChildCount: grid ? grid.children.length : 0,
      listDisplay: list ? getComputedStyle(list).display : 'N/A',
      listHeight: list ? list.offsetHeight : 0,
      tbodyRows: tbody ? tbody.children.length : 0
    };
  });

  console.log('Debug info:', JSON.stringify(info, null, 2));

  await browser.close();
  console.log('Done!');
})();
