/**
 * Testing Tools - UI testing, metrics, and browser automation
 *
 * Tools: ui-test, metrics, browser
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { chromium, Browser, Page } from 'playwright';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

// Browser instance management (shared across calls for efficiency)
let browserInstance: Browser | null = null;
let pageInstance: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browserInstance;
}

async function getPage(url?: string): Promise<Page> {
  const browser = await getBrowser();
  if (!pageInstance) {
    pageInstance = await browser.newPage();
  }
  if (url) {
    await pageInstance.goto(url, { waitUntil: 'networkidle' });
  }
  return pageInstance;
}

export function registerTestingTools(server: McpServer) {
  // ============================================================================
  // UI-TEST TOOL - UI/UX testing framework
  // ============================================================================

  server.tool(
    'ui-test',
    'UI/UX testing framework. Create, run, and track visual, accessibility, and interaction tests.',
    {
      action: z.enum(['create', 'run', 'list', 'coverage', 'runs']).describe('Operation'),
      testId: z.string().optional().describe('Test ID for run/get'),
      name: z.string().optional().describe('Test name (for create)'),
      category: z.enum(['accessibility', 'visual', 'interaction', 'responsive', 'performance', 'ux-flow']).optional()
        .describe('Test category'),
      component: z.string().optional().describe('Component being tested'),
      steps: z.array(z.object({
        action: z.string(),
        target: z.string().optional(),
        value: z.string().optional()
      })).optional().describe('Test steps'),
      assertions: z.array(z.object({
        type: z.string(),
        target: z.string().optional(),
        expected: z.string().optional()
      })).optional().describe('Test assertions'),
      result: z.enum(['pass', 'fail', 'error']).optional().describe('Test result (for run)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId } = args;

      try {
        switch (action) {
          case 'create': {
            if (!args.name || !args.category) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'name and category required' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/ui-tests`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: args.name,
                category: args.category,
                component: args.component,
                steps: args.steps || [],
                assertions: args.assertions || [],
                createdBy: agentId
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'run': {
            if (!args.testId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'testId required for run' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/ui-tests?action=run`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                testId: args.testId,
                executedBy: agentId,
                stepResults: [],
                assertionResults: []
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'list': {
            const params = new URLSearchParams();
            if (args.category) params.set('category', args.category);

            const res = await fetch(`${API_BASE}/api/ui-tests?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'coverage': {
            const res = await fetch(`${API_BASE}/api/ui-tests?action=coverage`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'runs': {
            const params = new URLSearchParams({ action: 'runs' });
            if (args.testId) params.set('testId', args.testId);

            const res = await fetch(`${API_BASE}/api/ui-tests?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // METRICS TOOL - Multi-agent efficiency and safety monitoring
  // ============================================================================

  server.tool(
    'metrics',
    'Track and report multi-agent efficiency, safety, and coordination metrics.',
    {
      action: z.enum(['record', 'get', 'leaderboard', 'safety-report', 'safety-event']).describe('Operation'),
      agentId: z.string().describe('Your agent ID'),
      eventType: z.enum(['task_start', 'task_complete', 'error', 'handoff', 'message', 'conflict_avoided', 'checkpoint', 'context_load']).optional()
        .describe('Type of metric event (for record)'),
      duration: z.number().optional().describe('Duration in minutes (for task_complete)'),
      metadata: z.record(z.any()).optional().describe('Additional event metadata'),
      // Safety event fields
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      safetyCategory: z.enum(['file_access', 'destructive_action', 'credential_exposure', 'rate_limit', 'resource_conflict', 'unauthorized']).optional(),
      description: z.string().optional()
    },
    async (args) => {
      const { action, agentId } = args;

      try {
        switch (action) {
          case 'record': {
            if (!args.eventType) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'eventType required for record' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/agent-metrics`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId,
                eventType: args.eventType,
                duration: args.duration,
                metadata: args.metadata
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'get': {
            const res = await fetch(`${API_BASE}/api/agent-metrics?agentId=${encodeURIComponent(agentId)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'leaderboard': {
            const res = await fetch(`${API_BASE}/api/agent-metrics?action=leaderboard`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'safety-report': {
            const res = await fetch(`${API_BASE}/api/agent-metrics?action=safety-report`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'safety-event': {
            if (!args.severity || !args.safetyCategory || !args.description) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'severity, safetyCategory, and description required' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/agent-metrics?action=safety`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agentId,
                severity: args.severity,
                category: args.safetyCategory,
                description: args.description,
                actionTaken: 'logged'
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // BROWSER TOOL - Playwright-powered browser automation for UI testing
  // ============================================================================

  server.tool(
    'browser',
    'Playwright-powered browser automation for UI testing. Navigate, screenshot, click, type, and inspect. Use this for UI improvement tasks.',
    {
      action: z.enum([
        'navigate',      // Go to URL
        'screenshot',    // Take screenshot
        'click',         // Click element
        'type',          // Type text
        'select',        // Get DOM element info
        'evaluate',      // Run JS in page
        'accessibility', // Run accessibility audit
        'close'          // Close browser
      ]).describe('Browser action to perform'),
      url: z.string().optional().describe('URL for navigate action'),
      selector: z.string().optional().describe('CSS selector for click/type/select'),
      text: z.string().optional().describe('Text to type'),
      script: z.string().optional().describe('JavaScript to evaluate in page'),
      fullPage: z.boolean().optional().describe('Take full page screenshot (default: true)'),
      waitFor: z.string().optional().describe('Selector to wait for before action')
    },
    async (args) => {
      const { action } = args;

      try {
        switch (action) {
          case 'navigate': {
            if (!args.url) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'url required for navigate' }) }] };
            }
            const page = await getPage(args.url);
            const title = await page.title();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  url: args.url,
                  title,
                  message: `Navigated to ${args.url}`
                })
              }]
            };
          }

          case 'screenshot': {
            const page = await getPage(args.url);
            if (args.waitFor) {
              await page.waitForSelector(args.waitFor, { timeout: 10000 });
            }
            const screenshot = await page.screenshot({
              fullPage: args.fullPage !== false,
              type: 'png'
            });
            const base64 = screenshot.toString('base64');
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  screenshot: `data:image/png;base64,${base64}`,
                  dimensions: await page.viewportSize(),
                  url: page.url()
                })
              }]
            };
          }

          case 'click': {
            if (!args.selector) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'selector required for click' }) }] };
            }
            const page = await getPage(args.url);
            await page.click(args.selector, { timeout: 10000 });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, clicked: args.selector })
              }]
            };
          }

          case 'type': {
            if (!args.selector || !args.text) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'selector and text required for type' }) }] };
            }
            const page = await getPage(args.url);
            await page.fill(args.selector, args.text);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, typed: args.text, into: args.selector })
              }]
            };
          }

          case 'select': {
            if (!args.selector) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'selector required for select' }) }] };
            }
            const page = await getPage(args.url);
            const element = await page.$(args.selector);
            if (!element) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: `Element not found: ${args.selector}` }) }] };
            }
            const info = await element.evaluate((el: Element) => ({
              tagName: el.tagName,
              id: el.id,
              className: el.className,
              innerText: (el as HTMLElement).innerText?.substring(0, 500),
              attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
              boundingBox: el.getBoundingClientRect()
            }));
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, element: info })
              }]
            };
          }

          case 'evaluate': {
            if (!args.script) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'script required for evaluate' }) }] };
            }
            const page = await getPage(args.url);
            const result = await page.evaluate(args.script);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, result })
              }]
            };
          }

          case 'accessibility': {
            const page = await getPage(args.url);
            // Check for common accessibility issues via HTML inspection
            const issues: string[] = [];
            const html = await page.content();

            if (!html.includes('lang=')) issues.push('Missing lang attribute on html');
            if (!html.includes('<title>') || html.includes('<title></title>')) issues.push('Missing or empty title');

            const imgCount = (html.match(/<img/g) || []).length;
            const altCount = (html.match(/alt=/g) || []).length;
            if (imgCount > altCount) issues.push(`${imgCount - altCount} images missing alt attributes`);

            // Check for form labels
            const inputCount = (html.match(/<input/g) || []).length;
            const labelCount = (html.match(/<label/g) || []).length;
            if (inputCount > labelCount) issues.push(`${inputCount - labelCount} form inputs may be missing labels`);

            // Check for heading structure
            const h1Count = (html.match(/<h1/g) || []).length;
            if (h1Count === 0) issues.push('No h1 heading found');
            if (h1Count > 1) issues.push(`Multiple h1 headings (${h1Count}) found`);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  issues,
                  summary: issues.length === 0 ? 'No major accessibility issues found' : `Found ${issues.length} issues`
                })
              }]
            };
          }

          case 'close': {
            if (pageInstance) {
              await pageInstance.close();
              pageInstance = null;
            }
            if (browserInstance) {
              await browserInstance.close();
              browserInstance = null;
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, message: 'Browser closed' })
              }]
            };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );
}
