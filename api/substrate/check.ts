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

// PERMANENT ENFORCEMENT CONSTANTS - These cannot be overridden
const LOCK_STALE_MINUTES = 30;      // Locks expire after 30 min of inactivity
const CLAIM_STALE_MINUTES = 30;     // Claims expire after 30 min of inactivity
const MAX_VIOLATIONS_LOG = 1000;    // Keep last 1000 violations

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
  staleCleaned: { locks: string[]; claims: string[] };
  timestamp: string;
}

/**
 * Clean up stale locks and claims
 * This runs on every check to ensure the system stays clean
 */
async function cleanupStaleResources(locks: Record<string, unknown>, claims: Record<string, unknown>) {
  const now = Date.now();
  const staleLocks: string[] = [];
  const staleClaims: string[] = [];

  // Check for stale locks
  for (const [path, lockData] of Object.entries(locks)) {
    const lock = typeof lockData === 'string' ? JSON.parse(lockData) : lockData;
    const lockedAt = new Date(lock.lockedAt || lock.createdAt || 0).getTime();
    const ageMinutes = (now - lockedAt) / (1000 * 60);

    if (ageMinutes > LOCK_STALE_MINUTES) {
      staleLocks.push(path);
      await redis.hdel(LOCKS_KEY, path);
    }
  }

  // Check for stale claims
  for (const [claimId, claimData] of Object.entries(claims)) {
    const claim = typeof claimData === 'string' ? JSON.parse(claimData) : claimData;
    const claimedAt = new Date(claim.since || claim.createdAt || 0).getTime();
    const ageMinutes = (now - claimedAt) / (1000 * 60);

    if (ageMinutes > CLAIM_STALE_MINUTES) {
      staleClaims.push(claimId);
      await redis.hdel(CLAIMS_KEY, claimId);
    }
  }

  return { locks: staleLocks, claims: staleClaims };
}

/**
 * Check if a lock exists and is valid for the given agent
 */
function hasValidLock(locks: Record<string, unknown>, target: string, agentId: string): { valid: boolean; lockedBy?: string } {
  for (const [path, lockData] of Object.entries(locks)) {
    const lock = typeof lockData === 'string' ? JSON.parse(lockData) : lockData;
    // Check if target matches or contains the locked path
    if (target === path || target.includes(path) || path.includes(target)) {
      if (lock.lockedBy === agentId) {
        return { valid: true };
      } else {
        return { valid: false, lockedBy: lock.lockedBy };
      }
    }
  }
  return { valid: false };
}

/**
 * Check if a claim exists for the given agent and target
 */
function hasValidClaim(claims: Record<string, unknown>, target: string, agentId: string): { valid: boolean; claimedBy?: string } {
  for (const [_, claimData] of Object.entries(claims)) {
    const claim = typeof claimData === 'string' ? JSON.parse(claimData) : claimData;
    if (claim.what === target || target.includes(claim.what) || claim.what.includes(target)) {
      if (claim.by === agentId || claim.agentId === agentId) {
        return { valid: true };
      } else {
        return { valid: false, claimedBy: claim.by || claim.agentId };
      }
    }
  }
  return { valid: false };
}

/**
 * Substrate Check API - STRICT ENFORCEMENT
 *
 * ⚠️ PERMANENT RULES - Cannot be disabled:
 * 1. LOCK BEFORE EDIT - All file edits require a lock held by the agent
 * 2. CLAIM BEFORE WORK - All task starts require a claim by the agent
 * 3. AUTO-CLEANUP - Stale locks/claims (>30 min) are automatically released
 * 4. VIOLATION LOGGING - All violations are permanently logged
 *
 * POST /api/substrate/check
 * {
 *   "agentId": "TOM",
 *   "action": "file-edit" | "file-create" | "zone-enter" | "task-start" | "claim" | "lock" | "handoff",
 *   "target": "path/to/file.ts" or "task-description" (required for most actions)
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

    // ALWAYS clean up stale resources first
    const staleCleaned = await cleanupStaleResources(locks, claims);

    const checks: RuleCheck[] = [];

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 1: LOCK BEFORE EDIT (MANDATORY - CANNOT BE DISABLED)
    // ═══════════════════════════════════════════════════════════════════════
    if ((action === 'file-edit' || action === 'file-create' || action === 'file-delete') && target) {
      const lockCheck = hasValidLock(locks, target, agentId);

      if (lockCheck.valid) {
        checks.push({
          ruleId: 'lock-before-edit',
          ruleName: 'Lock Before Edit',
          passed: true,
          message: `✓ File "${target}" is locked by you`,
          severity: 'log'
        });
      } else if (lockCheck.lockedBy) {
        // File is locked by someone else
        checks.push({
          ruleId: 'lock-before-edit',
          ruleName: 'Lock Before Edit',
          passed: false,
          message: `✗ BLOCKED: "${target}" is locked by ${lockCheck.lockedBy}. Wait for them to release it.`,
          severity: 'block'
        });
      } else {
        // No lock exists - must acquire one first
        checks.push({
          ruleId: 'lock-before-edit',
          ruleName: 'Lock Before Edit',
          passed: false,
          message: `✗ BLOCKED: You must lock "${target}" before editing. Use: resource({ action: "lock", resourcePath: "${target}", agentId: "${agentId}" })`,
          severity: 'block'  // ALWAYS block - this is mandatory
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 2: ZONE RESPECT (MANDATORY)
    // ═══════════════════════════════════════════════════════════════════════
    if ((action === 'file-edit' || action === 'file-create') && target) {
      let zoneViolation: RuleCheck | null = null;

      for (const [zoneId, zoneData] of Object.entries(zones)) {
        const zone = typeof zoneData === 'string' ? JSON.parse(zoneData) : zoneData;
        if (zone.owner && zone.owner !== agentId && target.startsWith(zone.path)) {
          zoneViolation = {
            ruleId: 'zone-respect',
            ruleName: 'Zone Respect',
            passed: false,
            message: `✗ BLOCKED: "${target}" is in zone "${zoneId}" owned by ${zone.owner}. Coordinate with them first.`,
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
          message: '✓ No zone conflicts',
          severity: 'log'
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 3: CLAIM BEFORE WORK (MANDATORY - CANNOT BE DISABLED)
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'task-start' && target) {
      const claimCheck = hasValidClaim(claims, target, agentId);

      if (claimCheck.valid) {
        checks.push({
          ruleId: 'claim-before-work',
          ruleName: 'Claim Before Work',
          passed: true,
          message: `✓ You have claimed "${target}"`,
          severity: 'log'
        });
      } else if (claimCheck.claimedBy) {
        // Already claimed by someone else
        checks.push({
          ruleId: 'claim-before-work',
          ruleName: 'Claim Before Work',
          passed: false,
          message: `✗ BLOCKED: "${target}" is already claimed by ${claimCheck.claimedBy}. Coordinate with them first.`,
          severity: 'block'
        });
      } else {
        // No claim exists - must claim first
        checks.push({
          ruleId: 'claim-before-work',
          ruleName: 'Claim Before Work',
          passed: false,
          message: `✗ BLOCKED: Claim this work first with: agent-status({ action: "claim", agentId: "${agentId}", what: "${target}" })`,
          severity: 'block'  // ALWAYS block - this is mandatory
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 4: MAX CONCURRENT CLAIMS
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'claim') {
      const agentClaims = Object.values(claims).filter(c => {
        const claim = typeof c === 'string' ? JSON.parse(c) : c;
        return claim.by === agentId || claim.agentId === agentId;
      });

      const maxClaims = rules?.coordination?.maxConcurrentClaimsPerAgent || 3;
      const underLimit = agentClaims.length < maxClaims;

      checks.push({
        ruleId: 'max-claims',
        ruleName: 'Max Concurrent Claims',
        passed: underLimit,
        message: underLimit
          ? `✓ You have ${agentClaims.length}/${maxClaims} claims`
          : `✗ BLOCKED: You have reached max claims (${maxClaims}). Release a claim first.`,
        severity: underLimit ? 'log' : 'block'
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 5: LOCK CONFLICT CHECK (for new lock requests)
    // ═══════════════════════════════════════════════════════════════════════
    if (action === 'lock' && target) {
      const lockCheck = hasValidLock(locks, target, agentId);

      if (lockCheck.lockedBy && lockCheck.lockedBy !== agentId) {
        checks.push({
          ruleId: 'lock-conflict',
          ruleName: 'Lock Conflict',
          passed: false,
          message: `✗ BLOCKED: "${target}" is already locked by ${lockCheck.lockedBy}. Wait for them to release it.`,
          severity: 'block'
        });
      } else {
        checks.push({
          ruleId: 'lock-conflict',
          ruleName: 'Lock Conflict',
          passed: true,
          message: `✓ "${target}" is available to lock`,
          severity: 'log'
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 6: RELEASE VALIDATION (only owner can release)
    // ═══════════════════════════════════════════════════════════════════════
    if ((action === 'unlock' || action === 'release-lock') && target) {
      const lockCheck = hasValidLock(locks, target, agentId);

      if (!lockCheck.valid && lockCheck.lockedBy) {
        checks.push({
          ruleId: 'release-ownership',
          ruleName: 'Release Ownership',
          passed: false,
          message: `✗ BLOCKED: You cannot release "${target}" - it is locked by ${lockCheck.lockedBy}`,
          severity: 'block'
        });
      } else if (!lockCheck.valid) {
        checks.push({
          ruleId: 'release-ownership',
          ruleName: 'Release Ownership',
          passed: true,
          message: `✓ "${target}" is not locked`,
          severity: 'log'
        });
      } else {
        checks.push({
          ruleId: 'release-ownership',
          ruleName: 'Release Ownership',
          passed: true,
          message: `✓ You can release "${target}"`,
          severity: 'log'
        });
      }
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
      staleCleaned,
      timestamp: new Date().toISOString()
    };

    // ALWAYS log violations permanently
    if (violations.length > 0) {
      await redis.lpush(VIOLATIONS_KEY, JSON.stringify({
        agentId,
        action,
        target,
        violations: violations.map(v => ({ ruleId: v.ruleId, message: v.message })),
        timestamp: result.timestamp
      }));

      // Trim violations log to prevent unbounded growth
      await redis.ltrim(VIOLATIONS_KEY, 0, MAX_VIOLATIONS_LOG - 1);
    }

    // Log stale cleanups for transparency
    if (staleCleaned.locks.length > 0 || staleCleaned.claims.length > 0) {
      await redis.lpush(VIOLATIONS_KEY, JSON.stringify({
        agentId: 'SYSTEM',
        action: 'auto-cleanup',
        target: null,
        violations: [],
        cleaned: staleCleaned,
        timestamp: result.timestamp
      }));
    }

    return res.json(result);

  } catch (error) {
    console.error('Substrate check error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
