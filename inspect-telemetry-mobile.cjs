const { chromium } = require('playwright');

/**
 * Mobile Telemetry Responsiveness Test
 * Tests telemetry section display quality across multiple mobile devices
 */

const MOBILE_DEVICES = [
  { name: 'iPhone SE', viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 },
  { name: 'iPhone 14', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  { name: 'iPhone 14 Pro Max', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 },
  { name: 'Pixel 7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 },
  { name: 'Galaxy S21', viewport: { width: 360, height: 800 }, deviceScaleFactor: 3 },
  { name: 'iPad Mini', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 },
];

const URL = 'https://agent-coord-mcp.vercel.app';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'piston2025';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDevice(device) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${device.name} (${device.viewport.width}x${device.viewport.height})`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });

  const page = await context.newPage();
  const issues = [];
  const metrics = {};

  try {
    // Navigate and login
    console.log('Navigating to hub...');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(1500);

    // Login
    const loginForm = await page.$('#loginForm');
    if (loginForm) {
      console.log('Logging in...');
      await page.fill('#loginUsername', ADMIN_USERNAME);
      await page.fill('#loginPassword', ADMIN_PASSWORD);
      await page.click('#loginForm button[type="submit"]');
      await sleep(3000);
    }

    // Navigate to telemetry tab
    console.log('Navigating to telemetry section...');
    const mobileNavBtn = await page.$('.mobile-nav-item[data-panel="telemetry"]');
    const tabBtn = await page.$('button[data-tab="telemetry"]');
    
    if (mobileNavBtn) {
      await mobileNavBtn.click();
    } else if (tabBtn) {
      await tabBtn.click();
    } else {
      console.log('Could not find telemetry navigation button');
    }
    await sleep(2000);

    // Take initial screenshot
    const screenshotName = `telemetry-${device.name.toLowerCase().replace(/\s+/g, '-')}.png`;
    await page.screenshot({ path: screenshotName, fullPage: true });
    console.log(`Screenshot saved: ${screenshotName}`);

    // Analyze telemetry section
    const analysis = await page.evaluate(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const issues = [];
      const elements = {};

      // Check telemetry view
      const telemetryView = document.getElementById('telemetryView');
      if (telemetryView) {
        const rect = telemetryView.getBoundingClientRect();
        const style = getComputedStyle(telemetryView);
        elements.telemetryView = {
          width: rect.width,
          height: rect.height,
          display: style.display,
          overflow: style.overflow,
          overflowX: style.overflowX,
          visible: style.display !== 'none'
        };
        
        if (rect.width > viewport.width) {
          issues.push({
            element: 'telemetryView',
            issue: 'Overflows viewport width',
            details: `${rect.width}px > ${viewport.width}px`
          });
        }
      }

      // Check fleet summary
      const fleetSummary = document.querySelector('.fleet-summary');
      if (fleetSummary) {
        const rect = fleetSummary.getBoundingClientRect();
        const style = getComputedStyle(fleetSummary);
        elements.fleetSummary = {
          width: rect.width,
          height: rect.height,
          display: style.display,
          flexWrap: style.flexWrap,
          flexDirection: style.flexDirection,
          gap: style.gap
        };

        // Check for horizontal overflow
        if (rect.width > viewport.width) {
          issues.push({
            element: 'fleet-summary',
            issue: 'Horizontal overflow',
            details: `Width ${rect.width}px exceeds viewport ${viewport.width}px`
          });
        }

        // Check if items wrap properly
        const fleetStats = fleetSummary.querySelectorAll('.fleet-stat');
        if (fleetStats.length > 0) {
          const firstRect = fleetStats[0].getBoundingClientRect();
          const lastRect = fleetStats[fleetStats.length - 1].getBoundingClientRect();
          
          if (firstRect.top === lastRect.top && rect.width > viewport.width * 0.9) {
            issues.push({
              element: 'fleet-stats',
              issue: 'Stats not wrapping on small screen',
              details: 'All items on same row may cause overflow'
            });
          }
        }
      }

      // Check device list table
      const deviceTable = document.querySelector('.device-list-table');
      if (deviceTable) {
        const rect = deviceTable.getBoundingClientRect();
        const container = deviceTable.closest('.device-list-container');
        const containerStyle = container ? getComputedStyle(container) : null;
        
        elements.deviceTable = {
          width: rect.width,
          height: rect.height,
          containerOverflowX: containerStyle?.overflowX,
          visible: rect.height > 0
        };

        if (rect.width > viewport.width) {
          if (containerStyle?.overflowX !== 'auto' && containerStyle?.overflowX !== 'scroll') {
            issues.push({
              element: 'device-list-table',
              issue: 'Table overflows without horizontal scroll',
              details: `Table width ${rect.width}px > viewport ${viewport.width}px`
            });
          }
        }
      }

      // Check health overview
      const healthOverview = document.querySelector('.health-overview');
      if (healthOverview) {
        const rect = healthOverview.getBoundingClientRect();
        const style = getComputedStyle(healthOverview);
        elements.healthOverview = {
          width: rect.width,
          height: rect.height,
          display: style.display,
          flexDirection: style.flexDirection
        };

        if (rect.width > viewport.width) {
          issues.push({
            element: 'health-overview',
            issue: 'Exceeds viewport width',
            details: `${rect.width}px vs ${viewport.width}px viewport`
          });
        }
      }

      // Check telemetry header
      const telemetryHeader = document.querySelector('.telemetry-header');
      if (telemetryHeader) {
        const rect = telemetryHeader.getBoundingClientRect();
        const style = getComputedStyle(telemetryHeader);
        elements.telemetryHeader = {
          width: rect.width,
          height: rect.height,
          display: style.display,
          flexDirection: style.flexDirection,
          flexWrap: style.flexWrap
        };

        if (rect.width > viewport.width) {
          issues.push({
            element: 'telemetry-header',
            issue: 'Header overflows viewport',
            details: `${rect.width}px > ${viewport.width}px`
          });
        }
      }

      // Check telemetry controls
      const telemetryControls = document.querySelector('.telemetry-controls');
      if (telemetryControls) {
        const rect = telemetryControls.getBoundingClientRect();
        const style = getComputedStyle(telemetryControls);
        elements.telemetryControls = {
          width: rect.width,
          height: rect.height,
          display: style.display,
          flexWrap: style.flexWrap,
          gap: style.gap
        };

        if (rect.width > viewport.width * 0.95) {
          issues.push({
            element: 'telemetry-controls',
            issue: 'Controls too wide for mobile',
            details: `Controls take ${Math.round(rect.width / viewport.width * 100)}% of viewport`
          });
        }
      }

      // Check font sizes
      const textElements = [
        { selector: '.fleet-stat-value', name: 'Fleet stat values' },
        { selector: '.fleet-stat-label', name: 'Fleet stat labels' },
        { selector: '.device-list-table th', name: 'Table headers' },
        { selector: '.device-list-table td', name: 'Table cells' },
        { selector: '.gauge-score', name: 'Gauge score' },
        { selector: '.breakdown-label', name: 'Breakdown labels' },
      ];

      elements.fontSizes = {};
      textElements.forEach(({ selector, name }) => {
        const el = document.querySelector(selector);
        if (el) {
          const fontSize = parseFloat(getComputedStyle(el).fontSize);
          elements.fontSizes[name] = `${fontSize}px`;
          if (fontSize < 10) {
            issues.push({
              element: selector,
              issue: 'Font too small for mobile',
              details: `${fontSize}px is below 10px minimum`
            });
          }
        }
      });

      // Check touch targets (buttons should be at least 44x44px)
      const buttons = document.querySelectorAll('.telemetry-controls button, .map-btn, .refresh-btn');
      buttons.forEach((btn, idx) => {
        const rect = btn.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          issues.push({
            element: `button[${idx}]`,
            issue: 'Touch target too small',
            details: `${Math.round(rect.width)}x${Math.round(rect.height)}px (min 44x44)`
          });
        }
      });

      // Check for horizontal scrollbar on body
      const hasHorizontalScroll = document.body.scrollWidth > window.innerWidth;
      if (hasHorizontalScroll) {
        issues.push({
          element: 'body',
          issue: 'Page has horizontal scrollbar',
          details: `Content width ${document.body.scrollWidth}px > viewport ${window.innerWidth}px`
        });
      }

      return { viewport, issues, elements };
    });

    metrics[device.name] = analysis;

    // Report issues
    if (analysis.issues.length > 0) {
      console.log('\n⚠️  Issues found:');
      analysis.issues.forEach((issue, idx) => {
        console.log(`  ${idx + 1}. [${issue.element}] ${issue.issue}`);
        console.log(`     ${issue.details}`);
        issues.push(issue);
      });
    } else {
      console.log('\n✅ No major issues found');
    }

    // Print element metrics
    console.log('\n📊 Element Metrics:');
    Object.entries(analysis.elements).forEach(([name, data]) => {
      if (typeof data === 'object' && data.width) {
        console.log(`  ${name}: ${data.width}x${data.height}px`);
      }
    });

    if (analysis.elements.fontSizes) {
      console.log('\n📝 Font Sizes:');
      Object.entries(analysis.elements.fontSizes).forEach(([name, size]) => {
        console.log(`  ${name}: ${size}`);
      });
    }

  } catch (error) {
    console.error('Test error:', error);
    issues.push({ element: 'test', issue: 'Test failed', details: error.message });
  } finally {
    await browser.close();
  }

  return { device: device.name, issues, metrics: metrics[device.name] };
}

async function runAllTests() {
  console.log('🚀 Mobile Telemetry Responsiveness Test Suite');
  console.log(`Testing ${MOBILE_DEVICES.length} devices...`);
  
  const allResults = [];
  const allIssues = new Map();

  for (const device of MOBILE_DEVICES) {
    const result = await testDevice(device);
    allResults.push(result);
    
    // Aggregate issues by type
    result.issues.forEach(issue => {
      const key = `${issue.element}:${issue.issue}`;
      if (!allIssues.has(key)) {
        allIssues.set(key, { ...issue, devices: [] });
      }
      allIssues.get(key).devices.push(device.name);
    });
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  console.log('\n📱 Devices Tested:');
  allResults.forEach(r => {
    const status = r.issues.length === 0 ? '✅' : `⚠️ (${r.issues.length} issues)`;
    console.log(`  ${status} ${r.device}`);
  });

  if (allIssues.size > 0) {
    console.log('\n🔧 Common Issues to Fix:');
    [...allIssues.values()].forEach((issue, idx) => {
      console.log(`\n  ${idx + 1}. ${issue.issue}`);
      console.log(`     Element: ${issue.element}`);
      console.log(`     Affected: ${issue.devices.join(', ')}`);
      console.log(`     Details: ${issue.details}`);
    });
  } else {
    console.log('\n✅ All devices passed - no responsiveness issues detected!');
  }

  // Generate CSS recommendations
  if (allIssues.size > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('RECOMMENDED CSS FIXES');
    console.log('='.repeat(60));
    
    const fixes = [];
    
    allIssues.forEach((issue) => {
      if (issue.issue.includes('overflow') || issue.issue.includes('Exceeds viewport')) {
        fixes.push(`/* Fix for ${issue.element} overflow */`);
        if (issue.element.includes('table')) {
          fixes.push(`.device-list-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }`);
        } else if (issue.element.includes('summary')) {
          fixes.push(`.fleet-summary { flex-wrap: wrap; gap: 8px; }`);
        } else if (issue.element.includes('header')) {
          fixes.push(`.telemetry-header { flex-direction: column; gap: 12px; }`);
        }
      }
      if (issue.issue.includes('Touch target')) {
        fixes.push(`/* Larger touch targets */`);
        fixes.push(`.telemetry-controls button { min-width: 44px; min-height: 44px; padding: 10px 16px; }`);
      }
      if (issue.issue.includes('Font too small')) {
        fixes.push(`/* Minimum font sizes */`);
        fixes.push(`@media (max-width: 768px) { ${issue.element} { font-size: 12px !important; } }`);
      }
    });

    if (fixes.length > 0) {
      console.log('\n@media (max-width: 768px) {');
      [...new Set(fixes)].forEach(fix => console.log(`  ${fix}`));
      console.log('}');
    }
  }

  console.log('\n✅ Test suite complete!');
}

runAllTests().catch(console.error);
