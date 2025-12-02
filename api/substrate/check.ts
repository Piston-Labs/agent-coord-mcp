import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys
const RULES_KEY = 'agent-coord:rules';
const LOCKS_KEY = 'agent-coord:resource-locks';
const ZONES_KEY = 'agent-coord:zones';
const CLAIMS_KEY = 'agent-coord:claims';
const SESSIONS_KEY = 'agent-coord:sessions';
const VIOLATIONS_KEY = 'agent-coord:violations';

interface RuleCheck {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  message: string;
  severity: 'block' | 'warn' | 'log';
}

interface CheckResult {
  allowed: boolean;
  agentId: string;
  action: string;
  target?: string;
  checks: RuleCheck[];
  violations: RuleCheck[];
  warnings: RuleCheck[];
  timestamp: string;
}

/**
 * Substrate Check API - Validates agent actions against rules
 *
 * POST /api/substrate/check
 * {
 *   "agentId": "TOM",
 *   "action": "file-edit" | "file-create" | "zone-enter" | "task-start" | "handoff",
 *   "target": "path/to/file.ts" (optional)
 * }
 *
 * Returns whether the action is allowed and any violations/warnings
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { agentId, action, target } = req.body;

    if (!agentId || !action) {
      return res.status(400).json({ error: 'agentId and action required' });
    }

    // Load rules and current state in parallel
    const [rulesData, locksData, zonesData, claimsData] = await Promise.all([
      redis.get(RULES_KEY),
      redis.hgetall(LOCKS_KEY),
      redis.hgetall(ZONES_KEY),
      redis.hgetall(CLAIMS_KEY),
    ]);

    const rules = rulesData
      ? (typeof rulesData === 'string' ? JSON.parse(rulesData) : rulesData)
      : null;

    const locks = locksData || {};
    const zones = zonesData || {};
    const claims = claimsData || {};

    const checks: RuleCheck[] = [];

    // Rule 1: Lock Before Edit
    if (action === 'file-edit' && target) {
      const isLocked = Object.entries(locks).some(([path, lock]) => {
        const lockData = typeof lock === 'string' ? JSON.parse(lock) : lock;
        return target.includes(path) && lockData.lockedBy === agentId;
      });

      checks.push({
        ruleId: 'lock-before-edit',
        ruleName: 'Lock Before Edit',
        passed: isLocked,
        message: isLocked
          ? `File ${target} is locked by you`
          : `You must lock ${target} before editing. Use: resource lock`,
        severity: rules?.coordination?.requireClaimBeforeEdit ? 'block' : 'warn'
      });
    }

    // Rule 2: Zone Respect
    if ((action === 'file-edit' || action === 'file-create') && target) {
      let zoneViolation: RuleCheck | null = null;

      for (const [zoneId, zoneData] of Object.entries(zones)) {
        const zone = typeof zoneData === 'string' ? JSON.parse(zoneData) : zoneData;
        if (zone.owner && zone.owner !== agentId && target.startsWith(zone.path)) {
          zoneViolation = {
            ruleId: 'zone-respect',
            ruleName: 'Zone Respect',
            passed: false,
            message: `${target} is in zone "${zoneId}" owned by ${zone.owner}. Request access or use a different area.`,
            severity: 'block'
          };
          break;
        }
      }

      if (zoneViolation) {
        checks.push(zoneViolation);
      } else {
        checks.push({
          ruleId: 'zone-respect',
          ruleName: 'Zone Respect',
          passed: true,
          message: 'No zone conflicts',
          severity: 'log'
        });
      }
    }

    // Rule 3: Claim Before Work
    if (action === 'task-start' && target) {
      const hasClaim = Object.entries(claims).some(([claimId, claimData]) => {
        const claim = typeof claimData === 'string' ? JSON.parse(claimData) : claimData;
        return claim.agentId === agentId && claim.what === target;
      });

      checks.push({
        ruleId: 'claim-before-work',
        ruleName: 'Claim Before Work',
        passed: hasClaim,
        message: hasClaim
          ? `You have claimed "${target}"`
          : `Claim this work first with: agent-status claim "${target}"`,
        severity: rules?.coordination?.requireClaimBeforeEdit ? 'warn' : 'log'
      });
    }

    // Rule 4: Max Concurrent Claims
    if (action === 'claim') {
      const agentClaims = Object.values(claims).filter(c => {
        const claim = typeof c === 'string' ? JSON.parse(c) : c;
        return claim.agentId === agentId;
      });

      const maxClaims = rules?.coordination?.maxConcurrentClaimsPerAgent || 3;
      const underLimit = agentClaims.length < maxClaims;

      checks.push({
        ruleId: 'max-claims',
        ruleName: 'Max Concurrent Claims',
        passed: underLimit,
        message: underLimit
          ? `You have ${agentClaims.length}/${maxClaims} claims`
          : `You have reached max claims (${maxClaims}). Release a claim first.`,
        severity: 'block'
      });
    }

    // Separate violations and warnings
    const violations = checks.filter(c => !c.passed && c.severity === 'block');
    const warnings = checks.filter(c => !c.passed && c.severity === 'warn');

    const result: CheckResult = {
      allowed: violations.length === 0,
      agentId,
      action,
      target,
      checks,
      violations,
      warnings,
      timestamp: new Date().toISOString()
    };

    // Log violations
    if (violations.length > 0) {
      await redis.lpush(VIOLATIONS_KEY, JSON.stringify({
        agentId,
        action,
        target,
        violations: violations.map(v => v.ruleId),
        timestamp: result.timestamp
      }));
    }

    return res.json(result);

  } catch (error) {
    console.error('Substrate check error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
