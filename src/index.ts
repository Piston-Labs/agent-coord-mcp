#!/usr/bin/env node
/**
 * Agent Coordination MCP Server
 *
 * Provides tools for multi-agent coordination:
 * - Agent status tracking
 * - Group chat messaging
 * - Resource locking
 * - Task management
 * - Claims and zones
 * - Session checkpoints
 *
 * Run with: npx agent-coord-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Import tool registration functions
import { registerCoreTools } from './tools/core.js';
import { registerResourceTools } from './tools/resources.js';
import { registerMessagingTools } from './tools/messaging.js';
import { registerContextTools } from './tools/context.js';
import { registerTestingTools } from './tools/testing.js';
import { registerIntegrationTools } from './tools/integrations.js';
import { registerOrchestrationTools } from './tools/orchestration.js';

const server = new McpServer({
  name: 'agent-coord-mcp',
  version: '0.1.0'
});

console.error('[agent-coord-mcp] Starting...');

// Register all tools from modular files
registerCoreTools(server);          // work, agent-status, group-chat
registerResourceTools(server);      // resource, task, zone
registerMessagingTools(server);     // message, handoff, checkpoint
registerContextTools(server);       // context-load, vision, repo-context, memory
registerTestingTools(server);       // ui-test, metrics
registerIntegrationTools(server);   // device, aws-status, fleet-analytics, provision-device, alerts, generate-doc, shop
registerOrchestrationTools(server); // orchestrate, spawn-parallel, workflow, hot-start, auto-poll

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();

server.connect(transport).then(() => {
  console.error('[agent-coord-mcp] Server connected and ready');
  console.error('[agent-coord-mcp] Tools: 27 (work, agent-status, group-chat, resource, task, zone, message, handoff, checkpoint, context-load, vision, repo-context, memory, ui-test, metrics, device, hot-start, workflow, generate-doc, shop, aws-status, fleet-analytics, provision-device, alerts, orchestrate, spawn-parallel, auto-poll)');
}).catch((err: Error) => {
  console.error('[agent-coord-mcp] Failed to connect:', err);
  process.exit(1);
});
