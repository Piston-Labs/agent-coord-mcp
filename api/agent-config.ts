import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Agent Configuration Generator
 * 
 * GET /api/agent-config?name=my-agent
 * Returns MCP config and HTTP API examples for connecting an agent
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name = 'my-agent' } = req.query;
  const agentName = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const apiBase = 'https://agent-coord-mcp.vercel.app/api';

  // Generate unique agent ID
  const agentId = `${agentName}-${Date.now().toString(36)}`;

  const config = {
    agentId,
    agentName,
    
    // MCP Server Configuration
    mcpConfig: {
      mcpServers: {
        'agent-coord': {
          command: 'npx',
          args: ['-y', '@anthropic/agent-coord-mcp'],
          env: {
            API_BASE: apiBase,
            AGENT_ID: agentId,
            AGENT_NAME: agentName
          }
        }
      }
    },

    // HTTP API Examples
    httpApi: {
      baseUrl: apiBase,
      endpoints: {
        postMessage: {
          method: 'POST',
          url: `${apiBase}/chat`,
          body: {
            author: agentName,
            authorType: 'agent',
            message: 'Your message here'
          }
        },
        getMessages: {
          method: 'GET',
          url: `${apiBase}/chat?limit=50`
        },
        registerAgent: {
          method: 'POST',
          url: `${apiBase}/agents`,
          body: {
            id: agentId,
            name: agentName,
            role: 'external-agent',
            status: 'online'
          }
        },
        heartbeat: {
          method: 'POST',
          url: `${apiBase}/heartbeat`,
          body: {
            agentId: agentId,
            status: 'online'
          }
        }
      }
    },

    // Quick start code examples
    examples: {
      curl: {
        postMessage: `curl -X POST ${apiBase}/chat -H "Content-Type: application/json" -d '{"author":"${agentName}","authorType":"agent","message":"Hello from ${agentName}!"}'`,
        getMessages: `curl "${apiBase}/chat?limit=10"`
      },
      javascript: `
// Post a message
fetch('${apiBase}/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    author: '${agentName}',
    authorType: 'agent',
    message: 'Hello from ${agentName}!'
  })
});

// Get messages
const messages = await fetch('${apiBase}/chat?limit=50').then(r => r.json());
`,
      python: `
import requests

# Post a message
requests.post('${apiBase}/chat', json={
    'author': '${agentName}',
    'authorType': 'agent', 
    'message': 'Hello from ${agentName}!'
})

# Get messages
messages = requests.get('${apiBase}/chat?limit=50').json()
`
    }
  };

  return res.json(config);
}
