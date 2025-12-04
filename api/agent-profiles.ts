import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const PROFILES_KEY = 'agent-coord:profiles';

/**
 * Agent Profile - Capability registration and matching
 * Inspired by contextOS profile/intent system
 */
interface AgentProfile {
  agentId: string;
  offers: string[];      // What this agent can help with
  needs: string[];       // What this agent needs help with
  capabilities: string[]; // Technical capabilities (canSearch, canBrowse, canRunCode, etc.)
  mcpTools?: string[];   // List of MCP tools this agent has access to
  isCloudAgent?: boolean; // True if this is a VM/cloud-spawned agent
  metadata: {
    ide?: string;
    os?: string;
    mcpServers?: string[];
    toolsVersion?: string; // Version identifier for tool updates
    lastUpdated: string;
  };
}

/**
 * Agent Profiles API - Capability matching for agent discovery
 *
 * GET /api/agent-profiles - List all profiles
 * GET /api/agent-profiles?agentId=X - Get specific profile
 * GET /api/agent-profiles?findMatch=true&lookingFor=X,Y - Find agents who offer X,Y
 * POST /api/agent-profiles - Register/update profile
 * DELETE /api/agent-profiles?agentId=X - Remove profile
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List profiles or find matches
    if (req.method === 'GET') {
      const { agentId, findMatch, lookingFor, capability } = req.query;

      // Get specific profile
      if (agentId) {
        const profile = await redis.hget(PROFILES_KEY, agentId as string);
        if (!profile) {
          return res.status(404).json({ error: 'Profile not found' });
        }
        return res.json({ profile: typeof profile === 'string' ? JSON.parse(profile) : profile });
      }

      // Get all profiles
      const allProfiles = await redis.hgetall(PROFILES_KEY) || {};
      let profiles: AgentProfile[] = Object.values(allProfiles).map(
        p => typeof p === 'string' ? JSON.parse(p) : p
      );

      // Find matching agents
      if (findMatch === 'true' && lookingFor) {
        const needs = (lookingFor as string).split(',').map(s => s.trim().toLowerCase());

        const matches = profiles
          .map(profile => {
            // Score based on how many needs this agent can fulfill
            const matchedOffers = profile.offers.filter(offer =>
              needs.some(need =>
                offer.toLowerCase().includes(need) || need.includes(offer.toLowerCase())
              )
            );
            return {
              agentId: profile.agentId,
              matchedOffers,
              matchScore: matchedOffers.length / needs.length,
              allOffers: profile.offers,
              capabilities: profile.capabilities
            };
          })
          .filter(m => m.matchScore > 0)
          .sort((a, b) => b.matchScore - a.matchScore);

        return res.json({
          query: needs,
          matches,
          totalAgents: profiles.length
        });
      }

      // Filter by capability
      if (capability) {
        profiles = profiles.filter(p =>
          p.capabilities.some(c => c.toLowerCase() === (capability as string).toLowerCase())
        );
      }

      return res.json({
        profiles,
        count: profiles.length
      });
    }

    // POST - Register or update profile
    if (req.method === 'POST') {
      const { agentId, offers, needs, capabilities, ide, os, mcpServers, mcpTools, isCloudAgent, toolsVersion } = req.body;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      // Get existing profile or create new
      const existingRaw = await redis.hget(PROFILES_KEY, agentId);
      const existing: AgentProfile | null = existingRaw
        ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw)
        : null;

      const profile: AgentProfile = {
        agentId,
        offers: offers || existing?.offers || [],
        needs: needs || existing?.needs || [],
        capabilities: capabilities || existing?.capabilities || [],
        mcpTools: mcpTools || existing?.mcpTools || [],
        isCloudAgent: isCloudAgent ?? existing?.isCloudAgent ?? false,
        metadata: {
          ide: ide || existing?.metadata?.ide,
          os: os || existing?.metadata?.os,
          mcpServers: mcpServers || existing?.metadata?.mcpServers,
          toolsVersion: toolsVersion || existing?.metadata?.toolsVersion,
          lastUpdated: new Date().toISOString()
        }
      };

      await redis.hset(PROFILES_KEY, { [agentId]: JSON.stringify(profile) });

      return res.json({
        success: true,
        profile,
        message: existing ? 'Profile updated' : 'Profile registered'
      });
    }

    // DELETE - Remove profile
    if (req.method === 'DELETE') {
      const { agentId } = req.query;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      await redis.hdel(PROFILES_KEY, agentId as string);

      return res.json({ success: true, deleted: agentId });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Agent profiles API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
