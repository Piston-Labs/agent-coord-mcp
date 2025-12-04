/**
 * Responsive Sizing Test - Verify UI is usable at different window sizes
 *
 * Tests that:
 * - All critical elements are visible and clickable
 * - Text is readable (minimum font sizes)
 * - No horizontal overflow/clipping
 * - Interactive elements are tap-friendly (min 44px touch targets)
 */
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
}

interface TestResult {
  viewport: string;
  passed: boolean;
  issues: string[];
  warnings: string[];
}

const VIEWPORTS: ViewportConfig[] = [
  { name: 'iPhone SE', width: 375, height: 667, isMobile: true },
  { name: 'iPhone 12 Pro', width: 390, height: 844, isMobile: true },
  { name: 'iPad Mini', width: 768, height: 1024, isMobile: true },
  { name: 'iPad Pro', width: 1024, height: 1366, isMobile: false },
  { name: 'Laptop', width: 1366, height: 768, isMobile: false },
  { name: 'Desktop', width: 1920, height: 1080, isMobile: false },
];

const MIN_FONT_SIZE = 11; // Minimum readable font size in px
const MIN_TOUCH_TARGET = 44; // Minimum touch target size in px

async function dismissLoginOverlay(page: Page): Promise<void> {
  const loginOverlay = await page.$('#loginOverlay');
  if (loginOverlay) {
    const isVisible = await loginOverlay.isVisible();
    if (isVisible) {
      await page.evaluate(() => {
        localStorage.setItem('chatUsername', 'test-user');
        localStorage.setItem('agentId', 'test-agent');
        const overlay = document.getElementById('loginOverlay');
        if (overlay) overlay.remove();
      });
      await page.waitForTimeout(500);
    }
  }
}

async function checkFontSizes(page: Page): Promise<{ issues: string[], warnings: string[] }> {
  const issues: string[] = [];
  const warnings: string[] = [];

  const fontCheck = await page.evaluate((minSize: number) => {
    const smallFonts: { selector: string, size: number, text: string }[] = [];
    const elements = document.querySelectorAll('*:not(script):not(style)');

    elements.forEach(el => {
      const style = getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      const text = el.textContent?.trim().slice(0, 30);

      if (fontSize > 0 && fontSize < minSize && text && text.length > 0) {
        // Get a useful selector
        let selector = el.tagName.toLowerCase();
        if (el.id) selector = `#${el.id}`;
        else if (el.className && typeof el.className === 'string') {
          selector = `.${el.className.split(' ')[0]}`;
        }

        // Only add unique issues
        const existing = smallFonts.find(f => f.selector === selector);
        if (!existing) {
          smallFonts.push({ selector, size: fontSize, text });
        }
      }
    });

    return smallFonts.slice(0, 10); // Limit to first 10
  }, MIN_FONT_SIZE);

  fontCheck.forEach(item => {
    if (item.size < 10) {
      issues.push(`Font too small: ${item.selector} = ${item.size}px ("${item.text}")`);
    } else {
      warnings.push(`Font near limit: ${item.selector} = ${item.size}px`);
    }
  });

  return { issues, warnings };
}

async function checkTouchTargets(page: Page, isMobile: boolean): Promise<{ issues: string[], warnings: string[] }> {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!isMobile) return { issues, warnings };

  const touchCheck = await page.evaluate((minSize: number) => {
    const smallTargets: { selector: string, width: number, height: number }[] = [];
    const clickables = document.querySelectorAll('button, a, [onclick], input, select, .clickable');

    clickables.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (rect.width < minSize || rect.height < minSize) {
          let selector = el.tagName.toLowerCase();
          if (el.id) selector = `#${el.id}`;
          else if (el.className && typeof el.className === 'string') {
            selector = `.${el.className.split(' ')[0]}`;
          }

          smallTargets.push({
            selector,
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          });
        }
      }
    });

    return smallTargets.slice(0, 10);
  }, MIN_TOUCH_TARGET);

  touchCheck.forEach(item => {
    warnings.push(`Small touch target: ${item.selector} = ${item.width}x${item.height}px`);
  });

  return { issues, warnings };
}

async function checkOverflow(page: Page): Promise<{ issues: string[], warnings: string[] }> {
  const issues: string[] = [];
  const warnings: string[] = [];

  const overflowCheck = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;

    const hasHorizontalScroll = body.scrollWidth > html.clientWidth;
    const overflowAmount = body.scrollWidth - html.clientWidth;

    return { hasHorizontalScroll, overflowAmount };
  });

  if (overflowCheck.hasHorizontalScroll && overflowCheck.overflowAmount > 10) {
    issues.push(`Horizontal overflow: ${overflowCheck.overflowAmount}px`);
  }

  return { issues, warnings };
}

async function checkCriticalElements(page: Page, viewport: ViewportConfig): Promise<{ issues: string[], warnings: string[] }> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Elements that must be visible on every page
  const criticalElements = [
    { selector: '.mobile-nav', required: viewport.isMobile, name: 'Mobile Navigation' },
    { selector: '.header, header', required: true, name: 'Header' },
    { selector: '#messageInput', required: false, name: 'Chat Input' },
  ];

  for (const el of criticalElements) {
    const element = await page.$(el.selector);
    if (element) {
      const box = await element.boundingBox();
      if (!box || box.width === 0 || box.height === 0) {
        if (el.required) {
          issues.push(`${el.name} not visible (zero dimensions)`);
        }
      } else if (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width) {
        warnings.push(`${el.name} partially off-screen`);
      }
    } else if (el.required) {
      issues.push(`${el.name} not found`);
    }
  }

  return { issues, warnings };
}

async function runTests(): Promise<void> {
  console.log('=== RESPONSIVE SIZING TESTS ===\n');
  console.log(`Testing ${VIEWPORTS.length} viewport sizes\n`);

  const browser = await chromium.launch({ headless: true });
  const results: TestResult[] = [];
  const screenshotDir = path.join(__dirname, 'screenshots', 'responsive');

  // Ensure screenshot directory exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const testUrl = process.env.TEST_URL || 'https://agent-coord-mcp.vercel.app';

  for (const viewport of VIEWPORTS) {
    console.log(`\n--- Testing: ${viewport.name} (${viewport.width}x${viewport.height}) ---`);

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
    });

    const page = await context.newPage();
    await page.goto(testUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await dismissLoginOverlay(page);

    const issues: string[] = [];
    const warnings: string[] = [];

    // Run all checks
    const fontResults = await checkFontSizes(page);
    issues.push(...fontResults.issues);
    warnings.push(...fontResults.warnings);

    const touchResults = await checkTouchTargets(page, viewport.isMobile);
    issues.push(...touchResults.issues);
    warnings.push(...touchResults.warnings);

    const overflowResults = await checkOverflow(page);
    issues.push(...overflowResults.issues);
    warnings.push(...overflowResults.warnings);

    const criticalResults = await checkCriticalElements(page, viewport);
    issues.push(...criticalResults.issues);
    warnings.push(...criticalResults.warnings);

    // Take screenshot
    const screenshotPath = path.join(screenshotDir, `${viewport.name.replace(/\s+/g, '-').toLowerCase()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    // Log results
    const passed = issues.length === 0;
    console.log(`Status: ${passed ? '✅ PASSED' : '❌ FAILED'}`);

    if (issues.length > 0) {
      console.log('Issues:');
      issues.forEach(i => console.log(`  ❌ ${i}`));
    }

    if (warnings.length > 0) {
      console.log('Warnings:');
      warnings.slice(0, 5).forEach(w => console.log(`  ⚠️  ${w}`));
      if (warnings.length > 5) {
        console.log(`  ... and ${warnings.length - 5} more warnings`);
      }
    }

    results.push({ viewport: viewport.name, passed, issues, warnings });

    await context.close();
  }

  await browser.close();

  // Summary
  console.log('\n\n=== SUMMARY ===');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`Passed: ${passedCount}/${results.length}`);

  results.forEach(r => {
    const status = r.passed ? '✅' : '❌';
    const issueCount = r.issues.length > 0 ? ` (${r.issues.length} issues)` : '';
    console.log(`${status} ${r.viewport}${issueCount}`);
  });

  console.log(`\nScreenshots saved to: ${screenshotDir}`);
}

runTests().catch(console.error);
