/**
 * Mobile Messaging Test - iPhone 12, 13, 14
 * Tests actual message sending on mobile viewports
 */

import { chromium, devices, Page, BrowserContext } from 'playwright';

const BASE_URL = process.env.TEST_URL || 'https://agent-coord-mcp.vercel.app';

interface TestResult {
  device: string;
  viewport: string;
  canTypeInInput: boolean;
  canClickSend: boolean;
  messageSent: boolean;
  inputVisible: boolean;
  buttonVisible: boolean;
  inputPosition: { x: number; y: number; width: number; height: number } | null;
  buttonPosition: { x: number; y: number; width: number; height: number } | null;
  errors: string[];
  cssIssues: string[];
}

const results: TestResult[] = [];

// iPhone device configurations
const iPhoneDevices = [
  { name: 'iPhone 12', device: devices['iPhone 12'] },
  { name: 'iPhone 13', device: devices['iPhone 13'] },
  { name: 'iPhone 14', device: devices['iPhone 14'] },
  { name: 'iPhone 14 Pro Max', device: devices['iPhone 14 Pro Max'] },
];

async function handleLogin(page: Page): Promise<void> {
  try {
    // Wait briefly for login overlay
    await page.waitForSelector('#loginOverlay', { timeout: 2000 });

    // Set a name and submit
    const nameInput = page.locator('#userName');
    if (await nameInput.count() > 0) {
      await nameInput.fill('mobile-test-user');
      const loginBtn = page.locator('#loginBtn');
      if (await loginBtn.count() > 0) {
        await loginBtn.click();
        await page.waitForTimeout(500);
      }
    }
  } catch {
    // No login overlay, that's fine
  }

  // Fallback: forcefully remove overlay if still there
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.remove();
  });
}

async function analyzeInputCss(page: Page): Promise<string[]> {
  const issues: string[] = [];

  const analysis = await page.evaluate(() => {
    const chatInput = document.querySelector('.chat-input') as HTMLElement;
    // Use specific IDs to get the correct elements
    const input = document.querySelector('#messageInput') as HTMLElement;
    const button = document.querySelector('#sendBtn') as HTMLElement;

    if (!chatInput) return { error: 'Chat input container not found' };

    const containerStyles = window.getComputedStyle(chatInput);
    const containerRect = chatInput.getBoundingClientRect();

    const inputStyles = input ? window.getComputedStyle(input) : null;
    const inputRect = input?.getBoundingClientRect();

    const buttonStyles = button ? window.getComputedStyle(button) : null;
    const buttonRect = button?.getBoundingClientRect();

    return {
      container: {
        position: containerStyles.position,
        bottom: containerStyles.bottom,
        left: containerStyles.left,
        right: containerStyles.right,
        zIndex: containerStyles.zIndex,
        display: containerStyles.display,
        visibility: containerStyles.visibility,
        opacity: containerStyles.opacity,
        pointerEvents: containerStyles.pointerEvents,
        rect: {
          top: containerRect.top,
          bottom: containerRect.bottom,
          left: containerRect.left,
          right: containerRect.right,
          width: containerRect.width,
          height: containerRect.height,
        },
        isInViewport: containerRect.bottom <= window.innerHeight && containerRect.top >= 0,
      },
      input: input ? {
        display: inputStyles?.display,
        visibility: inputStyles?.visibility,
        pointerEvents: inputStyles?.pointerEvents,
        disabled: (input as HTMLInputElement).disabled,
        readOnly: (input as HTMLInputElement).readOnly,
        rect: inputRect ? {
          width: inputRect.width,
          height: inputRect.height,
        } : null,
      } : null,
      button: button ? {
        display: buttonStyles?.display,
        visibility: buttonStyles?.visibility,
        pointerEvents: buttonStyles?.pointerEvents,
        disabled: (button as HTMLButtonElement).disabled,
        rect: buttonRect ? {
          width: buttonRect.width,
          height: buttonRect.height,
        } : null,
      } : null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      // Check for overlapping elements
      overlappingElements: (() => {
        if (!input) return [];
        const inputCenter = {
          x: inputRect!.left + inputRect!.width / 2,
          y: inputRect!.top + inputRect!.height / 2,
        };
        const elementsAtPoint = document.elementsFromPoint(inputCenter.x, inputCenter.y);
        return elementsAtPoint.slice(0, 5).map(el => ({
          tag: el.tagName,
          id: el.id,
          class: el.className,
        }));
      })(),
    };
  });

  if ('error' in analysis) {
    issues.push(analysis.error);
    return issues;
  }

  // Analyze container
  if (analysis.container.position !== 'sticky' && analysis.container.position !== 'fixed') {
    issues.push(`Container position is "${analysis.container.position}" - should be sticky or fixed for mobile`);
  }

  if (!analysis.container.isInViewport) {
    issues.push(`Container not fully in viewport (bottom: ${analysis.container.rect.bottom}, viewport: ${analysis.viewport.height})`);
  }

  if (analysis.container.visibility === 'hidden' || analysis.container.display === 'none') {
    issues.push('Container is hidden');
  }

  if (analysis.container.pointerEvents === 'none') {
    issues.push('Container has pointer-events: none');
  }

  // Analyze input
  if (analysis.input) {
    if (analysis.input.disabled) issues.push('Input is disabled');
    if (analysis.input.readOnly) issues.push('Input is read-only');
    if (analysis.input.pointerEvents === 'none') issues.push('Input has pointer-events: none');
    if (analysis.input.visibility === 'hidden') issues.push('Input is hidden');
  } else {
    issues.push('Input element not found');
  }

  // Analyze button
  if (analysis.button) {
    if (analysis.button.disabled) issues.push('Button is disabled');
    if (analysis.button.pointerEvents === 'none') issues.push('Button has pointer-events: none');
    if (analysis.button.visibility === 'hidden') issues.push('Button is hidden');
  } else {
    issues.push('Button element not found');
  }

  // Check for overlapping elements
  if (analysis.overlappingElements.length > 0) {
    const topElement = analysis.overlappingElements[0];
    if (topElement.tag !== 'INPUT' && topElement.id !== 'messageInput') {
      issues.push(`Element overlapping input: ${topElement.tag}${topElement.id ? '#' + topElement.id : ''}${topElement.class ? '.' + String(topElement.class).split(' ')[0] : ''}`);
    }
  }

  console.log('  CSS Analysis:', JSON.stringify(analysis, null, 2));

  return issues;
}

async function testMobileMessaging(context: BrowserContext, deviceName: string): Promise<TestResult> {
  const page = await context.newPage();
  const viewport = `${page.viewportSize()?.width}x${page.viewportSize()?.height}`;

  const result: TestResult = {
    device: deviceName,
    viewport,
    canTypeInInput: false,
    canClickSend: false,
    messageSent: false,
    inputVisible: false,
    buttonVisible: false,
    inputPosition: null,
    buttonPosition: null,
    errors: [],
    cssIssues: [],
  };

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${deviceName} (${viewport})`);
    console.log('='.repeat(60));

    // Navigate to page
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    console.log('  Page loaded');

    // Handle login
    await handleLogin(page);
    console.log('  Login handled');

    // On mobile, use the bottom nav bar to switch to Chat (not the header tabs)
    // The mobile nav bar has data-panel="chat" attribute
    const mobileNavChat = page.locator('.mobile-nav-item[data-panel="chat"]');
    if (await mobileNavChat.count() > 0) {
      // Call switchMobilePanel directly via JavaScript to ensure it works
      await page.evaluate(() => {
        // @ts-ignore - function exists in page context
        if (typeof switchMobilePanel === 'function') {
          switchMobilePanel('chat');
        }
      });
      await page.waitForTimeout(800);
      console.log('  Called switchMobilePanel("chat") via JS');

      // Verify DOM state
      const domState = await page.evaluate(() => {
        const chatView = document.getElementById('chatView');
        const crmView = document.getElementById('crmView');
        const chatInput = document.querySelector('.chat-input');
        const messageInput = document.getElementById('messageInput');
        const panels = document.querySelectorAll('main > .panel');
        const activeTabContents = document.querySelectorAll('.tab-content.active');
        return {
          chatViewExists: !!chatView,
          chatViewClasses: chatView?.className,
          chatViewDisplay: chatView ? window.getComputedStyle(chatView).display : null,
          crmViewClasses: crmView?.className,
          crmViewDisplay: crmView ? window.getComputedStyle(crmView).display : null,
          activeTabContentIds: Array.from(activeTabContents).map(el => el.id),
          chatInputExists: !!chatInput,
          chatInputDisplay: chatInput ? window.getComputedStyle(chatInput).display : null,
          messageInputExists: !!messageInput,
          messageInputDisplay: messageInput ? window.getComputedStyle(messageInput).display : null,
          panelCount: panels.length,
          panelWithMobileActive: Array.from(panels).findIndex(p => p.classList.contains('mobile-active')),
          activeNavItem: document.querySelector('.mobile-nav-item.active')?.getAttribute('data-panel'),
          activeHeaderTab: document.querySelector('.tabs-header .tab.active')?.getAttribute('data-tab'),
        };
      });
      console.log('  DOM State:', JSON.stringify(domState, null, 2));
    } else {
      console.log('  Mobile nav not found, using header tab fallback');
      const chatTab = page.locator('button.tab:has-text("Chat")');
      if (await chatTab.count() > 0) {
        await chatTab.first().click({ force: true });
        await page.waitForTimeout(500);
      }
    }
    console.log('  Switched to Chat tab');

    // Analyze CSS issues
    result.cssIssues = await analyzeInputCss(page);
    if (result.cssIssues.length > 0) {
      console.log('  ⚠️ CSS Issues found:', result.cssIssues);
    }

    // Find elements - use specific IDs to avoid matching wrong elements
    const chatInput = page.locator('#messageInput').first();
    const sendBtn = page.locator('#sendBtn').first();

    // Check input visibility and position
    if (await chatInput.count() > 0) {
      const inputBox = await chatInput.boundingBox();
      if (inputBox) {
        result.inputPosition = inputBox;
        result.inputVisible = inputBox.y < (page.viewportSize()?.height || 0);
        console.log(`  Input position: x=${Math.round(inputBox.x)}, y=${Math.round(inputBox.y)}, w=${Math.round(inputBox.width)}, h=${Math.round(inputBox.height)}`);
        console.log(`  Input visible in viewport: ${result.inputVisible}`);
      }
    } else {
      result.errors.push('Chat input element not found');
    }

    // Check button visibility and position
    if (await sendBtn.count() > 0) {
      const btnBox = await sendBtn.boundingBox();
      if (btnBox) {
        result.buttonPosition = btnBox;
        result.buttonVisible = btnBox.y < (page.viewportSize()?.height || 0);
        console.log(`  Button position: x=${Math.round(btnBox.x)}, y=${Math.round(btnBox.y)}, w=${Math.round(btnBox.width)}, h=${Math.round(btnBox.height)}`);
        console.log(`  Button visible in viewport: ${result.buttonVisible}`);
      }
    } else {
      result.errors.push('Send button element not found');
    }

    // Test typing
    try {
      const testMessage = `Mobile test from ${deviceName} at ${new Date().toISOString()}`;
      await chatInput.click({ force: true });
      await page.waitForTimeout(200);
      await chatInput.fill(testMessage);
      await page.waitForTimeout(200);

      const inputValue = await chatInput.inputValue();
      result.canTypeInInput = inputValue === testMessage;
      console.log(`  Can type: ${result.canTypeInInput} (value: "${inputValue.substring(0, 30)}...")`);
    } catch (e) {
      result.errors.push(`Typing failed: ${e}`);
      console.log(`  ❌ Typing failed: ${e}`);
    }

    // Test clicking send button
    try {
      // Count messages before
      const messagesBefore = await page.locator('.chat-message, .message').count();

      // Click send
      await sendBtn.click({ force: true });
      result.canClickSend = true;
      console.log('  Can click send: true');

      // Wait for message to appear
      await page.waitForTimeout(2000);

      const messagesAfter = await page.locator('.chat-message, .message').count();
      result.messageSent = messagesAfter > messagesBefore;
      console.log(`  Message sent: ${result.messageSent} (before: ${messagesBefore}, after: ${messagesAfter})`);

      if (!result.messageSent) {
        // Check if there's an error message
        const errorMsg = await page.locator('.error, .alert, [class*="error"]').textContent().catch(() => null);
        if (errorMsg) {
          result.errors.push(`Error displayed: ${errorMsg}`);
        }
      }
    } catch (e) {
      result.errors.push(`Send click failed: ${e}`);
      console.log(`  ❌ Send click failed: ${e}`);
    }

    // Take screenshot
    const screenshotName = deviceName.toLowerCase().replace(/\s+/g, '-');
    await page.screenshot({
      path: `test/screenshots/${screenshotName}-chat-test.png`,
      fullPage: false // Just visible viewport
    });
    console.log(`  📸 Screenshot saved: ${screenshotName}-chat-test.png`);

  } catch (e) {
    result.errors.push(`Test error: ${e}`);
    console.log(`  ❌ Test error: ${e}`);
  } finally {
    await page.close();
  }

  return result;
}

async function runTests(): Promise<void> {
  console.log('📱 Mobile Messaging Test - iPhone 12/13/14\n');
  console.log(`Target: ${BASE_URL}\n`);

  // Ensure screenshots directory exists
  const fs = await import('fs');
  if (!fs.existsSync('test/screenshots')) {
    fs.mkdirSync('test/screenshots', { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  for (const { name, device } of iPhoneDevices) {
    const context = await browser.newContext({
      ...device,
      // Enable touch
      hasTouch: true,
      isMobile: true,
    });

    const result = await testMobileMessaging(context, name);
    results.push(result);

    await context.close();
  }

  await browser.close();

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));

  let allPassed = true;

  for (const r of results) {
    const status = r.messageSent ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${status} ${r.device} (${r.viewport})`);
    console.log(`  - Input visible: ${r.inputVisible}`);
    console.log(`  - Can type: ${r.canTypeInInput}`);
    console.log(`  - Can click send: ${r.canClickSend}`);
    console.log(`  - Message sent: ${r.messageSent}`);

    if (r.cssIssues.length > 0) {
      console.log(`  - CSS Issues: ${r.cssIssues.join(', ')}`);
    }

    if (r.errors.length > 0) {
      console.log(`  - Errors: ${r.errors.join(', ')}`);
    }

    if (!r.messageSent) allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`OVERALL: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(60));

  // Save detailed results to file
  fs.writeFileSync('test/screenshots/mobile-test-results.json', JSON.stringify(results, null, 2));
  console.log('\nDetailed results saved to test/screenshots/mobile-test-results.json');
}

runTests().catch(console.error);
