/**
 * Agent Spawn Tools - Spawn new Claude agents from MCP
 * 
 * Requires the local agent-spawn-service.cjs to be running
 * Start it with: node agent-spawn-service.cjs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const SPAWN_SERVICE_URL = 'http://localhost:3847';

export function registerSpawnTools(server: McpServer) {
  
  // ============================================================================
  // SPAWN-AGENT TOOL - Create new Claude Code CLI instances
  // ============================================================================
  
  server.tool(
    'spawn-agent',
    'Spawn a new Claude Code CLI agent instance. Requires the local spawn service to be running (node agent-spawn-service.js). The new agent will appear in a new terminal window.',
    {
      agentId: z.string().optional().describe('ID for the new agent (auto-generated if not provided)'),
      task: z.string().optional().describe('Initial task description for the agent'),
      requestedBy: z.string().describe('Your agent ID (who is requesting the spawn)')
    },
    async (args) => {
      const { agentId, task, requestedBy } = args;
      
      try {
        const response = await fetch(`${SPAWN_SERVICE_URL}/spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, task, requestedBy })
        });
        
        if (!response.ok) {
          throw new Error(`Spawn service error: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `🚀 Agent spawned successfully!`,
              agent: data.agent,
              nextSteps: [
                'The new agent will appear in a fresh terminal window',
                'Use group-chat to communicate with them',
                'They will register with the hub automatically'
              ]
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        
        // Check if it's a connection error
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Spawn service not running',
                solution: 'Start the spawn service first:',
                command: 'cd C:\\Users\\tyler\\Desktop\\agent-coord-mcp && node agent-spawn-service.cjs',
                tip: 'Run this in a separate terminal to enable agent spawning'
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: errMsg }, null, 2)
          }]
        };
      }
    }
  );
  
  // ============================================================================
  // SPAWN-BATCH TOOL - Create multiple agents at once
  // ============================================================================
  
  server.tool(
    'spawn-batch',
    'Spawn multiple Claude Code CLI agents at once. Useful for parallel work distribution. Max 10 agents per batch.',
    {
      count: z.number().min(1).max(10).describe('Number of agents to spawn (1-10)'),
      prefix: z.string().optional().describe('Prefix for agent IDs (e.g., "worker" creates worker-1, worker-2, etc.)'),
      requestedBy: z.string().describe('Your agent ID (who is requesting the spawn)')
    },
    async (args) => {
      const { count, prefix = 'spawned-agent', requestedBy } = args;
      
      try {
        const response = await fetch(`${SPAWN_SERVICE_URL}/spawn-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count, prefix, requestedBy })
        });
        
        if (!response.ok) {
          throw new Error(`Spawn service error: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `🚀 Batch spawn complete!`,
              spawned: data.spawned,
              failed: data.failed,
              agents: data.agents,
              tip: 'Each agent will appear in its own terminal window'
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('fetch failed')) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Spawn service not running',
                solution: 'Start the spawn service: node agent-spawn-service.cjs'
              }, null, 2)
            }]
          };
        }
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: errMsg }, null, 2)
          }]
        };
      }
    }
  );
  
  // ============================================================================
  // SPAWN-STATUS TOOL - Check spawn service status
  // ============================================================================
  
  server.tool(
    'spawn-status',
    'Check if the agent spawn service is running and see spawned agents',
    {},
    async () => {
      try {
        const response = await fetch(`${SPAWN_SERVICE_URL}/status`);
        
        if (!response.ok) {
          throw new Error(`Status check failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              service: '✅ Spawn service is running',
              ...data
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              service: '❌ Spawn service is NOT running',
              toStart: 'Run: node agent-spawn-service.cjs',
              location: 'C:\\Users\\tyler\\Desktop\\agent-coord-mcp'
            }, null, 2)
          }]
        };
      }
    }
  );
}
