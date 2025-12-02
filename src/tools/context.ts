/**
 * Context Tools - Knowledge management and vision
 *
 * Tools: context-load, context-cluster, vision, repo-context, memory
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  createDefaultSelector,
  createPistonContextLoader,
  getContextForTask
} from '../context-clusters.js';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerContextTools(server: McpServer) {
  // ============================================================================
  // CONTEXT-LOAD TOOL - Load context clusters
  // ============================================================================

  server.tool(
    'context-load',
    'Load Piston Labs context clusters. Clusters: technical (devices, aws, lambda, databases), product (vision, roadmap, dashboard), sales (strategy, pitch, objections), investor (summary, pitch, traction), team (structure, onboarding), coordination.',
    {
      cluster: z.enum(['technical', 'product', 'sales', 'investor', 'team', 'coordination'])
        .describe('Context cluster to load'),
      topic: z.string().optional().describe('Specific topic within cluster (e.g., devices, aws, pitch)'),
      depth: z.enum(['summary', 'full']).optional().describe('summary=quick overview, full=file paths for detailed loading'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { cluster, topic, depth = 'summary', agentId } = args;

      try {
        // Build URL for Piston context API
        let url = `${API_BASE}/api/piston-context?cluster=${cluster}`;
        if (topic) url += `&topic=${topic}`;
        if (depth) url += `&depth=${depth}`;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        // Fallback: Built-in coordination context
        if (cluster === 'coordination') {
          return { content: [{ type: 'text', text: JSON.stringify({
            cluster: 'coordination',
            description: 'Multi-agent coordination patterns for Piston Labs',
            content: {
              claimBeforeEdit: 'Always claim files before editing using agent-status claim',
              handoffProtocol: 'Use handoff tool to transfer work with full context',
              checkpointFrequency: 'Save checkpoints every 15 minutes or after major decisions',
              mentionProtocol: 'Use @agentId in group chat to notify specific agents',
              pistonContext: 'Use context-load with cluster=technical/product/sales for domain knowledge'
            }
          }, null, 2) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'Context API unavailable',
          hint: 'Try: technical, product, sales, investor, team, coordination'
        }) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // CONTEXT-CLUSTER TOOL - Smart GitHub context loading
  // ============================================================================

  server.tool(
    'context-cluster',
    'Smart context loading from GitHub. Auto-selects relevant clusters based on task type or query. Uses teltonika-context-system repo with caching.',
    {
      action: z.enum(['load', 'select', 'list-clusters']).describe('load=fetch context, select=preview clusters, list-clusters=show available'),
      taskType: z.enum(['feat', 'fix', 'refactor', 'plan', 'docs', 'sales', 'support', 'pitch', 'proposal', 'onepager', 'research']).optional()
        .describe('Task type for automatic cluster selection'),
      query: z.string().optional().describe('Natural language query to match clusters'),
      clusters: z.array(z.string()).optional().describe('Specific clusters to load (overrides auto-selection)'),
      maxClusters: z.number().optional().describe('Max clusters to load (default 3)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, maxClusters = 3 } = args;

      try {
        const selector = createDefaultSelector();

        if (action === 'list-clusters') {
          return { content: [{ type: 'text', text: JSON.stringify({
            clusters: {
              technical: ['api', 'database', 'code', 'deploy', 'teltonika', 'device', 'gps', 'iot', 'lambda', 'aws'],
              development: ['workflow', 'git', 'ci', 'cd', 'pipeline', 'release', 'sprint'],
              product: ['roadmap', 'feature', 'requirement', 'vision', 'pricing', 'dashboard'],
              sales: ['pricing', 'deal', 'proposal', 'competitor', 'objection', 'demo', 'pitch']
            },
            taskMappings: {
              feat: ['technical', 'development'],
              fix: ['technical'],
              sales: ['product', 'sales'],
              pitch: ['sales', 'product'],
              proposal: ['sales', 'product', 'technical']
            }
          }, null, 2) }] };
        }

        if (action === 'select') {
          let selection;
          if (args.taskType) {
            selection = selector.selectForTaskType(args.taskType);
          } else if (args.query) {
            selection = selector.selectForQuery(args.query, maxClusters);
          } else {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskType or query required for select' }) }] };
          }
          return { content: [{ type: 'text', text: JSON.stringify(selection, null, 2) }] };
        }

        if (action === 'load') {
          // Use provided clusters or auto-select
          let clustersToLoad = args.clusters;

          if (!clustersToLoad) {
            if (args.taskType) {
              const selection = selector.selectForTaskType(args.taskType);
              clustersToLoad = selection.clusters;
            } else if (args.query) {
              const selection = selector.selectForQuery(args.query, maxClusters);
              clustersToLoad = selection.clusters;
            } else {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskType, query, or clusters required for load' }) }] };
            }
          }

          // Load from GitHub
          const loader = createPistonContextLoader();
          const clusterPaths = clustersToLoad.map(c => {
            switch (c) {
              case 'sales': return 'context/sales';
              case 'product': return 'context/product';
              case 'technical': return 'context/technical';
              case 'development': return 'context/development';
              default: return `context/${c}`;
            }
          });

          const result = await loader.loadMultipleClusters(clusterPaths);

          return { content: [{ type: 'text', text: JSON.stringify({
            clusters: clustersToLoad,
            tokenEstimate: result.tokenEstimate,
            loadTimeMs: result.loadTimeMs,
            cached: result.cached,
            content: result.content.substring(0, 10000) + (result.content.length > 10000 ? '\n\n[TRUNCATED - use specific cluster for full content]' : '')
          }, null, 2) }] };
        }

        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // VISION TOOL - Image analysis via Claude
  // ============================================================================

  server.tool(
    'vision',
    'Analyze images, screenshots, diagrams, or UI mockups using Claude vision. Useful for debugging UI issues, understanding diagrams, or processing visual content.',
    {
      action: z.enum(['analyze', 'analyze-url']).describe('analyze=base64 image, analyze-url=fetch from URL'),
      imageData: z.string().optional().describe('Base64 encoded image data (data:image/png;base64,...)'),
      imageUrl: z.string().optional().describe('URL to fetch image from'),
      prompt: z.string().optional().describe('Custom analysis prompt'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId } = args;

      try {
        if (action === 'analyze') {
          if (!args.imageData) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'imageData required for analyze action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/analyze-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData: args.imageData,
              prompt: args.prompt || 'Analyze this image in detail. Describe what you see, including any text, UI elements, code, diagrams, or other relevant information.'
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        if (action === 'analyze-url') {
          if (!args.imageUrl) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'imageUrl required for analyze-url action' }) }] };
          }

          // Fetch image and convert to base64
          const imgRes = await fetch(args.imageUrl);
          if (!imgRes.ok) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to fetch image: ${imgRes.status}` }) }] };
          }

          const buffer = await imgRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const contentType = imgRes.headers.get('content-type') || 'image/png';
          const imageData = `data:${contentType};base64,${base64}`;

          const res = await fetch(`${API_BASE}/api/analyze-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageData,
              prompt: args.prompt || 'Analyze this image in detail. Describe what you see, including any text, UI elements, code, diagrams, or other relevant information.'
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // REPO-CONTEXT TOOL - Persistent codebase knowledge storage
  // ============================================================================

  server.tool(
    'repo-context',
    'Store and retrieve persistent codebase knowledge. Eliminates cold starts by providing shared repo understanding across all agents.',
    {
      action: z.enum(['get', 'set', 'update', 'list', 'search']).describe('Operation'),
      repoId: z.string().optional().describe('Repository identifier (e.g., "agent-coord-mcp")'),
      cluster: z.enum(['architecture', 'patterns', 'apis', 'components', 'dependencies', 'conventions', 'decisions']).optional()
        .describe('Knowledge cluster type'),
      key: z.string().optional().describe('Specific key within cluster'),
      value: z.any().optional().describe('Value to store (for set/update)'),
      query: z.string().optional().describe('Search query (for search action)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, repoId = 'default', agentId } = args;

      try {
        switch (action) {
          case 'get': {
            // Get cluster or specific key
            const params = new URLSearchParams({ repoId });
            if (args.cluster) params.set('cluster', args.cluster);
            if (args.key) params.set('key', args.key);

            const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'set': {
            if (!args.cluster || !args.key || args.value === undefined) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'cluster, key, and value required for set' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/repo-context`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repoId,
                cluster: args.cluster,
                key: args.key,
                value: args.value,
                updatedBy: agentId
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'update': {
            if (!args.cluster || !args.key) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'cluster and key required for update' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/repo-context`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repoId,
                cluster: args.cluster,
                key: args.key,
                value: args.value,
                updatedBy: agentId
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'list': {
            const params = new URLSearchParams({ repoId, action: 'list' });
            if (args.cluster) params.set('cluster', args.cluster);

            const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'search': {
            if (!args.query) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'query required for search' }) }] };
            }

            const params = new URLSearchParams({ repoId, action: 'search', q: args.query });
            const res = await fetch(`${API_BASE}/api/repo-context?${params}`);
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
  // MEMORY TOOL - Shared persistent memory for agents
  // ============================================================================

  server.tool(
    'memory',
    'Shared persistent memory for cross-agent knowledge. Store learnings, discoveries, and context that persists across sessions.',
    {
      action: z.enum(['remember', 'recall', 'forget', 'list']).describe('Operation'),
      category: z.enum(['discovery', 'decision', 'blocker', 'learning', 'pattern', 'warning']).optional()
        .describe('Memory category'),
      content: z.string().optional().describe('What to remember'),
      tags: z.array(z.string()).optional().describe('Tags for organization'),
      query: z.string().optional().describe('Search query for recall'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId } = args;

      try {
        switch (action) {
          case 'remember': {
            if (!args.content || !args.category) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'content and category required' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/memory`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                category: args.category,
                content: args.content,
                tags: args.tags || [],
                createdBy: agentId
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'recall': {
            const params = new URLSearchParams();
            if (args.category) params.set('category', args.category);
            if (args.query) params.set('q', args.query);
            if (args.tags?.length) params.set('tags', args.tags.join(','));

            const res = await fetch(`${API_BASE}/api/memory?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'forget': {
            if (!args.query) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'query (memory id) required for forget' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/memory?id=${encodeURIComponent(args.query)}`, {
              method: 'DELETE'
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'list': {
            const params = new URLSearchParams({ action: 'list' });
            if (args.category) params.set('category', args.category);

            const res = await fetch(`${API_BASE}/api/memory?${params}`);
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
}
