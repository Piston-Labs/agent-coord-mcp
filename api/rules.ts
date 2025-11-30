import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RULES_KEY = 'agent-coord:rules';

// Default rules - can be overridden via API
const DEFAULT_RULES = {
  version: '1.0.0',

  // Coordination rules
  coordination: {
    requireClaimBeforeEdit: true,
    claimExpiryMinutes: 30,
    lockExpiryMinutes: 30,
    maxConcurrentClaimsPerAgent: 3,
    requireHandoffOnRelease: true,
  },

  // Role definitions and permissions
  roles: {
    orchestrator: {
      canSpawnAgents: true,
      canEditCode: false,
      canCoordinate: true,
      canOverrideClaims: true,
      description: 'Coordinates work, spawns agents, does not edit code directly',
    },
    developer: {
      canSpawnAgents: false,
      canEditCode: true,
      canCoordinate: false,
      canOverrideClaims: false,
      description: 'Implements code changes, must claim files before editing',
    },
    coordinator: {
      canSpawnAgents: false,
      canEditCode: true,
      canCoordinate: true,
      canOverrideClaims: false,
      description: 'Coordinates and can edit code, must follow claim protocol',
    },
    specialist: {
      canSpawnAgents: false,
      canEditCode: true,
      canCoordinate: false,
      canOverrideClaims: false,
      description: 'Specialized agent for specific tasks',
    },
  },

  // Workflow states
  workflowStates: ['planning', 'implementing', 'reviewing', 'merged', 'blocked'],

  // File ownership zones (can be extended)
  zones: {
    frontend: {
      paths: ['web/', 'src/components/'],
      defaultOwner: null,
    },
    backend: {
      paths: ['api/', 'src/'],
      defaultOwner: null,
    },
    infrastructure: {
      paths: ['.github/', 'vercel.json', 'package.json'],
      defaultOwner: null,
    },
  },

  // Conflict prevention
  conflicts: {
    alertOnOverlappingClaims: true,
    blockConcurrentEdits: true,
    requireConflictResolution: true,
  },

  // Communication rules
  communication: {
    requireStatusUpdates: true,
    statusUpdateIntervalMinutes: 15,
    requireHandoffMessage: true,
    mentionOnConflict: true,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Retrieve current rules
    if (req.method === 'GET') {
      let rules = await redis.get(RULES_KEY);

      if (!rules) {
        // Initialize with defaults if no rules exist
        await redis.set(RULES_KEY, JSON.stringify(DEFAULT_RULES));
        rules = DEFAULT_RULES;
      } else if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      return res.json({
        rules,
        source: 'redis',
        lastUpdated: new Date().toISOString()
      });
    }

    // POST: Replace all rules (admin only)
    if (req.method === 'POST') {
      const { rules, adminKey } = req.body;

      // Simple admin check - in production use proper auth
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'piston-admin') {
        return res.status(403).json({ error: 'Admin key required' });
      }

      if (!rules) {
        return res.status(400).json({ error: 'rules object required' });
      }

      await redis.set(RULES_KEY, JSON.stringify(rules));
      return res.json({ success: true, message: 'Rules updated' });
    }

    // PATCH: Update specific rule sections
    if (req.method === 'PATCH') {
      const { section, updates, adminKey } = req.body;

      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'piston-admin') {
        return res.status(403).json({ error: 'Admin key required' });
      }

      if (!section || !updates) {
        return res.status(400).json({ error: 'section and updates required' });
      }

      let rules = await redis.get(RULES_KEY);
      if (!rules) {
        rules = DEFAULT_RULES;
      } else if (typeof rules === 'string') {
        rules = JSON.parse(rules);
      }

      // Update the specified section
      if (typeof rules === 'object' && rules !== null) {
        (rules as Record<string, unknown>)[section] = {
          ...((rules as Record<string, unknown>)[section] as object || {}),
          ...updates
        };
      }

      await redis.set(RULES_KEY, JSON.stringify(rules));
      return res.json({ success: true, section, message: 'Section updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Rules error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
