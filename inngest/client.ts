/**
 * Inngest Client Configuration
 *
 * Sleep-Time Compute for Agent Coordination Hub
 * Based on Letta's April 2025 research paper
 *
 * This client enables background memory consolidation jobs
 * that run during agent downtime (like human sleep consolidation).
 *
 * Setup:
 * 1. Install: npm install inngest
 * 2. Add to Vercel: vercel.com/marketplace/inngest (one-click)
 * 3. Configure INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY env vars
 *
 * Local Development:
 * npx inngest-cli dev
 */

// TODO: Uncomment when inngest is installed
// import { Inngest } from 'inngest';

// For now, create a mock client for development
interface MockInngestClient {
  id: string;
  createFunction: (
    config: { id: string; name?: string },
    trigger: { cron?: string; event?: string },
    handler: (ctx: { step: MockStep }) => Promise<unknown>
  ) => MockFunction;
  send: (event: { name: string; data: Record<string, unknown> }) => Promise<void>;
}

interface MockStep {
  run: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
  sleep: (name: string, duration: string) => Promise<void>;
  waitForEvent: (name: string, opts: { event: string; timeout: string }) => Promise<unknown>;
}

interface MockFunction {
  id: string;
  trigger: { cron?: string; event?: string };
}

// Create Inngest client
// When inngest is installed, replace with: new Inngest({ id: 'agent-coord-mcp' })
export const inngest: MockInngestClient = {
  id: 'agent-coord-mcp',

  createFunction(config, trigger, handler) {
    console.log(`[Inngest Mock] Registered function: ${config.id}`);
    return { id: config.id, trigger };
  },

  async send(event) {
    console.log(`[Inngest Mock] Event sent: ${event.name}`, event.data);
  }
};

// Type exports for when we switch to real Inngest
export type { MockStep as InngestStep };
