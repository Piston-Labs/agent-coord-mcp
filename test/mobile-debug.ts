/**
 * Mobile Debug Script - Identify chat input and persistence issues
 */
import { chromium } from 'playwright';

async function debugMobile() {
  const browser = await chromium.launch({ headless: true });

  // iPhone SE viewport
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  console.log('=== MOBILE DEBUG TEST ===\n');
  console.log('Viewport: 375x667 (iPhone SE)\n');

  const testUrl = process.env.TEST_URL || 'https://agent-coord-mcp.vercel.app';
  await page.goto(testUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Wait for JS to initialize

  // Handle login overlay if present - properly dismiss it
  const loginOverlay = await page.$('#loginOverlay');
  if (loginOverlay) {
    const isVisible = await loginOverlay.isVisible();
    if (isVisible) {
      console.log('Login overlay detected, dismissing...');
      // Set localStorage first so app thinks we're logged in
      await page.evaluate(() => {
        localStorage.setItem('chatUsername', 'test-user');
        localStorage.setItem('agentId', 'test-agent');
      });
      // Force hide overlay and remove from DOM flow
      await page.evaluate(() => {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) {
          overlay.style.display = 'none';
          overlay.style.visibility = 'hidden';
          overlay.style.pointerEvents = 'none';
          overlay.remove(); // Remove completely to avoid interference
        }
      });
      await page.waitForTimeout(500); // Let UI settle
    }
  }
  console.log('Login overlay dismissed');

  // Check 1: Chat input visibility on initial load
  console.log('--- TEST 1: Chat Input on Initial Load ---');
  const chatInput = await page.$('#messageInput');
  const chatInputBox = await chatInput?.boundingBox();
  console.log('Chat input exists:', !!chatInput);
  console.log('Chat input bounding box:', chatInputBox);
  console.log('Chat input visible:', chatInputBox && chatInputBox.width > 0 && chatInputBox.height > 0);

  // Check 2: Chat input container
  console.log('\n--- TEST 2: Chat Input Container ---');
  const chatInputContainer = await page.$('.chat-input');
  const containerBox = await chatInputContainer?.boundingBox();
  console.log('Container exists:', !!chatInputContainer);
  console.log('Container bounding box:', containerBox);

  // Check 3: ChatView state
  console.log('\n--- TEST 3: ChatView State ---');
  const chatViewInfo = await page.evaluate(() => {
    const chatView = document.getElementById('chatView');
    if (!chatView) return { exists: false };
    const style = getComputedStyle(chatView);
    return {
      exists: true,
      display: style.display,
      visibility: style.visibility,
      height: chatView.offsetHeight,
      classList: Array.from(chatView.classList),
    };
  });
  console.log('ChatView info:', chatViewInfo);

  // Check 4: Panel states
  console.log('\n--- TEST 4: Panel States ---');
  const panelInfo = await page.evaluate(() => {
    const panels = document.querySelectorAll('main > .panel');
    return Array.from(panels).map((p, i) => ({
      index: i,
      classList: Array.from(p.classList),
      display: getComputedStyle(p).display,
      width: p.offsetWidth,
      height: p.offsetHeight,
    }));
  });
  console.log('Panels:', JSON.stringify(panelInfo, null, 2));

  // Check 5: Mobile nav visibility
  console.log('\n--- TEST 5: Mobile Nav ---');
  const mobileNav = await page.$('.mobile-nav');
  const mobileNavVisible = await mobileNav?.isVisible();
  console.log('Mobile nav exists:', !!mobileNav);
  console.log('Mobile nav visible:', mobileNavVisible);

  // Take screenshot of initial state
  await page.screenshot({ path: 'test/screenshots/mobile-initial.png', fullPage: false });
  console.log('\nScreenshot saved: test/screenshots/mobile-initial.png');

  // Check 6: Switch to Telemetry and see if chat persists
  console.log('\n--- TEST 6: Switch to Telemetry ---');
  const telemetryBtn = await page.$('.mobile-nav-item[data-panel="telemetry"]');
  if (telemetryBtn) {
    await telemetryBtn.click();
    await page.waitForTimeout(500);

    const afterSwitch = await page.evaluate(() => {
      const chatView = document.getElementById('chatView');
      const telemetryView = document.getElementById('telemetryView');
      return {
        chatView: {
          display: chatView ? getComputedStyle(chatView).display : 'not found',
          classList: chatView ? Array.from(chatView.classList) : [],
        },
        telemetryView: {
          display: telemetryView ? getComputedStyle(telemetryView).display : 'not found',
          classList: telemetryView ? Array.from(telemetryView.classList) : [],
        },
      };
    });
    console.log('After switching to Telemetry:', JSON.stringify(afterSwitch, null, 2));

    // Check if chat input is still visible (it shouldn't be)
    const chatInputAfter = await page.$('#messageInput');
    const chatInputBoxAfter = await chatInputAfter?.boundingBox();
    console.log('Chat input visible after switch:', chatInputBoxAfter && chatInputBoxAfter.width > 0);

    await page.screenshot({ path: 'test/screenshots/mobile-telemetry.png', fullPage: false });
    console.log('Screenshot saved: test/screenshots/mobile-telemetry.png');
  }

  // Check 7: Go back to chat
  console.log('\n--- TEST 7: Switch Back to Chat ---');
  const chatBtn = await page.$('.mobile-nav-item[data-panel="chat"]');
  if (chatBtn) {
    await chatBtn.click();
    await page.waitForTimeout(500);

    const chatInputFinal = await page.$('#messageInput');
    const chatInputBoxFinal = await chatInputFinal?.boundingBox();
    console.log('Chat input visible after returning:', chatInputBoxFinal && chatInputBoxFinal.width > 0);
    console.log('Chat input bounding box:', chatInputBoxFinal);

    await page.screenshot({ path: 'test/screenshots/mobile-chat-return.png', fullPage: false });
    console.log('Screenshot saved: test/screenshots/mobile-chat-return.png');
  }

  await browser.close();
  console.log('\n=== DEBUG COMPLETE ===');
}

debugMobile().catch(console.error);
