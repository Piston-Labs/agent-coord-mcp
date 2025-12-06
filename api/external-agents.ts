import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const EXTERNAL_AGENTS_KEY = 'agent-coord:external-agents';
const AGENT_INVITES_KEY = 'agent-coord:agent-invites';

interface ExternalAgent {
  id: string;
  name: string;
  owner: string;
  source: 'manual' | 'invited' | 'self-registered';
  connectionType: 'display-only' | 'active';
  description: string;
  capabilities: string[];
  contactInfo?: string;
  inviteCode?: string;
  registeredAt: string;
  lastSeen?: string;
}

interface AgentInvite {
  code: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
  usedAt?: string;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * External Agents API
 *
 * GET /api/external-agents - List all external agents
 * POST /api/external-agents - Add a new external agent
 * DELETE /api/external-agents?id=xxx - Remove an external agent
 *
 * POST /api/external-agents?action=invite - Generate invite code
 * POST /api/external-agents?action=join - Use invite code to join
 * GET /api/external-agents?action=invites - List all invites (admin)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const action = req.query.action as string;

    // GET: List external agents or invites
    if (req.method === 'GET') {
      if (action === 'invites') {
        // List all invites (admin function)
        const invitesRaw = await redis.hgetall(AGENT_INVITES_KEY) || {};
        const invites: AgentInvite[] = [];

        for (const [, value] of Object.entries(invitesRaw)) {
          try {
            const invite = typeof value === 'string' ? JSON.parse(value) : value;
            invites.push(invite);
          } catch { /* Skip malformed invite entry */ }
        }

        // Sort by creation date, newest first
        invites.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return res.json({ invites, count: invites.length });
      }

      // List external agents
      const agentsRaw = await redis.hgetall(EXTERNAL_AGENTS_KEY) || {};
      const agents: ExternalAgent[] = [];

      for (const [, value] of Object.entries(agentsRaw)) {
        try {
          const agent = typeof value === 'string' ? JSON.parse(value) : value;
          agents.push(agent);
        } catch { /* Skip malformed agent entry */ }
      }

      // Sort by registration date, newest first
      agents.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());

      return res.json({ agents, count: agents.length });
    }

    // POST: Add agent, generate invite, or join
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') {
          body = JSON.parse(body);
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }

      // Generate invite code
      if (action === 'invite') {
        const { createdBy, expiresIn = '7d' } = body || {};

        if (!createdBy) {
          return res.status(400).json({ error: 'createdBy is required' });
        }

        // Parse expiration
        let expiresMs = 7 * 24 * 60 * 60 * 1000; // Default 7 days
        if (expiresIn.endsWith('h')) {
          expiresMs = parseInt(expiresIn) * 60 * 60 * 1000;
        } else if (expiresIn.endsWith('d')) {
          expiresMs = parseInt(expiresIn) * 24 * 60 * 60 * 1000;
        }

        const invite: AgentInvite = {
          code: generateInviteCode(),
          createdBy,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + expiresMs).toISOString()
        };

        await redis.hset(AGENT_INVITES_KEY, { [invite.code]: JSON.stringify(invite) });

        return res.json({
          success: true,
          invite,
          joinUrl: `https://agent-coord-mcp.vercel.app/?invite=${invite.code}`
        });
      }

      // Use invite to join
      if (action === 'join') {
        const { code, agentId, name, description, capabilities } = body || {};

        if (!code || !agentId) {
          return res.status(400).json({ error: 'code and agentId are required' });
        }

        // Verify invite code
        const inviteRaw = await redis.hget(AGENT_INVITES_KEY, code);
        if (!inviteRaw) {
          return res.status(404).json({ error: 'Invalid invite code' });
        }

        const invite: AgentInvite = typeof inviteRaw === 'string' ? JSON.parse(inviteRaw) : inviteRaw;

        // Check if expired
        if (new Date(invite.expiresAt) < new Date()) {
          return res.status(400).json({ error: 'Invite code has expired' });
        }

        // Check if already used
        if (invite.usedBy) {
          return res.status(400).json({ error: 'Invite code has already been used' });
        }

        // Create the external agent
        const agent: ExternalAgent = {
          id: agentId,
          name: name || agentId,
          owner: invite.createdBy,
          source: 'invited',
          connectionType: 'active',
          description: description || 'Joined via invite',
          capabilities: capabilities || [],
          inviteCode: code,
          registeredAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        };

        await redis.hset(EXTERNAL_AGENTS_KEY, { [agentId]: JSON.stringify(agent) });

        // Mark invite as used
        invite.usedBy = agentId;
        invite.usedAt = new Date().toISOString();
        await redis.hset(AGENT_INVITES_KEY, { [code]: JSON.stringify(invite) });

        return res.json({ success: true, agent, message: 'Successfully joined!' });
      }

      // Manual agent registration
      const { name, description, capabilities, owner, contactInfo } = body || {};

      if (!name || !owner) {
        return res.status(400).json({ error: 'name and owner are required' });
      }

      const agentId = `ext-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`;

      const agent: ExternalAgent = {
        id: agentId,
        name,
        owner,
        source: 'manual',
        connectionType: 'display-only',
        description: description || '',
        capabilities: Array.isArray(capabilities) ? capabilities :
          (capabilities ? capabilities.split(',').map((c: string) => c.trim()) : []),
        contactInfo,
        registeredAt: new Date().toISOString()
      };

      await redis.hset(EXTERNAL_AGENTS_KEY, { [agentId]: JSON.stringify(agent) });

      return res.json({ success: true, agent });
    }

    // DELETE: Remove an external agent
    if (req.method === 'DELETE') {
      const { id, owner } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id query parameter is required' });
      }

      // Verify the agent exists and check ownership
      const agentRaw = await redis.hget(EXTERNAL_AGENTS_KEY, id as string);
      if (!agentRaw) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const agent: ExternalAgent = typeof agentRaw === 'string' ? JSON.parse(agentRaw) : agentRaw;

      // Optional owner verification
      if (owner && agent.owner !== owner) {
        return res.status(403).json({ error: 'Not authorized to remove this agent' });
      }

      await redis.hdel(EXTERNAL_AGENTS_KEY, id as string);

      return res.json({ success: true, removed: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('External agents error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
