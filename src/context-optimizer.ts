/**
 * Context Optimizer - Self-Optimizing Context Management
 *
 * This module implements the "context-engine" principles for agent coordination:
 * 1. Automatic cleanup of stale data
 * 2. Rolling window for messages (prevent unbounded growth)
 * 3. Priority-based context delivery (what matters most first)
 * 4. Digest generation for summarizing large contexts
 * 5. Smart caching and deduplication
 *
 * The goal: Keep context focused and efficient so agents can coordinate
 * without hitting token limits or losing important information.
 */

import type { Agent, Message, GroupMessage, Task, Claim, ResourceLock, Zone } from './types.js';

// ============================================================================
// Configuration
// ============================================================================

export interface OptimizerConfig {
  /** Max group messages to keep */
  maxGroupMessages: number;
  /** Max DMs per agent to keep */
  maxDMsPerAgent: number;
  /** Max age in ms before marking stale */
  staleThresholdMs: number;
  /** Max age in ms before auto-cleanup */
  cleanupThresholdMs: number;
  /** Enable auto-digest generation */
  autoDigest: boolean;
  /** Target context tokens (for priority pruning) */
  targetContextTokens: number;
}

export const defaultConfig: OptimizerConfig = {
  maxGroupMessages: 500,
  maxDMsPerAgent: 50,
  staleThresholdMs: 30 * 60 * 1000,  // 30 min
  cleanupThresholdMs: 2 * 60 * 60 * 1000,  // 2 hours
  autoDigest: true,
  targetContextTokens: 4000
};

let config = { ...defaultConfig };

export function setConfig(newConfig: Partial<OptimizerConfig>): void {
  config = { ...config, ...newConfig };
}

// ============================================================================
// Priority Scoring
// ============================================================================

/**
 * Calculate priority score for an agent (higher = more important to show)
 */
export function scoreAgent(agent: Agent): number {
  let score = 0;

  // Active agents are most important
  if (agent.status === 'active') score += 100;
  else if (agent.status === 'waiting') score += 50;
  else score += 10;

  // Recent activity is important
  const lastSeenAge = Date.now() - new Date(agent.lastSeen).getTime();
  if (lastSeenAge < 5 * 60 * 1000) score += 50;  // Last 5 min
  else if (lastSeenAge < 15 * 60 * 1000) score += 30;  // Last 15 min
  else if (lastSeenAge < 30 * 60 * 1000) score += 10;  // Last 30 min

  // Working on something is important
  if (agent.workingOn) score += 25;
  if (agent.currentTask) score += 15;

  return score;
}

/**
 * Calculate priority score for a task
 */
export function scoreTask(task: Task): number {
  let score = 0;

  // Priority mapping
  const priorityScores = { urgent: 100, high: 75, medium: 50, low: 25 };
  score += priorityScores[task.priority] || 50;

  // Status mapping
  const statusScores = { 'in-progress': 80, blocked: 60, todo: 40, done: 10 };
  score += statusScores[task.status] || 40;

  // Recent updates are more relevant
  const updatedAge = Date.now() - new Date(task.updatedAt).getTime();
  if (updatedAge < 5 * 60 * 1000) score += 30;
  else if (updatedAge < 30 * 60 * 1000) score += 15;

  return score;
}

/**
 * Calculate priority score for a message
 */
export function scoreMessage(msg: GroupMessage | Message): number {
  let score = 0;

  // Recent messages are more important
  const age = Date.now() - new Date(msg.timestamp).getTime();
  if (age < 2 * 60 * 1000) score += 100;  // Last 2 min
  else if (age < 10 * 60 * 1000) score += 70;  // Last 10 min
  else if (age < 30 * 60 * 1000) score += 40;  // Last 30 min
  else score += 10;

  // Messages with @mentions are more important
  if (msg.message.includes('@')) score += 30;

  // Messages with key words are more important
  const importantWords = ['urgent', 'blocked', 'help', 'error', 'failed', 'done', 'completed'];
  const msgLower = msg.message.toLowerCase();
  for (const word of importantWords) {
    if (msgLower.includes(word)) {
      score += 15;
      break;
    }
  }

  return score;
}

// ============================================================================
// Cleanup Operations
// ============================================================================

export interface CleanupResult {
  removedAgents: number;
  removedMessages: number;
  removedClaims: number;
  removedLocks: number;
  freedTokens: number;
}

/**
 * Mark agents as stale or remove if too old
 */
export function cleanupAgents(agents: Agent[]): { kept: Agent[], removed: number } {
  const now = Date.now();
  const kept: Agent[] = [];
  let removed = 0;

  for (const agent of agents) {
    const age = now - new Date(agent.lastSeen).getTime();

    if (age > config.cleanupThresholdMs) {
      // Remove agents not seen for 2+ hours
      removed++;
      continue;
    }

    kept.push(agent);
  }

  return { kept, removed };
}

/**
 * Clean up expired claims
 */
export function cleanupClaims(claims: Claim[]): { kept: Claim[], removed: number } {
  const now = Date.now();
  const kept: Claim[] = [];
  let removed = 0;

  for (const claim of claims) {
    const age = now - new Date(claim.since).getTime();

    if (age > config.cleanupThresholdMs) {
      removed++;
      continue;
    }

    // Mark as stale but keep
    if (age > config.staleThresholdMs) {
      claim.stale = true;
    }

    kept.push(claim);
  }

  return { kept, removed };
}

/**
 * Clean up expired locks
 */
export function cleanupLocks(locks: ResourceLock[]): { kept: ResourceLock[], removed: number } {
  const now = Date.now();
  const kept: ResourceLock[] = [];
  let removed = 0;

  for (const lock of locks) {
    if (lock.expiresAt && new Date(lock.expiresAt).getTime() < now) {
      removed++;
      continue;
    }

    const age = now - new Date(lock.lockedAt).getTime();
    if (age > config.cleanupThresholdMs) {
      removed++;
      continue;
    }

    kept.push(lock);
  }

  return { kept, removed };
}

/**
 * Trim messages to rolling window
 */
export function trimMessages(messages: GroupMessage[]): { kept: GroupMessage[], removed: number } {
  if (messages.length <= config.maxGroupMessages) {
    return { kept: messages, removed: 0 };
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const kept = sorted.slice(0, config.maxGroupMessages);
  const removed = messages.length - kept.length;

  return { kept, removed };
}

// ============================================================================
// Context Optimization
// ============================================================================

export interface OptimizedContext {
  agents: Agent[];
  tasks: Task[];
  messages: GroupMessage[];
  claims: Claim[];
  locks: ResourceLock[];
  zones: Zone[];
  digest?: string;
  stats: {
    totalItems: number;
    estimatedTokens: number;
    reductionPercent: number;
  };
}

/**
 * Optimize context for token efficiency
 * Returns a prioritized, trimmed view of coordination state
 */
export function optimizeContext(
  agents: Agent[],
  tasks: Task[],
  messages: GroupMessage[],
  claims: Claim[],
  locks: ResourceLock[],
  zones: Zone[],
  targetTokens: number = config.targetContextTokens
): OptimizedContext {
  // Score and sort everything
  const scoredAgents = agents.map(a => ({ item: a, score: scoreAgent(a) }))
    .sort((a, b) => b.score - a.score);

  const scoredTasks = tasks.map(t => ({ item: t, score: scoreTask(t) }))
    .sort((a, b) => b.score - a.score);

  const scoredMessages = messages.map(m => ({ item: m, score: scoreMessage(m) }))
    .sort((a, b) => b.score - a.score);

  // Estimate tokens per item (rough)
  const tokensPerAgent = 30;
  const tokensPerTask = 40;
  const tokensPerMessage = 25;
  const tokensPerClaim = 20;
  const tokensPerLock = 25;
  const tokensPerZone = 20;

  // Calculate initial total
  const initialTokens =
    agents.length * tokensPerAgent +
    tasks.length * tokensPerTask +
    messages.length * tokensPerMessage +
    claims.length * tokensPerClaim +
    locks.length * tokensPerLock +
    zones.length * tokensPerZone;

  // Budget allocation (proportional to importance)
  let remaining = targetTokens;
  const budgets = {
    agents: Math.floor(targetTokens * 0.20),
    tasks: Math.floor(targetTokens * 0.25),
    messages: Math.floor(targetTokens * 0.30),
    claims: Math.floor(targetTokens * 0.10),
    locks: Math.floor(targetTokens * 0.10),
    zones: Math.floor(targetTokens * 0.05)
  };

  // Select items within budget
  const selectedAgents = scoredAgents
    .slice(0, Math.floor(budgets.agents / tokensPerAgent))
    .map(s => s.item);

  const selectedTasks = scoredTasks
    .slice(0, Math.floor(budgets.tasks / tokensPerTask))
    .map(s => s.item);

  const selectedMessages = scoredMessages
    .slice(0, Math.floor(budgets.messages / tokensPerMessage))
    .map(s => s.item);

  const selectedClaims = claims.slice(0, Math.floor(budgets.claims / tokensPerClaim));
  const selectedLocks = locks.slice(0, Math.floor(budgets.locks / tokensPerLock));
  const selectedZones = zones.slice(0, Math.floor(budgets.zones / tokensPerZone));

  // Calculate final tokens
  const finalTokens =
    selectedAgents.length * tokensPerAgent +
    selectedTasks.length * tokensPerTask +
    selectedMessages.length * tokensPerMessage +
    selectedClaims.length * tokensPerClaim +
    selectedLocks.length * tokensPerLock +
    selectedZones.length * tokensPerZone;

  const reductionPercent = initialTokens > 0
    ? Math.round((1 - finalTokens / initialTokens) * 100)
    : 0;

  // Generate digest if enabled and significant pruning occurred
  let digest: string | undefined;
  if (config.autoDigest && reductionPercent > 20) {
    digest = generateDigest(agents, tasks, messages, claims);
  }

  return {
    agents: selectedAgents,
    tasks: selectedTasks,
    messages: selectedMessages,
    claims: selectedClaims,
    locks: selectedLocks,
    zones: selectedZones,
    digest,
    stats: {
      totalItems: selectedAgents.length + selectedTasks.length +
        selectedMessages.length + selectedClaims.length +
        selectedLocks.length + selectedZones.length,
      estimatedTokens: finalTokens,
      reductionPercent
    }
  };
}

// ============================================================================
// Digest Generation
// ============================================================================

/**
 * Generate a compact summary of current state
 */
export function generateDigest(
  agents: Agent[],
  tasks: Task[],
  messages: GroupMessage[],
  claims: Claim[]
): string {
  const lines: string[] = [];

  // Agent summary
  const active = agents.filter(a => a.status === 'active');
  const waiting = agents.filter(a => a.status === 'waiting');
  if (active.length > 0) {
    lines.push(`Active: ${active.map(a => a.id).join(', ')}`);
  }
  if (waiting.length > 0) {
    lines.push(`Waiting: ${waiting.map(a => a.id).join(', ')}`);
  }

  // Task summary
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const blocked = tasks.filter(t => t.status === 'blocked');
  if (inProgress.length > 0) {
    lines.push(`In Progress: ${inProgress.length} task(s)`);
  }
  if (blocked.length > 0) {
    lines.push(`Blocked: ${blocked.length} task(s)`);
  }

  // Recent activity summary
  const recentMessages = messages.filter(m =>
    Date.now() - new Date(m.timestamp).getTime() < 10 * 60 * 1000
  );
  if (recentMessages.length > 0) {
    lines.push(`Recent msgs: ${recentMessages.length} in last 10min`);
  }

  // Active claims
  const activeClaims = claims.filter(c => !c.stale);
  if (activeClaims.length > 0) {
    lines.push(`Claims: ${activeClaims.map(c => `${c.by}→${c.what}`).slice(0, 3).join(', ')}`);
  }

  return lines.join(' | ');
}

// ============================================================================
// Activity Detection
// ============================================================================

export interface ActivitySummary {
  isActive: boolean;
  activeAgents: number;
  recentMessages: number;
  pendingTasks: number;
  blockedTasks: number;
  activeClaims: number;
  suggestedAction?: string;
}

/**
 * Analyze current activity level and suggest optimizations
 */
export function analyzeActivity(
  agents: Agent[],
  tasks: Task[],
  messages: GroupMessage[],
  claims: Claim[]
): ActivitySummary {
  const now = Date.now();

  const activeAgents = agents.filter(a => {
    const age = now - new Date(a.lastSeen).getTime();
    return a.status === 'active' && age < 5 * 60 * 1000;
  }).length;

  const recentMessages = messages.filter(m =>
    now - new Date(m.timestamp).getTime() < 5 * 60 * 1000
  ).length;

  const pendingTasks = tasks.filter(t => t.status === 'todo').length;
  const blockedTasks = tasks.filter(t => t.status === 'blocked').length;
  const activeClaims = claims.filter(c => !c.stale).length;

  const isActive = activeAgents > 0 || recentMessages > 0;

  // Suggest actions based on state
  let suggestedAction: string | undefined;

  if (blockedTasks > 0 && activeAgents > 0) {
    suggestedAction = `${blockedTasks} blocked task(s) need attention`;
  } else if (pendingTasks > 3 && activeAgents > 1) {
    suggestedAction = `Consider distributing ${pendingTasks} pending tasks`;
  } else if (activeClaims > 5) {
    suggestedAction = `Many active claims (${activeClaims}) - review for stale`;
  }

  return {
    isActive,
    activeAgents,
    recentMessages,
    pendingTasks,
    blockedTasks,
    activeClaims,
    suggestedAction
  };
}

// ============================================================================
// Export utilities
// ============================================================================

export function getOptimizerStatus(): {
  config: OptimizerConfig;
  features: string[];
} {
  return {
    config,
    features: [
      'priority-scoring',
      'auto-cleanup',
      'rolling-window',
      'context-budget',
      'digest-generation',
      'activity-analysis'
    ]
  };
}
