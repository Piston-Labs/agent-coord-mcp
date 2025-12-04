/**
 * Mobile Responsiveness Audit using Playwright
 * Tests telemetry cards and chat functionality on mobile viewports
 */

import { chromium, devices, Page, Browser } from 'playwright';

const BASE_URL = process.env.TEST_URL || 'https://agent-coord-mcp.vercel.app';

interface AuditResult {
  viewport: string;
  page: string;
  issue: string;
  severity: 'critical' | 'major' | 'minor';
  element?: string;
  details?: Record<string, unknown>;
}

const results: AuditResult[] = [];

async function handleLogin(page: Page): Promise<void> {
  // Wait for page to fully load and execute its DOMContentLoaded
  console.log('  Waiting for page load...');
  await page.waitForTimeout(1000);

  // Bypass auth by setting global state and hiding overlay
  console.log('  Bypassing authentication...');
  await page.evaluate(() => {
    // Set global auth state
    (window as any).isAuthenticated = true;

    // Hide the login overlay
    const overlay = document.getElementById('loginOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.visibility = 'hidden';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '-1';
    }

    // Also hide loading screen if present
    const loading = document.getElementById('loadingScreen');
    if (loading) {
      loading.style.display = 'none';
    }

    // Remove any other modal/overlay elements that might block
    document.querySelectorAll('.modal, .overlay, [class*="overlay"]').forEach(el => {
      const elem = el as HTMLElement;
      if (elem.id !== 'loginOverlay') {
        elem.style.display = 'none';
      }
    });
  });

  // Wait for state to settle
  await page.waitForTimeout(500);

  // Verify overlay is hidden
  const overlayVisible = await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay');
    if (!overlay) return false;
    const style = window.getComputedStyle(overlay);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  if (overlayVisible) {
    console.log('  ⚠️ Warning: Login overlay still visible, forcing removal...');
    await page.evaluate(() => {
      const overlay = document.getElementById('loginOverlay');
      if (overlay) overlay.remove();
    });
    await page.waitForTimeout(300);
  } else {
    console.log('  ✅ Login overlay hidden successfully');
  }
}

async function auditTelemetryCards(page: Page, viewport: string): Promise<void> {
  console.log(`\n📱 Auditing Telemetry Cards on ${viewport}...`);

  // Navigate to telemetry tab
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Handle login if needed
  await handleLogin(page);

  // Click on Telemetry tab (force: true to bypass any overlays)
  const telemetryTab = page.locator('button.tab:has-text("Telemetry"), .tab:has-text("Fleet")');
  if (await telemetryTab.count() > 0) {
    await telemetryTab.first().click({ force: true });
    await page.waitForTimeout(500);
  }

  // Check device cards
  const deviceCards = page.locator('.device-card');
  const cardCount = await deviceCards.count();
  console.log(`  Found ${cardCount} device cards`);

  for (let i = 0; i < Math.min(cardCount, 3); i++) {
    const card = deviceCards.nth(i);
    const box = await card.boundingBox();

    if (box) {
      const viewportWidth = page.viewportSize()?.width || 375;

      // Check if card is too narrow (squashed)
      if (box.width < 200) {
        results.push({
          viewport,
          page: 'Telemetry',
          issue: 'Device card too narrow',
          severity: 'major',
          element: `.device-card[${i}]`,
          details: { width: box.width, minExpected: 200 }
        });
        console.log(`  ⚠️ Card ${i}: Width ${box.width}px (too narrow)`);
      }

      // Check if card overflows viewport
      if (box.x + box.width > viewportWidth) {
        results.push({
          viewport,
          page: 'Telemetry',
          issue: 'Device card overflows viewport',
          severity: 'critical',
          element: `.device-card[${i}]`,
          details: { cardRight: box.x + box.width, viewportWidth }
        });
        console.log(`  ❌ Card ${i}: Overflows viewport`);
      }

      // Check card height - squashed vertically?
      if (box.height < 80) {
        results.push({
          viewport,
          page: 'Telemetry',
          issue: 'Device card height too small',
          severity: 'major',
          element: `.device-card[${i}]`,
          details: { height: box.height, minExpected: 80 }
        });
        console.log(`  ⚠️ Card ${i}: Height ${box.height}px (squashed)`);
      }
    }
  }

  // Check fleet stats
  const fleetStats = page.locator('.fleet-stat');
  const statsCount = await fleetStats.count();
  console.log(`  Found ${statsCount} fleet stat cards`);

  for (let i = 0; i < statsCount; i++) {
    const stat = fleetStats.nth(i);
    const box = await stat.boundingBox();

    if (box && box.width < 50) {
      results.push({
        viewport,
        page: 'Telemetry',
        issue: 'Fleet stat too narrow',
        severity: 'major',
        element: `.fleet-stat[${i}]`,
        details: { width: box.width }
      });
      console.log(`  ⚠️ Fleet stat ${i}: Width ${box.width}px (squashed)`);
    }
  }

  // Check device grid layout
  const deviceGrid = page.locator('.device-grid');
  if (await deviceGrid.count() > 0) {
    const gridStyles = await deviceGrid.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        display: styles.display,
        gridTemplateColumns: styles.gridTemplateColumns,
        gap: styles.gap
      };
    });
    console.log(`  Device grid styles:`, gridStyles);
  }
}

async function auditChatSubmission(page: Page, viewport: string): Promise<void> {
  console.log(`\n💬 Auditing Chat Submission on ${viewport}...`);

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Handle login if needed
  await handleLogin(page);

  // Find chat input
  const chatInput = page.locator('.chat-input input[type="text"], #messageInput');
  const sendBtn = page.locator('.chat-input button, #sendBtn');

  const inputExists = await chatInput.count() > 0;
  const btnExists = await sendBtn.count() > 0;

  console.log(`  Chat input found: ${inputExists}`);
  console.log(`  Send button found: ${btnExists}`);

  if (!inputExists) {
    results.push({
      viewport,
      page: 'Chat',
      issue: 'Chat input not found',
      severity: 'critical',
      element: '.chat-input input'
    });
    return;
  }

  if (!btnExists) {
    results.push({
      viewport,
      page: 'Chat',
      issue: 'Send button not found',
      severity: 'critical',
      element: '#sendBtn'
    });
    return;
  }

  // Check input visibility and dimensions
  const inputBox = await chatInput.first().boundingBox();
  const btnBox = await sendBtn.first().boundingBox();
  const viewportHeight = page.viewportSize()?.height || 667;
  const viewportWidth = page.viewportSize()?.width || 375;

  if (inputBox) {
    console.log(`  Input position: ${Math.round(inputBox.x)},${Math.round(inputBox.y)} size: ${Math.round(inputBox.width)}x${Math.round(inputBox.height)}`);

    // Check if input is visible in viewport
    if (inputBox.y > viewportHeight) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Chat input below viewport fold',
        severity: 'critical',
        element: '.chat-input input',
        details: { inputY: inputBox.y, viewportHeight }
      });
      console.log(`  ❌ Input is below viewport (y: ${inputBox.y}, viewport: ${viewportHeight})`);
    }

    // Check if input is too narrow
    if (inputBox.width < 150) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Chat input too narrow',
        severity: 'major',
        element: '.chat-input input',
        details: { width: inputBox.width }
      });
      console.log(`  ⚠️ Input too narrow: ${inputBox.width}px`);
    }
  }

  if (btnBox) {
    console.log(`  Button position: ${Math.round(btnBox.x)},${Math.round(btnBox.y)} size: ${Math.round(btnBox.width)}x${Math.round(btnBox.height)}`);

    // Check if button is visible
    if (btnBox.y > viewportHeight) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Send button below viewport',
        severity: 'critical',
        element: '#sendBtn',
        details: { btnY: btnBox.y, viewportHeight }
      });
      console.log(`  ❌ Send button is below viewport`);
    }

    // Check if button is cut off
    if (btnBox.x + btnBox.width > viewportWidth) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Send button overflows viewport',
        severity: 'critical',
        element: '#sendBtn',
        details: { btnRight: btnBox.x + btnBox.width, viewportWidth }
      });
      console.log(`  ❌ Send button overflows viewport`);
    }

    // Check touch target size (iOS minimum is 44x44)
    if (btnBox.width < 44 || btnBox.height < 44) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Send button too small for touch',
        severity: 'major',
        element: '#sendBtn',
        details: { width: btnBox.width, height: btnBox.height, minRequired: 44 }
      });
      console.log(`  ⚠️ Button too small for touch: ${btnBox.width}x${btnBox.height}`);
    }
  }

  // Test actual submission
  try {
    await chatInput.first().fill('Test message from mobile audit');
    console.log(`  ✅ Can type in input`);

    // Check if button is clickable
    const isDisabled = await sendBtn.first().isDisabled();
    console.log(`  Button disabled: ${isDisabled}`);

    // Try clicking (but don't actually submit)
    const btnEnabled = !isDisabled;
    if (!btnEnabled) {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Send button appears disabled',
        severity: 'major',
        element: '#sendBtn'
      });
    }
  } catch (e) {
    results.push({
      viewport,
      page: 'Chat',
      issue: `Input interaction failed: ${e}`,
      severity: 'critical',
      element: '.chat-input'
    });
    console.log(`  ❌ Interaction error: ${e}`);
  }

  // Check z-index and stacking context
  const chatInputContainer = page.locator('.chat-input');
  if (await chatInputContainer.count() > 0) {
    const containerStyles = await chatInputContainer.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        position: styles.position,
        zIndex: styles.zIndex,
        bottom: styles.bottom,
        display: styles.display,
        visibility: styles.visibility,
        boundingBottom: rect.bottom,
        windowHeight: window.innerHeight
      };
    });
    console.log(`  Chat input container styles:`, containerStyles);

    // Check if element is positioned correctly
    if (containerStyles.position !== 'sticky' && containerStyles.position !== 'fixed') {
      results.push({
        viewport,
        page: 'Chat',
        issue: 'Chat input not sticky/fixed on mobile',
        severity: 'major',
        element: '.chat-input',
        details: { position: containerStyles.position }
      });
    }
  }
}

async function takeScreenshots(page: Page, viewport: string): Promise<void> {
  const safeName = viewport.replace(/\s+/g, '-').toLowerCase();

  // Screenshot of telemetry (full page to see cards)
  const telemetryTab = page.locator('button.tab:has-text("Telemetry"), .tab:has-text("Fleet")');
  if (await telemetryTab.count() > 0) {
    await telemetryTab.first().click({ force: true });
    await page.waitForTimeout(500);

    // Scroll down to see device cards
    await page.evaluate(() => {
      const content = document.querySelector('#telemetryView') || document.querySelector('.tab-content.active');
      if (content) content.scrollTop = 400;
    });
    await page.waitForTimeout(300);

    await page.screenshot({ path: `test/screenshots/${safeName}-telemetry.png`, fullPage: true });
    console.log(`  📸 Saved ${safeName}-telemetry.png`);
  }

  // Screenshot of chat - focus on input area
  const chatTab = page.locator('button.tab:has-text("Chat"), .tab:has-text("Team")');
  if (await chatTab.count() > 0) {
    await chatTab.first().click({ force: true });
    await page.waitForTimeout(500);

    // Take full page to see chat input
    await page.screenshot({ path: `test/screenshots/${safeName}-chat.png`, fullPage: true });
    console.log(`  📸 Saved ${safeName}-chat.png`);
  }
}

async function runAudit(): Promise<void> {
  console.log('🔍 Mobile Responsiveness Audit\n');
  console.log(`Target: ${BASE_URL}\n`);

  // Ensure screenshots directory exists
  const fs = await import('fs');
  if (!fs.existsSync('test/screenshots')) {
    fs.mkdirSync('test/screenshots', { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  // Test multiple mobile viewports
  const mobileDevices = [
    { name: 'iPhone SE', device: devices['iPhone SE'] },
    { name: 'iPhone 12', device: devices['iPhone 12'] },
    { name: 'iPhone 12 Pro Max', device: devices['iPhone 12 Pro Max'] },
    { name: 'Pixel 5', device: devices['Pixel 5'] },
    { name: 'Galaxy S9+', device: devices['Galaxy S9+'] },
  ];

  for (const { name, device } of mobileDevices) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Testing: ${name} (${device.viewport.width}x${device.viewport.height})`);
    console.log('='.repeat(50));

    const context = await browser.newContext({
      ...device,
    });
    const page = await context.newPage();

    try {
      await auditTelemetryCards(page, name);
      await auditChatSubmission(page, name);
      await takeScreenshots(page, name);
    } catch (e) {
      console.error(`Error testing ${name}:`, e);
      results.push({
        viewport: name,
        page: 'General',
        issue: `Test failed: ${e}`,
        severity: 'critical'
      });
    }

    await context.close();
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(50));

  const critical = results.filter(r => r.severity === 'critical');
  const major = results.filter(r => r.severity === 'major');
  const minor = results.filter(r => r.severity === 'minor');

  console.log(`\n❌ Critical: ${critical.length}`);
  console.log(`⚠️ Major: ${major.length}`);
  console.log(`ℹ️ Minor: ${minor.length}`);

  if (critical.length > 0) {
    console.log('\n--- CRITICAL ISSUES ---');
    critical.forEach(r => {
      console.log(`  [${r.viewport}] ${r.page}: ${r.issue}`);
      if (r.details) console.log(`    Details: ${JSON.stringify(r.details)}`);
    });
  }

  if (major.length > 0) {
    console.log('\n--- MAJOR ISSUES ---');
    major.forEach(r => {
      console.log(`  [${r.viewport}] ${r.page}: ${r.issue}`);
      if (r.details) console.log(`    Details: ${JSON.stringify(r.details)}`);
    });
  }

  // Output JSON results
  console.log('\n--- FULL RESULTS (JSON) ---');
  console.log(JSON.stringify(results, null, 2));
}

runAudit().catch(console.error);
