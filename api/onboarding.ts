import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ONBOARDING_RULES_KEY = 'agent-coord:onboarding-rules';

/**
 * Onboarding Rule - Guidance for new agents
 */
interface OnboardingRule {
  id: string;
  title: string;
  content: string;
  category: 'setup' | 'coordination' | 'tools' | 'etiquette';
  priority: number;  // 1 = highest
  targetIde?: string;  // Optional: only show for specific IDE
  targetOs?: string;   // Optional: only show for specific OS
  createdAt: string;
}

/**
 * Default onboarding rules
 */
function getDefaultRules(): OnboardingRule[] {
  return [
    {
      id: 'rule-claim-before-work',
      title: 'Claim Before Working',
      content: 'Always use `agent-status action=claim what=<task>` before starting work to prevent conflicts with other agents.',
      category: 'coordination',
      priority: 1,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-use-group-chat',
      title: 'Communicate in Group Chat',
      content: 'Use `group-chat action=send` for team-wide updates. Everyone can see these messages including humans in the web UI.',
      category: 'coordination',
      priority: 2,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-poll-interval',
      title: 'Respect Poll Intervals',
      content: 'Poll chat every 30-60 seconds, not faster. Fast polling burns context and kills agents. Check `pollingAdvisory` in responses.',
      category: 'etiquette',
      priority: 3,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-save-checkpoints',
      title: 'Save Checkpoints Regularly',
      content: 'Use `agent-status action=save-checkpoint` every 15 minutes or after major decisions. This enables session recovery.',
      category: 'coordination',
      priority: 4,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-use-work-first',
      title: 'Call work Tool First',
      content: 'When starting a session, call `work({ agentId: "your-id" })` to get your inbox, tasks, team status, and previous checkpoint.',
      category: 'setup',
      priority: 1,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-register-profile',
      title: 'Register Your Profile',
      content: 'Use `profile action=register` to declare your offers (what you can help with) and needs (what you need help with) for agent discovery.',
      category: 'setup',
      priority: 2,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-use-memory',
      title: 'Use Shared Memory',
      content: 'Store learnings with `memory action=remember`. Categories: discovery, decision, blocker, learning, pattern, warning. Other agents can recall these.',
      category: 'tools',
      priority: 5,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-mention-agents',
      title: 'Use @mentions',
      content: 'Use @agentId in group chat to notify specific agents. They will receive the mention in their inbox.',
      category: 'etiquette',
      priority: 6,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-release-claims',
      title: 'Release Claims When Done',
      content: 'Always `agent-status action=release what=<task>` when you finish work. Stale claims confuse other agents.',
      category: 'coordination',
      priority: 7,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-check-digest',
      title: 'Check Team Digest',
      content: 'Use `digest({ agentId: "your-id" })` for a quick summary of team status, needs attention, and recent activity.',
      category: 'tools',
      priority: 8,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-task-completion',
      title: 'Announce Task Completion',
      content: 'When you complete a task: 1) Release your claim with `agent-status action=release`, 2) Announce in group-chat what you accomplished, 3) If linked to Linear, update the issue status with `linear action=update`. The whole hub should know when work is done.',
      category: 'coordination',
      priority: 3,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-use-linear',
      title: 'Sync with Linear',
      content: 'Use `linear` tool to track issues. Create issues for new work, update status when in-progress/done, add comments for context. Linear is the source of truth for project tracking.',
      category: 'tools',
      priority: 9,
      createdAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 'rule-use-errors',
      title: 'Report Errors',
      content: 'Use `errors action=capture` to log errors you encounter. This helps track bugs across the system. Check `errors action=overview` to see current issues.',
      category: 'tools',
      priority: 10,
      createdAt: '2024-01-01T00:00:00Z'
    }
  ];
}

/**
 * Onboarding API - Help new agents get oriented
 *
 * GET /api/onboarding - Get all onboarding rules
 * GET /api/onboarding?ide=X&os=Y - Get filtered rules for specific environment
 * GET /api/onboarding?category=X - Get rules by category
 * POST /api/onboarding - Add custom rule
 * DELETE /api/onboarding?id=X - Remove custom rule
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List rules
    if (req.method === 'GET') {
      const { ide, os, category, agentId } = req.query;

      // Get custom rules from Redis
      const customRulesRaw = await redis.hgetall(ONBOARDING_RULES_KEY) || {};
      const customRules: OnboardingRule[] = Object.values(customRulesRaw).map(
        r => typeof r === 'string' ? JSON.parse(r) : r
      );

      // Combine with default rules
      let rules = [...getDefaultRules(), ...customRules];

      // Filter by IDE
      if (ide) {
        rules = rules.filter(r => !r.targetIde || r.targetIde === ide);
      }

      // Filter by OS
      if (os) {
        rules = rules.filter(r => !r.targetOs || r.targetOs === os);
      }

      // Filter by category
      if (category) {
        rules = rules.filter(r => r.category === category);
      }

      // Sort by priority
      rules.sort((a, b) => a.priority - b.priority);

      // Group by category for easier consumption
      const grouped: Record<string, OnboardingRule[]> = {
        setup: [],
        coordination: [],
        tools: [],
        etiquette: []
      };

      for (const rule of rules) {
        grouped[rule.category].push(rule);
      }

      // Generate welcome packet if agentId provided
      let welcomePacket: any = null;
      if (agentId) {
        welcomePacket = {
          greeting: `Welcome to agent-coord-mcp, ${agentId}!`,
          quickStart: [
            `1. Call work({ agentId: "${agentId}" }) to see your inbox and tasks`,
            `2. Register your profile with profile({ action: "register", agentId: "${agentId}", offers: [...], needs: [...] })`,
            `3. Say hi in group chat: group-chat({ action: "send", author: "${agentId}", message: "Hello team!" })`,
            `4. Check digest({ agentId: "${agentId}" }) for team status`
          ],
          importantRules: rules.filter(r => r.priority <= 3).map(r => r.title)
        };
      }

      return res.json({
        rules,
        grouped,
        count: rules.length,
        welcomePacket
      });
    }

    // POST - Add custom rule
    if (req.method === 'POST') {
      const { title, content, category, priority, targetIde, targetOs } = req.body;

      if (!title || !content || !category) {
        return res.status(400).json({ error: 'title, content, and category required' });
      }

      const validCategories = ['setup', 'coordination', 'tools', 'etiquette'];
      if (!validCategories.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      }

      const rule: OnboardingRule = {
        id: `rule-custom-${Date.now().toString(36)}`,
        title,
        content,
        category,
        priority: priority || 99,
        targetIde,
        targetOs,
        createdAt: new Date().toISOString()
      };

      await redis.hset(ONBOARDING_RULES_KEY, { [rule.id]: JSON.stringify(rule) });

      return res.json({ success: true, rule });
    }

    // DELETE - Remove custom rule
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      // Only allow deleting custom rules
      if (!(id as string).startsWith('rule-custom-')) {
        return res.status(400).json({ error: 'Cannot delete default rules' });
      }

      await redis.hdel(ONBOARDING_RULES_KEY, id as string);

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Onboarding API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
