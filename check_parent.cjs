const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('https://agent-coord-mcp.vercel.app/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#loadingScreen', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.click('button[data-tab="telemetry"]');
  await page.waitForTimeout(2000);

  const parentInfo = await page.evaluate(() => {
    const telemetryView = document.getElementById('telemetryView');
    if (!telemetryView) return { error: 'telemetryView not found' };

    // Walk up the DOM tree
    const ancestors = [];
    let el = telemetryView;
    for (let i = 0; i < 10 && el.parentElement; i++) {
      el = el.parentElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      ancestors.push({
        tag: el.tagName,
        id: el.id,
        class: el.className.split(' ').slice(0, 3).join(' '),
        width: rect.width,
        height: rect.height,
        left: rect.left,
        display: style.display
      });
    }

    // Also check siblings
    const parent = telemetryView.parentElement;
    const siblings = Array.from(parent.children).map(c => ({
      tag: c.tagName,
      id: c.id,
      class: c.className.split(' ').slice(0, 2).join(' ')
    }));

    return { ancestors, siblings, parentId: parent.id, parentClass: parent.className };
  });

  console.log('Parent info:');
  console.log(JSON.stringify(parentInfo, null, 2));

  await browser.close();
})();
