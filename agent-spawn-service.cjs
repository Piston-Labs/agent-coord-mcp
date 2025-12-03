/**
 * Agent Spawn Service - Local HTTP server for spawning Claude agents
 * 
 * Run with: node agent-spawn-service.js
 * 
 * Endpoints:
 *   POST /spawn - Spawn a new Claude agent
 *   GET /status - Check service status and spawned agents
 *   GET /agents - List all spawned agent processes
 *   POST /kill/:pid - Kill a specific agent process
 */

const http = require('http');
const { spawn, exec } = require('child_process');
const url = require('url');

const PORT = 3847; // Unique port for spawn service
const AGENT_DIR = 'C:\\Users\\tyler\\Desktop\\agent-coord-mcp';
const API_BASE = 'https://agent-coord-mcp.vercel.app';

// Track spawned agents
const spawnedAgents = new Map();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Spawn a new Claude agent
async function spawnAgent(agentId, task) {
  const id = agentId || `agent-${Date.now().toString(36)}`;
  
  log(`Spawning agent: ${id}${task ? ` with task: ${task}` : ''}`);
  
  // Use Start-Process to spawn in a new window
  const psCommand = `Start-Process cmd -ArgumentList '/k', 'cd /d ${AGENT_DIR} && claude --dangerously-skip-permissions --mcp-config mcp-config.json'`;
  
  return new Promise((resolve, reject) => {
    exec(`powershell -Command "${psCommand}"`, (error, stdout, stderr) => {
      if (error) {
        log(`Spawn error: ${error.message}`);
        reject(error);
        return;
      }
      
      const spawnInfo = {
        id,
        task: task || 'general',
        spawnedAt: new Date().toISOString(),
        status: 'running'
      };
      
      spawnedAgents.set(id, spawnInfo);
      
      // Register with the hub
      registerAgent(id, task);
      
      log(`Agent ${id} spawned successfully`);
      resolve(spawnInfo);
    });
  });
}

// Register spawned agent with the coordination hub
async function registerAgent(agentId, task) {
  try {
    const response = await fetch(`${API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: agentId,
        name: `Spawned: ${agentId}`,
        status: 'active',
        currentTask: task || 'Awaiting instructions',
        role: 'agent'
      })
    });
    
    if (!response.ok) {
      log(`Failed to register agent ${agentId}: ${response.status}`);
    }
  } catch (err) {
    log(`Registration error for ${agentId}: ${err.message}`);
  }
}

// Notify chat about spawn
async function notifySpawn(spawnerId, newAgentId, task) {
  try {
    await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: '🤖 spawn-service',
        authorType: 'system',
        message: `[agent-spawned] 🚀 **${newAgentId}** spawned by ${spawnerId}${task ? ` - task: ${task}` : ''}`
      })
    });
  } catch (err) {
    log(`Chat notification error: ${err.message}`);
  }
}

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  try {
    // POST /spawn - Spawn a new agent
    if (path === '/spawn' && req.method === 'POST') {
      const body = await parseBody(req);
      const { agentId, task, requestedBy } = body;
      
      const result = await spawnAgent(agentId, task);
      
      // Notify chat
      if (requestedBy) {
        await notifySpawn(requestedBy, result.id, task);
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agent: result,
        message: `Agent ${result.id} spawned. New terminal window opened.`
      }));
      return;
    }
    
    // GET /status - Service status
    if (path === '/status' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        service: 'agent-spawn-service',
        status: 'running',
        port: PORT,
        uptime: process.uptime(),
        spawnedCount: spawnedAgents.size,
        agents: Array.from(spawnedAgents.values())
      }));
      return;
    }
    
    // GET /agents - List spawned agents
    if (path === '/agents' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        agents: Array.from(spawnedAgents.values()),
        count: spawnedAgents.size
      }));
      return;
    }
    
    // POST /spawn-batch - Spawn multiple agents
    if (path === '/spawn-batch' && req.method === 'POST') {
      const body = await parseBody(req);
      const { count = 1, prefix = 'batch-agent', requestedBy } = body;
      
      const results = [];
      for (let i = 0; i < Math.min(count, 10); i++) {  // Max 10 at once
        const id = `${prefix}-${i + 1}`;
        try {
          const result = await spawnAgent(id);
          results.push(result);
          // Small delay between spawns
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          results.push({ id, error: err.message });
        }
      }
      
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        spawned: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length,
        agents: results
      }));
      return;
    }
    
    // 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    
  } catch (err) {
    log(`Error: ${err.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  log(`🚀 Agent Spawn Service running on http://localhost:${PORT}`);
  log(`Endpoints:`);
  log(`  POST /spawn        - Spawn a new agent { agentId?, task?, requestedBy? }`);
  log(`  POST /spawn-batch  - Spawn multiple agents { count, prefix?, requestedBy? }`);
  log(`  GET  /status       - Service status`);
  log(`  GET  /agents       - List spawned agents`);
});
