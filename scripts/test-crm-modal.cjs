const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const timestamp = Date.now();
  await page.goto(`https://agent-coord-mcp.vercel.app/?t=${timestamp}`);
  await page.waitForTimeout(2000);
  
  // Login
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'piston2025');
  await page.click('button:has-text("Login")');
  await page.waitForTimeout(2000);
  await page.waitForSelector('#loginOverlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
  
  // Navigate to CRM and open modal
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(2000);
  await page.click('button:has-text("+ Add Shop")');
  await page.waitForTimeout(1500);
  
  // Deep dive into what's blocking scroll
  const debug = await page.evaluate(() => {
    const modal = document.getElementById('shopModal');
    const body = modal.querySelector('.crm-modal-body');
    const form = body.querySelector('form');
    
    // Check all elements in the chain
    const chain = [];
    let el = body;
    while (el && el !== document.body) {
      const styles = getComputedStyle(el);
      chain.push({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        overflow: styles.overflow,
        overflowY: styles.overflowY,
        height: el.offsetHeight,
        scrollHeight: el.scrollHeight,
        position: styles.position
      });
      el = el.parentElement;
    }
    
    // Check for any overflow:hidden ancestors
    const ancestors = [];
    el = body.parentElement;
    while (el && el !== document.body) {
      const styles = getComputedStyle(el);
      if (styles.overflow === 'hidden' || styles.overflowY === 'hidden') {
        ancestors.push({
          tag: el.tagName,
          id: el.id,
          overflow: styles.overflow
        });
      }
      el = el.parentElement;
    }
    
    return {
      chain,
      hiddenOverflowAncestors: ancestors,
      bodyRect: body.getBoundingClientRect(),
      formRect: form.getBoundingClientRect()
    };
  });
  
  console.log('=== Element Chain (body to root) ===');
  debug.chain.forEach((el, i) => {
    console.log(`${i}: ${el.tag}#${el.id}.${el.class} - overflow:${el.overflow}/${el.overflowY}, h:${el.height}, sh:${el.scrollHeight}`);
  });
  
  console.log('\n=== Hidden Overflow Ancestors ===');
  console.log(debug.hiddenOverflowAncestors);
  
  console.log('\n=== Rectangles ===');
  console.log('Body:', debug.bodyRect);
  console.log('Form:', debug.formRect);
  
  // Try mouse wheel scroll
  console.log('\n=== Trying wheel scroll ===');
  const bodyHandle = await page.locator('#shopModal .crm-modal-body');
  await bodyHandle.hover();
  
  const beforeScroll = await page.evaluate(() => {
    return document.querySelector('#shopModal .crm-modal-body').scrollTop;
  });
  
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(500);
  
  const afterScroll = await page.evaluate(() => {
    return document.querySelector('#shopModal .crm-modal-body').scrollTop;
  });
  
  console.log(`Wheel scroll: before=${beforeScroll}, after=${afterScroll}`);
  
  await page.screenshot({ path: 'modal-wheel-scroll.png' });
  
  await browser.close();
})();
