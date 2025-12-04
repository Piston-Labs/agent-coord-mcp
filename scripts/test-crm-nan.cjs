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
  
  // Navigate to CRM
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(2000);
  
  // Screenshot pipeline view
  await page.screenshot({ path: 'crm-pipeline-view.png', fullPage: false });
  console.log('Saved: crm-pipeline-view.png');
  
  // Search for NaN text in the page
  const nanInstances = await page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.includes('NaN')) {
        const parent = node.parentElement;
        results.push({
          text: node.textContent.trim(),
          parentTag: parent?.tagName,
          parentClass: parent?.className,
          parentId: parent?.id,
          grandparentClass: parent?.parentElement?.className
        });
      }
    }
    return results;
  });
  
  console.log('\n=== NaN instances found in pipeline view ===');
  console.log(JSON.stringify(nanInstances, null, 2));
  
  // Switch to list view
  const listViewBtn = await page.$('button:has-text("List")');
  if (listViewBtn) {
    await listViewBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'crm-list-view.png', fullPage: false });
    console.log('Saved: crm-list-view.png');
    
    const nanInList = await page.evaluate(() => {
      const results = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.includes('NaN')) {
          const parent = node.parentElement;
          results.push({
            text: node.textContent.trim(),
            parentTag: parent?.tagName,
            parentClass: parent?.className,
            parentId: parent?.id
          });
        }
      }
      return results;
    });
    
    console.log('\n=== NaN instances found in list view ===');
    console.log(JSON.stringify(nanInList, null, 2));
  }
  
  // Open shop detail modal
  const shopCard = await page.$('.crm-shop-card');
  if (shopCard) {
    await shopCard.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'crm-detail-view.png', fullPage: false });
    console.log('Saved: crm-detail-view.png');
    
    const nanInDetail = await page.evaluate(() => {
      const results = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.includes('NaN')) {
          const parent = node.parentElement;
          results.push({
            text: node.textContent.trim(),
            parentTag: parent?.tagName,
            parentClass: parent?.className,
            parentId: parent?.id
          });
        }
      }
      return results;
    });
    
    console.log('\n=== NaN instances found in detail view ===');
    console.log(JSON.stringify(nanInDetail, null, 2));
    
    // Close detail and open edit modal
    const closeBtn = await page.$('#shopDetailModal .crm-modal-close');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(500);
  }
  
  // Open edit modal
  await page.click('button[data-tab="crm"]');
  await page.waitForTimeout(500);
  const editBtn = await page.$('.crm-shop-card');
  if (editBtn) {
    await editBtn.click();
    await page.waitForTimeout(500);
    const editButton = await page.$('button:has-text("Edit")');
    if (editButton) {
      await editButton.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'crm-edit-modal.png', fullPage: false });
      console.log('Saved: crm-edit-modal.png');
      
      const nanInEdit = await page.evaluate(() => {
        const results = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent.includes('NaN')) {
            const parent = node.parentElement;
            results.push({
              text: node.textContent.trim(),
              parentTag: parent?.tagName,
              parentClass: parent?.className,
              parentId: parent?.id
            });
          }
        }
        return results;
      });
      
      console.log('\n=== NaN instances found in edit modal ===');
      console.log(JSON.stringify(nanInEdit, null, 2));
    }
  }
  
  await browser.close();
})();
