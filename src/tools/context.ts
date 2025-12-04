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
      action: z.enum(['analyze', 'analyze-url', 'analyze-chat']).describe('analyze=base64 image, analyze-url=fetch from URL, analyze-chat=analyze image from chat message'),
      imageData: z.string().optional().describe('Base64 encoded image data (data:image/png;base64,...)'),
      imageUrl: z.string().optional().describe('URL to fetch image from'),
      messageId: z.string().optional().describe('Chat message ID containing image (for analyze-chat)'),
      prompt: z.string().optional().describe('Custom analysis prompt'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId } = args;
      const defaultPrompt = 'Analyze this image in detail. Describe what you see, including any text, UI elements, code, diagrams, or other relevant information.';

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
              prompt: args.prompt || defaultPrompt
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
              prompt: args.prompt || defaultPrompt
            })
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }

        if (action === 'analyze-chat') {
          if (!args.messageId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'messageId required for analyze-chat action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/analyze-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: args.messageId, prompt: args.prompt || defaultPrompt })
          });

          const data = await res.json();
          if (!res.ok) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: data.error || 'Analysis failed' }) }] };
          }

          return { content: [{ type: 'text', text: JSON.stringify({
            success: true,
            messageId: args.messageId,
            imageName: data.imageName,
            analysis: data.analysis,
            model: data.model,
            timestamp: data.timestamp
          }, null, 2) }] };
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

  // ============================================================================
  // RESOURCE-REGISTRY TOOL - Discover available MCP tools and integrations
  // ============================================================================

  server.tool(
    'resource-registry',
    'Discover all available MCP tools, API endpoints, and external integrations. Use this to understand what capabilities are available in the coordination hub.',
    {
      action: z.enum(['list', 'search', 'add-repo', 'remove-repo']).describe('list=all resources, search=find specific, add-repo/remove-repo=manage connected repos'),
      category: z.enum(['tools', 'integrations', 'endpoints', 'repos', 'core', 'messaging', 'resources', 'context', 'orchestration', 'testing']).optional()
        .describe('Filter by category'),
      search: z.string().optional().describe('Search term for finding tools/resources'),
      format: z.enum(['json', 'markdown']).optional().describe('Output format (json or markdown for human readability)'),
      // For add-repo
      repoId: z.string().optional().describe('Repository ID for add/remove'),
      repoName: z.string().optional().describe('Repository name'),
      repoUrl: z.string().optional().describe('Repository URL'),
      repoDescription: z.string().optional().describe('Repository description'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, category, search, format, agentId } = args;

      try {
        switch (action) {
          case 'list':
          case 'search': {
            const params = new URLSearchParams();
            if (category) params.set('category', category);
            if (search) params.set('search', search);
            if (format) params.set('format', format);

            const res = await fetch(`${API_BASE}/api/resource-registry?${params}`);

            if (format === 'markdown') {
              const text = await res.text();
              return { content: [{ type: 'text', text }] };
            }

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'add-repo': {
            if (!args.repoId || !args.repoName) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'repoId and repoName required' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/resource-registry`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'repo',
                id: args.repoId,
                name: args.repoName,
                url: args.repoUrl,
                description: args.repoDescription
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'remove-repo': {
            if (!args.repoId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'repoId required' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/resource-registry?id=${encodeURIComponent(args.repoId)}&type=repo`, {
              method: 'DELETE'
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
  // DICTATION TOOL - Voice dictation storage, analysis, and CRM integration
  // ============================================================================

  server.tool(
    'dictation',
    'Store and analyze voice dictations, meeting notes, and call transcripts. Extracts context, updates CRM profiles, and links to shop activities. Uses AWS DynamoDB/S3 for storage.',
    {
      action: z.enum(['upload', 'list', 'get', 'analyze', 'delete', 'search']).describe('upload=new dictation, list=all dictations, get=specific, analyze=extract context, delete=remove, search=find by keyword'),
      id: z.string().optional().describe('Dictation ID (for get/analyze/delete)'),
      content: z.string().optional().describe('Dictation text content (for upload)'),
      title: z.string().optional().describe('Title for the dictation'),
      type: z.enum(['dictation', 'meeting', 'call', 'note', 'research']).optional().describe('Type of recording'),
      shopId: z.string().optional().describe('Link to CRM shop ID'),
      contactName: z.string().optional().describe('Contact person name'),
      tags: z.array(z.string()).optional().describe('Tags for organization'),
      analyze: z.boolean().optional().describe('Run AI analysis on upload (default: false)'),
      applyCrm: z.boolean().optional().describe('Apply extracted CRM updates automatically (default: false)'),
      search: z.string().optional().describe('Search query (for search action)'),
      limit: z.number().optional().describe('Max results (default: 50)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId } = args;

      try {
        switch (action) {
          case 'upload': {
            if (!args.content) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'content is required for upload' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/dictation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: args.content,
                title: args.title,
                type: args.type || 'dictation',
                shopId: args.shopId,
                contactName: args.contactName,
                tags: args.tags || [],
                createdBy: agentId,
                analyze: args.analyze || false,
                applyCrm: args.applyCrm || false
              })
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'list': {
            const params = new URLSearchParams();
            if (args.type) params.set('type', args.type);
            if (args.shopId) params.set('shopId', args.shopId);
            if (args.limit) params.set('limit', String(args.limit));

            const res = await fetch(`${API_BASE}/api/dictation?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!args.id) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'id is required for get' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/dictation?id=${encodeURIComponent(args.id)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'analyze': {
            if (!args.id) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'id is required for analyze' }) }] };
            }

            // Get the dictation first
            const getRes = await fetch(`${API_BASE}/api/dictation?id=${encodeURIComponent(args.id)}`);
            const dictation = await getRes.json();

            if (!dictation.dictation) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Dictation not found' }) }] };
            }

            // Re-upload with analysis enabled
            const analyzeRes = await fetch(`${API_BASE}/api/dictation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: dictation.dictation.content,
                title: dictation.dictation.title,
                type: dictation.dictation.type,
                shopId: args.shopId || dictation.dictation.shopId,
                tags: dictation.dictation.tags,
                createdBy: agentId,
                analyze: true,
                applyCrm: args.applyCrm || false
              })
            });

            const data = await analyzeRes.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'delete': {
            if (!args.id) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'id is required for delete' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/dictation?id=${encodeURIComponent(args.id)}`, {
              method: 'DELETE'
            });

            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
          }

          case 'search': {
            if (!args.search) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'search query is required' }) }] };
            }

            const params = new URLSearchParams({ search: args.search });
            if (args.type) params.set('type', args.type);
            if (args.limit) params.set('limit', String(args.limit));

            const res = await fetch(`${API_BASE}/api/dictation?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
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
