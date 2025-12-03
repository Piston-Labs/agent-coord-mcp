/**
 * Human User Simulation for Roadmap Testing
 *
 * Simulates realistic human interaction patterns to test the roadmap feature
 * and generate feedback like a real user would.
 *
 * Features:
 * - Realistic timing (human-like delays between actions)
 * - Multiple user personas (CEO, Developer, PM)
 * - Comprehensive UI interaction testing
 * - Automated feedback generation
 */

import { chromium, Page, Browser } from 'playwright';

const BASE_URL = process.env.TEST_URL || 'https://agent-coord-mcp.vercel.app';

// ============================================================================
// User Personas - Different user types with different behaviors
// ============================================================================

interface UserPersona {
  name: string;
  role: string;
  typingSpeed: number;    // ms per character
  clickDelay: number;     // ms between clicks
  scrollSpeed: number;    // px per scroll
  patience: number;       // max wait time before "frustrated"
  priorities: string[];   // what they care about
}

const PERSONAS: UserPersona[] = [
  {
    name: 'Tyler (CEO)',
    role: 'executive',
    typingSpeed: 50,
    clickDelay: 300,
    scrollSpeed: 200,
    patience: 3000,
    priorities: ['overview', 'team-workload', 'deadlines', 'blockers']
  },
  {
    name: 'Ryan (Developer)',
    role: 'developer',
    typingSpeed: 30,
    clickDelay: 150,
    scrollSpeed: 400,
    patience: 5000,
    priorities: ['my-tasks', 'technical-details', 'dependencies', 'code-links']
  },
  {
    name: 'Eli (Sales)',
    role: 'sales',
    typingSpeed: 60,
    clickDelay: 400,
    scrollSpeed: 150,
    patience: 2000,
    priorities: ['customer-features', 'release-dates', 'demos']
  }
];

// ============================================================================
// Feedback Types
// ============================================================================

interface UserFeedback {
  persona: string;
  timestamp: string;
  category: 'usability' | 'bug' | 'feature-request' | 'positive' | 'confusion';
  severity: 'critical' | 'major' | 'minor' | 'info';
  element: string;
  action: string;
  feedback: string;
  suggestion?: string;
}

const feedbackLog: UserFeedback[] = [];

// ============================================================================
// Human-like Interaction Helpers
// ============================================================================

async function humanDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function humanType(page: Page, selector: string, text: string, persona: UserPersona): Promise<void> {
  const element = page.locator(selector);
  await element.click();

  for (const char of text) {
    await element.pressSequentially(char, { delay: persona.typingSpeed + Math.random() * 30 });
  }
}

async function humanClick(page: Page, selector: string, persona: UserPersona): Promise<boolean> {
  try {
    await humanDelay(100, persona.clickDelay);
    const element = page.locator(selector);

    if (await element.count() === 0) {
      return false;
    }

    // Move mouse to element naturally
    const box = await element.first().boundingBox();
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2 + (Math.random() * 10 - 5),
        box.y + box.height / 2 + (Math.random() * 10 - 5)
      );
    }

    await element.first().click();
    return true;
  } catch (e) {
    return false;
  }
}

async function humanScroll(page: Page, direction: 'up' | 'down', persona: UserPersona): Promise<void> {
  const amount = direction === 'down' ? persona.scrollSpeed : -persona.scrollSpeed;
  await page.mouse.wheel(0, amount);
  await humanDelay(100, 300);
}

// ============================================================================
// Roadmap Audit Functions
// ============================================================================

async function auditDropdown(
  page: Page,
  dropdownSelector: string,
  optionsSelector: string,
  expectedOptions: string[],
  dropdownName: string,
  persona: UserPersona
): Promise<UserFeedback[]> {
  const feedback: UserFeedback[] = [];

  console.log(`\n  📋 Auditing ${dropdownName} dropdown...`);

  // Try to open dropdown
  const clicked = await humanClick(page, dropdownSelector, persona);

  if (!clicked) {
    feedback.push({
      persona: persona.name,
      timestamp: new Date().toISOString(),
      category: 'bug',
      severity: 'critical',
      element: dropdownSelector,
      action: 'click',
      feedback: `Cannot find ${dropdownName} dropdown - element not present`,
      suggestion: `Add ${dropdownName} dropdown to the UI`
    });
    return feedback;
  }

  await humanDelay(300, 500);

  // Check if options appeared
  const options = page.locator(optionsSelector);
  const optionCount = await options.count();

  if (optionCount === 0) {
    feedback.push({
      persona: persona.name,
      timestamp: new Date().toISOString(),
      category: 'bug',
      severity: 'critical',
      element: dropdownName,
      action: 'open dropdown',
      feedback: `${dropdownName} dropdown opens but shows no options`,
      suggestion: 'Populate dropdown with options from API'
    });
  } else {
    console.log(`    Found ${optionCount} options`);

    // Get actual option texts
    const actualOptions: string[] = [];
    for (let i = 0; i < optionCount; i++) {
      const text = await options.nth(i).textContent();
      if (text) actualOptions.push(text.trim().toLowerCase());
    }

    // Check for missing expected options
    for (const expected of expectedOptions) {
      if (!actualOptions.some(opt => opt.includes(expected.toLowerCase()))) {
        feedback.push({
          persona: persona.name,
          timestamp: new Date().toISOString(),
          category: 'bug',
          severity: 'major',
          element: dropdownName,
          action: 'check options',
          feedback: `Missing expected option: "${expected}"`,
          suggestion: `Add "${expected}" to ${dropdownName} dropdown`
        });
      }
    }

    // Positive feedback if all options present
    if (feedback.length === 0) {
      feedback.push({
        persona: persona.name,
        timestamp: new Date().toISOString(),
        category: 'positive',
        severity: 'info',
        element: dropdownName,
        action: 'audit',
        feedback: `${dropdownName} dropdown has all ${expectedOptions.length} expected options`
      });
    }
  }

  // Close dropdown by clicking elsewhere
  await page.click('body', { position: { x: 10, y: 10 } });
  await humanDelay(200, 400);

  return feedback;
}

async function testRoadmapInteraction(page: Page, persona: UserPersona): Promise<UserFeedback[]> {
  const feedback: UserFeedback[] = [];

  console.log(`\n🧑 Testing as ${persona.name} (${persona.role})...`);

  // Navigate to roadmap
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Handle login overlay
  await page.evaluate(() => {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.remove();
  });
  await humanDelay(500, 1000);

  // Click on Roadmap tab - use data-tab attribute for reliability
  const roadmapTab = page.locator('button[data-tab="roadmap"], button.tab:has-text("Roadmap")');
  if (await roadmapTab.count() > 0) {
    await roadmapTab.first().click({ force: true }); // force click to bypass any overlays
    await humanDelay(500, 1000);
    console.log('  ✅ Clicked Roadmap tab');
  } else {
    feedback.push({
      persona: persona.name,
      timestamp: new Date().toISOString(),
      category: 'bug',
      severity: 'critical',
      element: 'roadmap-tab',
      action: 'navigate',
      feedback: 'Cannot find Roadmap tab - unable to access roadmap feature'
    });
    return feedback;
  }

  // Wait for roadmap view to be visible and filters to load
  await page.waitForTimeout(500);
  try {
    await page.waitForSelector('#roadmapView.active, .roadmap-filters', { timeout: 5000 });
    console.log('  ✅ Roadmap view loaded');
  } catch {
    console.log('  ⚠️ Roadmap view may not have loaded fully');
  }
  await page.waitForTimeout(500);

  // Take screenshot
  const safeName = persona.name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  await page.screenshot({
    path: `test/screenshots/roadmap-${safeName}.png`,
    fullPage: true
  });
  console.log(`  📸 Screenshot saved: roadmap-${safeName}.png`);

  // Audit dropdowns - using ID-based selectors matching web/index.html
  // The roadmap uses standard <select> elements with specific IDs

  // 1. Project dropdown (#projectFilter)
  const projectFeedback = await auditDropdown(
    page,
    '#projectFilter',
    '#projectFilter option',
    ['piston-dashboard', 'teltonika-iot', 'agent-coord'],
    'Project',
    persona
  );
  feedback.push(...projectFeedback);

  // 2. Assignee dropdown (#assigneeFilter) - dynamically populated
  const assigneeFeedback = await auditDropdown(
    page,
    '#assigneeFilter',
    '#assigneeFilter option',
    ['ryan', 'tom', 'tyler', 'eli', 'david'],
    'Assignee',
    persona
  );
  feedback.push(...assigneeFeedback);

  // 3. Priority dropdown (#priorityFilter)
  const priorityFeedback = await auditDropdown(
    page,
    '#priorityFilter',
    '#priorityFilter option',
    ['low', 'medium', 'high', 'critical'],
    'Priority',
    persona
  );
  feedback.push(...priorityFeedback);

  // 4. Sprint/Cycle dropdown (#cycleFilter)
  const sprintFeedback = await auditDropdown(
    page,
    '#cycleFilter',
    '#cycleFilter option',
    [], // Sprints are dynamic, just check it exists
    'Sprint',
    persona
  );
  feedback.push(...sprintFeedback);

  // Check for overall usability issues
  // Look for empty states
  const emptyState = await page.locator('.empty-state, .no-items, :text("No items")').count();
  if (emptyState > 0) {
    feedback.push({
      persona: persona.name,
      timestamp: new Date().toISOString(),
      category: 'usability',
      severity: 'minor',
      element: 'roadmap-items',
      action: 'view',
      feedback: 'Roadmap appears empty - consider adding sample items for new users'
    });
  }

  // Check for loading states
  const loading = await page.locator('.loading, .spinner, :text("Loading")').count();
  if (loading > 0) {
    await page.waitForTimeout(persona.patience);
    const stillLoading = await page.locator('.loading, .spinner').count();
    if (stillLoading > 0) {
      feedback.push({
        persona: persona.name,
        timestamp: new Date().toISOString(),
        category: 'usability',
        severity: 'major',
        element: 'roadmap',
        action: 'wait',
        feedback: `Roadmap still loading after ${persona.patience}ms - user would get frustrated`,
        suggestion: 'Optimize loading time or add skeleton loaders'
      });
    }
  }

  return feedback;
}

// ============================================================================
// Main Simulation
// ============================================================================

async function runSimulation(): Promise<void> {
  console.log('🤖 Human User Simulation for Roadmap Testing\n');
  console.log(`Target: ${BASE_URL}\n`);
  console.log('='.repeat(60));

  // Ensure screenshots directory exists
  const fs = await import('fs');
  if (!fs.existsSync('test/screenshots')) {
    fs.mkdirSync('test/screenshots', { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  for (const persona of PERSONAS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Simulating: ${persona.name}`);
    console.log('='.repeat(60));

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    try {
      const feedback = await testRoadmapInteraction(page, persona);
      feedbackLog.push(...feedback);
    } catch (e) {
      console.error(`Error testing as ${persona.name}:`, e);
      feedbackLog.push({
        persona: persona.name,
        timestamp: new Date().toISOString(),
        category: 'bug',
        severity: 'critical',
        element: 'simulation',
        action: 'run',
        feedback: `Simulation crashed: ${e}`
      });
    }

    await context.close();
  }

  await browser.close();

  // Summary Report
  console.log('\n' + '='.repeat(60));
  console.log('SIMULATION REPORT');
  console.log('='.repeat(60));

  const bugs = feedbackLog.filter(f => f.category === 'bug');
  const usability = feedbackLog.filter(f => f.category === 'usability');
  const positive = feedbackLog.filter(f => f.category === 'positive');

  console.log(`\n📊 Summary:`);
  console.log(`  🐛 Bugs: ${bugs.length}`);
  console.log(`  ⚠️ Usability Issues: ${usability.length}`);
  console.log(`  ✅ Positive Findings: ${positive.length}`);

  if (bugs.length > 0) {
    console.log('\n--- BUGS ---');
    bugs.forEach(b => {
      console.log(`  [${b.severity.toUpperCase()}] ${b.element}: ${b.feedback}`);
      if (b.suggestion) console.log(`    💡 Suggestion: ${b.suggestion}`);
    });
  }

  if (usability.length > 0) {
    console.log('\n--- USABILITY ISSUES ---');
    usability.forEach(u => {
      console.log(`  [${u.severity.toUpperCase()}] ${u.element}: ${u.feedback}`);
      if (u.suggestion) console.log(`    💡 Suggestion: ${u.suggestion}`);
    });
  }

  if (positive.length > 0) {
    console.log('\n--- POSITIVE FINDINGS ---');
    positive.forEach(p => {
      console.log(`  ✅ ${p.element}: ${p.feedback}`);
    });
  }

  // Output JSON
  console.log('\n--- FULL REPORT (JSON) ---');
  console.log(JSON.stringify(feedbackLog, null, 2));
}

runSimulation().catch(console.error);
