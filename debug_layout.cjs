const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1400, height: 900 });

  console.log('Navigating to dashboard...');
  await page.goto('https://agent-coord-mcp.vercel.app/', { waitUntil: 'networkidle' });

  await page.waitForSelector('#loadingScreen', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Click on Telemetry tab
  await page.click('button[data-tab="telemetry"]');
  await page.waitForTimeout(3000);

  // Get detailed layout info
  const layoutInfo = await page.evaluate(() => {
    const telemetryView = document.getElementById('telemetryView');
    const telemetryGrid = document.getElementById('telemetryGrid');
    const deviceList = document.getElementById('deviceListContainer');
    const mainContent = document.querySelector('.main-content');
    const chatPanel = document.querySelector('.chat-panel');

    function getInfo(el, name) {
      if (!el) return { name, exists: false };
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        name,
        exists: true,
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        overflow: style.overflow,
        overflowY: style.overflowY,
        zIndex: style.zIndex,
        opacity: style.opacity,
        className: el.className,
        childCount: el.children.length
      };
    }

    return {
      telemetryView: getInfo(telemetryView, 'telemetryView'),
      telemetryGrid: getInfo(telemetryGrid, 'telemetryGrid'),
      deviceList: getInfo(deviceList, 'deviceListContainer'),
      mainContent: getInfo(mainContent, 'main-content'),
      chatPanel: getInfo(chatPanel, 'chat-panel'),
      bodyWidth: document.body.clientWidth,
      bodyHeight: document.body.clientHeight
    };
  });

  console.log('Layout info:');
  console.log(JSON.stringify(layoutInfo, null, 2));

  await browser.close();
})();
