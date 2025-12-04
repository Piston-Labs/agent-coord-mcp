const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('https://agent-coord-mcp.vercel.app/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#loadingScreen', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.click('button[data-tab="telemetry"]');
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const telemetryView = document.getElementById('telemetryView');
    const telemetryGrid = document.getElementById('telemetryGrid');
    const deviceList = document.getElementById('deviceListContainer');
    const fleetSummary = document.getElementById('fleetSummary');
    const healthOverview = document.getElementById('healthOverview');

    function getRect(el, name) {
      if (!el) return { name, exists: false };
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        name,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        overflow: style.overflow
      };
    }

    return {
      telemetryView: getRect(telemetryView, 'telemetryView'),
      fleetSummary: getRect(fleetSummary, 'fleetSummary'),
      healthOverview: getRect(healthOverview, 'healthOverview'),
      deviceList: getRect(deviceList, 'deviceListContainer'),
      telemetryGrid: getRect(telemetryGrid, 'telemetryGrid'),
      viewportHeight: window.innerHeight
    };
  });

  console.log('Content positions:');
  console.log(JSON.stringify(info, null, 2));

  // Take a full-page screenshot
  await page.screenshot({ path: 'screenshot_full.png', fullPage: true });
  console.log('Saved full page screenshot');

  await browser.close();
})();
