const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const DEVICES_TO_TEST = [
  { name: 'iPhone SE', device: devices['iPhone SE'] },
  { name: 'iPhone 14 Pro Max', device: devices['iPhone 14 Pro Max'] },
  { name: 'Pixel 7', device: devices['Pixel 7'] }
];

async function testCrmMobile() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const { name, device } of DEVICES_TO_TEST) {
    console.log(`\n=== Testing CRM on ${name} ===`);

    const context = await browser.newContext({
      ...device,
      permissions: ['geolocation']
    });

    const page = await context.newPage();

    try {
      // Navigate to the page
      await page.goto('http://localhost:3001/', { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`[${name}] Page loaded`);

      // Wait for page load
      await page.waitForTimeout(1000);

      // Hide login overlay (if present) to access the app
      await page.evaluate(() => {
        const overlay = document.querySelector('.login-overlay');
        if (overlay) {
          overlay.style.display = 'none';
        }
        // Set auth flag
        window.isAuthenticated = true;
        if (typeof window.updateAuthUI === 'function') {
          window.updateAuthUI();
        }
      });

      // Click on CRM tab
      const crmTabExists = await page.evaluate(() => {
        const tabs = document.querySelectorAll('.tab');
        for (const tab of tabs) {
          if (tab.textContent.toLowerCase().includes('crm')) {
            tab.click();
            return true;
          }
        }
        return false;
      });

      if (!crmTabExists) {
        console.log(`[${name}] CRM tab not found!`);
        results.push({ device: name, success: false, error: 'CRM tab not found' });
        await context.close();
        continue;
      }

      console.log(`[${name}] Clicked CRM tab`);
      await page.waitForTimeout(1500);

      // Check if CRM view is visible
      const crmViewVisible = await page.evaluate(() => {
        const crmView = document.getElementById('crmView');
        return crmView && crmView.classList.contains('active');
      });

      console.log(`[${name}] CRM view visible: ${crmViewVisible}`);

      // Capture screenshot of CRM
      const screenshotPath = `crm-mobile-${name.toLowerCase().replace(/\s+/g, '-')}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[${name}] Screenshot saved: ${screenshotPath}`);

      // Test pipeline view rendering
      const pipelineStats = await page.evaluate(() => {
        const columns = document.querySelectorAll('.pipeline-column');
        const cards = document.querySelectorAll('.crm-shop-card');
        const totalShopsEl = document.getElementById('crmTotalShops');
        return {
          columnCount: columns.length,
          cardCount: cards.length,
          totalShops: totalShopsEl ? totalShopsEl.textContent : 'N/A',
          pipelineVisible: document.getElementById('crmPipeline')?.style.display !== 'none'
        };
      });

      console.log(`[${name}] Pipeline columns: ${pipelineStats.columnCount}`);
      console.log(`[${name}] Shop cards: ${pipelineStats.cardCount}`);
      console.log(`[${name}] Total shops: ${pipelineStats.totalShops}`);
      console.log(`[${name}] Pipeline visible: ${pipelineStats.pipelineVisible}`);

      // Test clicking on a shop card
      const cardClicked = await page.evaluate(() => {
        const card = document.querySelector('.crm-shop-card');
        if (card) {
          card.click();
          return true;
        }
        return false;
      });

      if (cardClicked) {
        await page.waitForTimeout(500);

        // Check if detail modal opened
        const detailModalVisible = await page.evaluate(() => {
          const modal = document.getElementById('shopDetailModal');
          return modal && modal.style.display === 'flex';
        });

        console.log(`[${name}] Detail modal opened: ${detailModalVisible}`);

        if (detailModalVisible) {
          // Take screenshot of detail modal
          await page.screenshot({ path: `crm-detail-${name.toLowerCase().replace(/\s+/g, '-')}.png` });

          // Close the modal
          await page.evaluate(() => {
            const modal = document.getElementById('shopDetailModal');
            if (modal) modal.style.display = 'none';
          });
        }
      }

      // Test list view
      const switchedToList = await page.evaluate(() => {
        const listBtn = document.querySelector('.crm-view-btn[data-view="list"]');
        if (listBtn) {
          listBtn.click();
          return true;
        }
        return false;
      });

      if (switchedToList) {
        await page.waitForTimeout(500);

        const listViewStats = await page.evaluate(() => {
          const listView = document.getElementById('crmListView');
          const rows = document.querySelectorAll('#crmListBody tr');
          return {
            visible: listView && listView.style.display !== 'none',
            rowCount: rows.length
          };
        });

        console.log(`[${name}] List view visible: ${listViewStats.visible}`);
        console.log(`[${name}] List rows: ${listViewStats.rowCount}`);

        // Take screenshot of list view
        await page.screenshot({ path: `crm-list-${name.toLowerCase().replace(/\s+/g, '-')}.png` });
      }

      // Analyze touch targets
      const touchTargets = await page.evaluate(() => {
        const elements = document.querySelectorAll('.crm-shop-card, .crm-view-btn, .crm-add-btn, .crm-stage-badge');
        const issues = [];

        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            issues.push({
              type: el.className,
              width: rect.width,
              height: rect.height
            });
          }
        });

        return issues;
      });

      if (touchTargets.length > 0) {
        console.log(`[${name}] Touch target issues found:`);
        touchTargets.slice(0, 5).forEach(t => {
          console.log(`  - ${t.type}: ${t.width.toFixed(0)}x${t.height.toFixed(0)}px`);
        });
      } else {
        console.log(`[${name}] All touch targets meet minimum size`);
      }

      results.push({
        device: name,
        success: true,
        pipelineColumns: pipelineStats.columnCount,
        shopCards: pipelineStats.cardCount,
        totalShops: pipelineStats.totalShops,
        touchIssues: touchTargets.length
      });

    } catch (error) {
      console.error(`[${name}] Error: ${error.message}`);
      results.push({ device: name, success: false, error: error.message });
    }

    await context.close();
  }

  await browser.close();

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('CRM MOBILE TEST SUMMARY');
  console.log('='.repeat(50));

  results.forEach(r => {
    if (r.success) {
      console.log(`\n${r.device}: PASS`);
      console.log(`  - Pipeline columns: ${r.pipelineColumns}`);
      console.log(`  - Shop cards: ${r.shopCards}`);
      console.log(`  - Total shops: ${r.totalShops}`);
      console.log(`  - Touch target issues: ${r.touchIssues}`);
    } else {
      console.log(`\n${r.device}: FAIL`);
      console.log(`  - Error: ${r.error}`);
    }
  });

  const allPassed = results.every(r => r.success);
  console.log('\n' + '='.repeat(50));
  console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  console.log('='.repeat(50));

  return allPassed;
}

testCrmMobile().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
