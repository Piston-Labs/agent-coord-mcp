const { chromium, devices } = require('playwright');
const path = require('path');

async function analyzeMobileTelemetry() {
  const browser = await chromium.launch({ headless: true });

  // Test multiple mobile devices
  const mobileDevices = [
    { name: 'iPhone SE', device: devices['iPhone SE'] },
    { name: 'iPhone 14', device: devices['iPhone 14'] },
    { name: 'iPhone 14 Pro Max', device: devices['iPhone 14 Pro Max'] },
    { name: 'Pixel 7', device: devices['Pixel 7'] },
  ];

  console.log('=== Mobile Telemetry Dashboard Analysis ===\n');

  for (const { name, device } of mobileDevices) {
    console.log(`\n--- Testing on ${name} (${device.viewport.width}x${device.viewport.height}) ---`);

    const context = await browser.newContext({
      ...device,
    });
    const page = await context.newPage();

    try {
      // Navigate to the app
      await page.goto('http://localhost:3001', { waitUntil: 'networkidle', timeout: 30000 });

      // Bypass login by directly hiding overlay and triggering init
      await page.evaluate(() => {
        // Hide login overlay
        const overlay = document.querySelector('#loginOverlay');
        if (overlay) overlay.style.display = 'none';

        // Set auth state
        window.isAuthenticated = true;
        localStorage.setItem('agent-hub-username', 'admin');

        // Make sure the app is visible
        const container = document.querySelector('.container');
        if (container) container.style.display = 'flex';
      });

      // Switch to telemetry tab
      await page.evaluate(() => {
        // Find and click telemetry tab or switch panel
        const tab = document.querySelector('.tab-btn[data-tab="telemetry"]');
        if (tab) tab.click();

        // Also try mobile nav
        const mobileNav = document.querySelector('.mobile-nav-item[data-panel="telemetry"]');
        if (mobileNav) mobileNav.click();

        // Make telemetry section visible
        const telemetrySection = document.querySelector('#telemetry');
        if (telemetrySection) {
          // Hide all other sections
          document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
          telemetrySection.classList.add('active');
        }
      });

      await page.waitForTimeout(1000);

      // Inject mock telemetry data for testing UI
      await page.evaluate(() => {
        const grid = document.querySelector('.telemetry-grid');
        if (grid) {
          grid.innerHTML = '';
          const mockDevices = [
            { name: 'TRUCK-001', status: 'active', battery: 85, speed: 45, health: 92, temp: 72 },
            { name: 'VAN-002', status: 'moving', battery: 72, speed: 32, health: 88, temp: 68 },
            { name: 'TRUCK-003', status: 'idle', battery: 95, speed: 0, health: 78, temp: 74 },
            { name: 'CARGO-004', status: 'offline', battery: 15, speed: 0, health: 45, temp: 82 },
          ];

          mockDevices.forEach(d => {
            const card = document.createElement('div');
            card.className = `device-card ${d.status}`;
            card.innerHTML = `
              <div class="device-header">
                <span class="device-name">${d.name}</span>
                <span class="device-status ${d.status}">${d.status.toUpperCase()}</span>
              </div>
              <div class="device-metrics">
                <div class="device-metric">
                  <span class="device-metric-label">Battery</span>
                  <span class="device-metric-value">${d.battery}%</span>
                </div>
                <div class="device-metric">
                  <span class="device-metric-label">Speed</span>
                  <span class="device-metric-value">${d.speed} mph</span>
                </div>
                <div class="device-metric">
                  <span class="device-metric-label">Health</span>
                  <span class="device-metric-value">${d.health}%</span>
                </div>
                <div class="device-metric">
                  <span class="device-metric-label">Temp</span>
                  <span class="device-metric-value">${d.temp}°F</span>
                </div>
              </div>
            `;
            grid.appendChild(card);
          });
        }

        // Update fleet stats
        const stats = document.querySelectorAll('.fleet-stat-value');
        if (stats.length >= 5) {
          stats[0].textContent = '4';
          stats[1].textContent = '2';
          stats[2].textContent = '1';
          stats[3].textContent = '72%';
          stats[4].textContent = '76';
        }
      });

      await page.waitForTimeout(500);

      // Take screenshot
      const screenshotPath = path.join(__dirname, `mobile-analysis-${name.toLowerCase().replace(/\s+/g, '-')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`  Screenshot: ${screenshotPath}`);

      // === UI Analysis ===
      console.log('\n  === UI ANALYSIS ===');

      // Check for horizontal overflow (critical mobile issue)
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`  Horizontal overflow: ${hasOverflow ? '⚠️  YES - NEEDS FIX' : '✓ No'}`);

      // Check viewport vs content width
      const widths = await page.evaluate(() => ({
        viewport: window.innerWidth,
        body: document.body.scrollWidth,
        docElement: document.documentElement.scrollWidth
      }));
      console.log(`  Viewport: ${widths.viewport}px, Body: ${widths.body}px, Doc: ${widths.docElement}px`);

      // Check telemetry grid
      const gridInfo = await page.evaluate(() => {
        const grid = document.querySelector('.telemetry-grid');
        if (!grid) return null;
        const styles = window.getComputedStyle(grid);
        return {
          display: styles.display,
          columns: styles.gridTemplateColumns,
          gap: styles.gap,
          padding: styles.padding,
          width: grid.offsetWidth
        };
      });
      if (gridInfo) {
        console.log(`  Grid layout: ${gridInfo.display}`);
        console.log(`    Columns: ${gridInfo.columns}`);
        console.log(`    Padding: ${gridInfo.padding}`);
        console.log(`    Width: ${gridInfo.width}px`);
      }

      // Check device cards
      const cardInfo = await page.evaluate(() => {
        const cards = document.querySelectorAll('.device-card');
        if (cards.length === 0) return { count: 0 };
        const first = cards[0];
        const rect = first.getBoundingClientRect();
        const styles = window.getComputedStyle(first);
        const nameEl = first.querySelector('.device-name');
        return {
          count: cards.length,
          width: rect.width,
          height: rect.height,
          padding: styles.padding,
          fontSize: nameEl ? window.getComputedStyle(nameEl).fontSize : 'N/A'
        };
      });
      console.log(`  Device cards: ${cardInfo.count}`);
      if (cardInfo.count > 0) {
        const widthPct = Math.round(cardInfo.width / device.viewport.width * 100);
        console.log(`    Card width: ${Math.round(cardInfo.width)}px (${widthPct}% of viewport)`);
        console.log(`    Card height: ${Math.round(cardInfo.height)}px`);
        console.log(`    Padding: ${cardInfo.padding}`);
        console.log(`    Name font size: ${cardInfo.fontSize}`);
        if (widthPct < 90) {
          console.log(`    ⚠️  Cards not using full width - content may be squished`);
        }
      }

      // Check fleet summary stats
      const statsInfo = await page.evaluate(() => {
        const stats = document.querySelectorAll('.fleet-stat');
        if (stats.length === 0) return { count: 0 };
        const data = Array.from(stats).map(s => {
          const label = s.querySelector('.fleet-stat-label');
          const value = s.querySelector('.fleet-stat-value');
          return {
            width: s.offsetWidth,
            labelFont: label ? window.getComputedStyle(label).fontSize : 'N/A',
            valueFont: value ? window.getComputedStyle(value).fontSize : 'N/A',
            labelText: label ? label.textContent : ''
          };
        });
        return {
          count: stats.length,
          items: data,
          minWidth: Math.min(...data.map(d => d.width)),
          maxWidth: Math.max(...data.map(d => d.width))
        };
      });
      console.log(`  Fleet stats: ${statsInfo.count} items`);
      if (statsInfo.count > 0) {
        console.log(`    Width range: ${statsInfo.minWidth}px - ${statsInfo.maxWidth}px`);
        console.log(`    Label font: ${statsInfo.items[0]?.labelFont}`);
        console.log(`    Value font: ${statsInfo.items[0]?.valueFont}`);
        if (statsInfo.minWidth < 55) {
          console.log(`    ⚠️  Stats too narrow (min ${statsInfo.minWidth}px) - labels may be truncated`);
        }
      }

      // Check metrics display within cards
      const metricsInfo = await page.evaluate(() => {
        const metrics = document.querySelectorAll('.device-metric');
        if (metrics.length === 0) return null;
        const first = metrics[0];
        const label = first.querySelector('.device-metric-label');
        const value = first.querySelector('.device-metric-value');
        const grid = first.closest('.device-metrics');
        const gridStyles = grid ? window.getComputedStyle(grid) : null;
        return {
          count: metrics.length,
          labelFont: label ? window.getComputedStyle(label).fontSize : 'N/A',
          valueFont: value ? window.getComputedStyle(value).fontSize : 'N/A',
          width: first.offsetWidth,
          gridColumns: gridStyles ? gridStyles.gridTemplateColumns : 'N/A'
        };
      });
      if (metricsInfo) {
        console.log(`  Metrics per card: ${metricsInfo.count / cardInfo.count} items`);
        console.log(`    Grid columns: ${metricsInfo.gridColumns}`);
        console.log(`    Label font: ${metricsInfo.labelFont}`);
        console.log(`    Value font: ${metricsInfo.valueFont}`);
        if (parseInt(metricsInfo.valueFont) < 14) {
          console.log(`    ⚠️  Metric values small (${metricsInfo.valueFont}) - may be hard to read`);
        }
      }

      // Check touch targets
      const touchIssues = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, .btn, [role="button"], .device-card');
        let issues = [];
        buttons.forEach(btn => {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
            issues.push({
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              class: btn.className.substring(0, 30)
            });
          }
        });
        return issues;
      });
      if (touchIssues.length > 0) {
        console.log(`  ⚠️  ${touchIssues.length} touch targets < 44x44px:`);
        touchIssues.slice(0, 3).forEach(i => console.log(`    - ${i.class}: ${i.width}x${i.height}px`));
      } else {
        console.log(`  ✓ Touch targets OK`);
      }

      // Check for text overflow/clipping
      const textIssues = await page.evaluate(() => {
        const issues = [];
        const elements = document.querySelectorAll('.device-name, .fleet-stat-label, .device-metric-label, .device-metric-value');
        elements.forEach(el => {
          if (el.scrollWidth > el.clientWidth + 1) {
            issues.push({
              class: el.className,
              text: el.textContent?.substring(0, 15),
              scrollW: el.scrollWidth,
              clientW: el.clientWidth
            });
          }
        });
        return issues;
      });
      if (textIssues.length > 0) {
        console.log(`  ⚠️  Text overflow in ${textIssues.length} elements:`);
        textIssues.slice(0, 3).forEach(i =>
          console.log(`    - .${i.class}: "${i.text}" (${i.scrollW}px > ${i.clientW}px)`));
      } else {
        console.log(`  ✓ No text overflow`);
      }

      // Check mobile nav visibility
      const navInfo = await page.evaluate(() => {
        const nav = document.querySelector('.mobile-nav');
        if (!nav) return { exists: false };
        const styles = window.getComputedStyle(nav);
        return {
          exists: true,
          display: styles.display,
          height: nav.offsetHeight,
          visible: styles.display !== 'none' && nav.offsetHeight > 0
        };
      });
      console.log(`  Mobile nav: ${navInfo.exists ? (navInfo.visible ? `visible (${navInfo.height}px)` : 'hidden') : 'not found'}`);

    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }

    await context.close();
  }

  await browser.close();
  console.log('\n\n=== Analysis Complete ===');
}

analyzeMobileTelemetry().catch(console.error);
