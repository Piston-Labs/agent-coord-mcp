import { chromium } from 'playwright';

async function debugHeights() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  
  await page.goto('http://localhost:3456', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Hide login overlay
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    localStorage.setItem('chatUsername', 'test-user');
  });
  
  const heights = await page.evaluate(() => {
    const body = document.body;
    const main = document.querySelector('main');
    const panel = document.querySelector('.panel.mobile-active');
    const chatView = document.getElementById('chatView');
    const chatInput = document.querySelector('.chat-input');
    const mobileNav = document.querySelector('.mobile-nav');
    
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      body: { 
        height: body.offsetHeight, 
        clientHeight: body.clientHeight,
        paddingBottom: getComputedStyle(body).paddingBottom
      },
      main: main ? { 
        height: main.offsetHeight, 
        clientHeight: main.clientHeight,
        top: main.getBoundingClientRect().top,
        bottom: main.getBoundingClientRect().bottom
      } : null,
      panel: panel ? { 
        height: panel.offsetHeight,
        top: panel.getBoundingClientRect().top,
        bottom: panel.getBoundingClientRect().bottom
      } : null,
      chatView: chatView ? { 
        height: chatView.offsetHeight,
        top: chatView.getBoundingClientRect().top,
        bottom: chatView.getBoundingClientRect().bottom
      } : null,
      chatInput: chatInput ? { 
        height: chatInput.offsetHeight,
        top: chatInput.getBoundingClientRect().top,
        bottom: chatInput.getBoundingClientRect().bottom
      } : null,
      mobileNav: mobileNav ? { 
        height: mobileNav.offsetHeight,
        top: mobileNav.getBoundingClientRect().top,
        bottom: mobileNav.getBoundingClientRect().bottom,
        display: getComputedStyle(mobileNav).display
      } : null
    };
  });
  
  console.log('Height Analysis:');
  console.log(JSON.stringify(heights, null, 2));
  
  await browser.close();
}

debugHeights().catch(console.error);
