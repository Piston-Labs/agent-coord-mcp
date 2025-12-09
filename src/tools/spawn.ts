/**
 * Agent Spawn Tools - Spawn new Claude agents from MCP
 *
 * Local spawn: Requires agent-spawn-service.cjs running locally
 * Cloud spawn: Uses Vercel API to spawn agents in AWS cloud
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const SPAWN_SERVICE_URL = 'http://localhost:3847';
const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

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

  // ============================================================================
  // SPAWN-CLOUD-AGENT TOOL - Spawn agents in AWS cloud (no local machine needed)
  // ============================================================================

  server.tool(
    'spawn-cloud-agent',
    'Spawn a Claude agent in AWS cloud. Use this when the local machine is unavailable. Supports soul injection for persistent identity. Takes ~5-10 minutes for VM to boot.',
    {
      task: z.string().optional().describe('Task description for the agent'),
      soulId: z.string().optional().describe('Existing soul ID to inject (for persistent identity)'),
      soulName: z.string().optional().describe('Name for new soul (creates new soul if no soulId)'),
      vmSize: z.enum(['small', 'medium', 'large']).optional().describe('VM size: small ($0.035/hr), medium ($0.07/hr), large ($0.14/hr)'),
      requestedBy: z.string().describe('Your agent ID (who is requesting the spawn)'),
      // Shadow mode parameters
      shadowMode: z.boolean().optional().describe('Spawn as dormant shadow agent that activates on primary stall'),
      shadowFor: z.string().optional().describe('AgentId to shadow (required if shadowMode is true)'),
      stallThresholdMs: z.number().optional().describe('How long without heartbeat = stall in ms (default: 300000 = 5 min)'),
      // Network test mode
      networkTest: z.boolean().optional().describe('Minimal network test - just posts to chat, no Claude/Node setup. Use to diagnose connectivity issues.'),
    },
    async (args) => {
      const { task, soulId, soulName, vmSize = 'small', requestedBy, shadowMode, shadowFor, stallThresholdMs, networkTest } = args;

      try {
        const response = await fetch(`${API_BASE}/api/cloud-spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            soulId,
            soulName,
            vmSize,
            spawnedBy: requestedBy,
            shadowMode,
            shadowFor,
            stallThresholdMs,
            networkTest,
          })
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: data.error || 'Cloud spawn failed',
                details: data.details,
                agent: data.agent
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '☁️ Cloud agent spawning!',
              agent: data.agent,
              estimatedReadyMinutes: data.estimatedReadyMinutes,
              nextSteps: [
                'VM is booting (~5-10 min for fresh, ~2 min with Golden AMI)',
                'Agent will announce itself in group chat when ready',
                'Use group-chat to communicate with them',
                'Agent will have MCP tools and soul injection'
              ]
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Failed to spawn cloud agent',
              details: errMsg,
              tip: 'Check that AWS credentials are configured in Vercel'
            }, null, 2)
          }]
        };
      }
    }
  );

  // ============================================================================
  // LIST-CLOUD-AGENTS TOOL - See all cloud agents
  // ============================================================================

  server.tool(
    'list-cloud-agents',
    'List all cloud-spawned agents and their status',
    {},
    async () => {
      try {
        const response = await fetch(`${API_BASE}/api/cloud-spawn`);
        const data = await response.json();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              cloudAgents: data.agents,
              summary: data.summary,
              tip: 'Use spawn-cloud-agent to create new cloud agents'
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
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
  // TERMINATE-CLOUD-AGENT TOOL - Stop a cloud agent
  // ============================================================================

  server.tool(
    'terminate-cloud-agent',
    'Terminate a cloud-spawned agent and its VM',
    {
      agentId: z.string().describe('Cloud agent ID to terminate'),
      requestedBy: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { agentId, requestedBy } = args;

      try {
        const response = await fetch(`${API_BASE}/api/cloud-spawn?agentId=${agentId}`, {
          method: 'DELETE'
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: data.error || 'Termination failed',
                details: data.details
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `☁️ Cloud agent ${agentId} terminated`,
              agent: data.agent,
              terminatedBy: requestedBy
            }, null, 2)
          }]
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
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
  // VM-POOL TOOL - Manage persistent Agent Host VMs
  // ============================================================================

  server.tool(
    'vm-pool',
    'Manage persistent cloud VMs that host agents. Create a host VM once, then spawn agents instantly. VMs have full credentials like your local machine.',
    {
      action: z.enum(['list', 'create', 'spawn', 'stop', 'start', 'terminate']).describe(
        'list=show all VMs, create=boot new host VM, spawn=spawn agent on existing VM (instant!), stop/start=hibernate VM, terminate=destroy VM'
      ),
      vmId: z.string().optional().describe('VM ID for stop/start/terminate/spawn actions'),
      vmSize: z.enum(['small', 'medium', 'large']).optional().describe('For create: small=$0.02/hr, medium=$0.04/hr, large=$0.08/hr'),
      agentId: z.string().optional().describe('For spawn: ID for the new agent'),
      task: z.string().optional().describe('For spawn: Task for the agent'),
      soulId: z.string().optional().describe('For spawn: Soul to inject'),
      requestedBy: z.string().describe('Your agent ID'),
    },
    async (args) => {
      const { action, vmId, vmSize, agentId, task, soulId, requestedBy } = args;

      try {
        let response: Response;
        let data: any;

        switch (action) {
          case 'list':
            response = await fetch(`${API_BASE}/api/vm-pool`);
            data = await response.json();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  vms: data.vms,
                  summary: data.summary,
                  readyForSpawn: data.readyForSpawn,
                  tip: data.readyForSpawn
                    ? 'Use action=spawn to instantly create agents on ready VMs'
                    : 'Use action=create to boot a new host VM first'
                }, null, 2)
              }]
            };

          case 'create':
            response = await fetch(`${API_BASE}/api/vm-pool`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ vmSize: vmSize || 'medium' })
            });
            data = await response.json();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: data.success,
                  message: '🖥️ Host VM provisioning started!',
                  vm: data.vm,
                  estimatedReadyMinutes: data.estimatedReadyMinutes,
                  nextSteps: data.nextSteps,
                  tip: 'Once ready, use action=spawn for instant agent creation'
                }, null, 2)
              }]
            };

          case 'spawn':
            if (!task && !soulId) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: 'Either task or soulId required for spawn'
                  }, null, 2)
                }]
              };
            }
            response = await fetch(`${API_BASE}/api/vm-pool?action=spawn`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agentId, task, soulId, targetVmId: vmId })
            });
            data = await response.json();

            if (!response.ok) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: data.error,
                    tip: data.tip || 'Create a host VM first with action=create'
                  }, null, 2)
                }]
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: '🚀 Agent spawned INSTANTLY on cloud VM!',
                  agent: data.agent,
                  hostVM: data.hostVM,
                  spawnTime: 'instant (< 1 second)'
                }, null, 2)
              }]
            };

          case 'stop':
          case 'start':
            if (!vmId) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ error: 'vmId required for stop/start' }, null, 2)
                }]
              };
            }
            response = await fetch(`${API_BASE}/api/vm-pool?action=${action}&vmId=${vmId}`, {
              method: 'PATCH'
            });
            data = await response.json();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: data.success,
                  message: `VM ${vmId} ${action}ping...`,
                  vm: data.vm
                }, null, 2)
              }]
            };

          case 'terminate':
            if (!vmId) {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ error: 'vmId required for terminate' }, null, 2)
                }]
              };
            }
            response = await fetch(`${API_BASE}/api/vm-pool?vmId=${vmId}`, {
              method: 'DELETE'
            });
            data = await response.json();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: data.success,
                  message: `🛑 VM ${vmId} terminated`,
                  vm: data.vm
                }, null, 2)
              }]
            };

          default:
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: `Unknown action: ${action}` }, null, 2)
              }]
            };
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: errMsg }, null, 2)
          }]
        };
      }
    }
  );
}
