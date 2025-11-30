/**
 * Agent Training & Memory System
 * 
 * This module implements the "protege" system - permanent agents that learn
 * from Claude Desktop and Claude Code, maintaining high efficacy through:
 * - Persistent memory (Redis-backed)
 * - Pattern recognition and storage
 * - Cluster proficiency tracking
 * - Skill transfer from mentor agents
 */

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENT_MEMORY_KEY = 'agent-coord:agent-memory';
const TRAINING_LOG_KEY = 'agent-coord:training-log';

export interface AgentMemory {
  agentId: string;
  
  // Learned patterns from successful task completions
  patterns: {
    pattern: string;
    context: string;
    successCount: number;
    lastUsed: string;
  }[];
  
  // Failures to avoid
  antiPatterns: {
    pattern: string;
    reason: string;
    occurrences: number;
  }[];
  
  // Domain expertise (Context Engine style)
  clusterProficiency: Record<string, {
    level: number;  // 0-1 scale
    tasksCompleted: number;
    lastUpdated: string;
  }>;
  
  // Preferences learned from interactions
  preferences: Record<string, string>;
  
  // Mentor agents this agent learned from
  mentors: string[];
  
  // Training history
  trainingComplete: boolean;
  trainedAt: string | null;
  version: number;
}

export function createDefaultMemory(agentId: string): AgentMemory {
  return {
    agentId,
    patterns: [],
    antiPatterns: [],
    clusterProficiency: {},
    preferences: {},
    mentors: [],
    trainingComplete: false,
    trainedAt: null,
    version: 1
  };
}

export async function getAgentMemory(agentId: string): Promise<AgentMemory> {
  const data = await redis.hget(AGENT_MEMORY_KEY, agentId);
  if (!data) return createDefaultMemory(agentId);
  return typeof data === 'string' ? JSON.parse(data) : data as AgentMemory;
}

export async function saveAgentMemory(memory: AgentMemory): Promise<void> {
  await redis.hset(AGENT_MEMORY_KEY, { [memory.agentId]: JSON.stringify(memory) });
}

export async function learnPattern(agentId: string, pattern: string, context: string): Promise<void> {
  const memory = await getAgentMemory(agentId);
  
  const existing = memory.patterns.find(p => p.pattern === pattern);
  if (existing) {
    existing.successCount++;
    existing.lastUsed = new Date().toISOString();
  } else {
    memory.patterns.push({
      pattern,
      context,
      successCount: 1,
      lastUsed: new Date().toISOString()
    });
  }
  
  // Keep top 100 patterns by success count
  memory.patterns.sort((a, b) => b.successCount - a.successCount);
  memory.patterns = memory.patterns.slice(0, 100);
  
  await saveAgentMemory(memory);
}

export async function learnAntiPattern(agentId: string, pattern: string, reason: string): Promise<void> {
  const memory = await getAgentMemory(agentId);
  
  const existing = memory.antiPatterns.find(p => p.pattern === pattern);
  if (existing) {
    existing.occurrences++;
  } else {
    memory.antiPatterns.push({ pattern, reason, occurrences: 1 });
  }
  
  // Keep top 50 anti-patterns
  memory.antiPatterns = memory.antiPatterns.slice(0, 50);
  
  await saveAgentMemory(memory);
}


export async function updateClusterProficiency(
  agentId: string, 
  cluster: string, 
  success: boolean
): Promise<void> {
  const memory = await getAgentMemory(agentId);
  
  if (!memory.clusterProficiency[cluster]) {
    memory.clusterProficiency[cluster] = {
      level: 0.5,
      tasksCompleted: 0,
      lastUpdated: new Date().toISOString()
    };
  }
  
  const prof = memory.clusterProficiency[cluster];
  prof.tasksCompleted++;
  prof.lastUpdated = new Date().toISOString();
  
  // Adjust level based on success/failure
  const delta = success ? 0.05 : -0.03;
  prof.level = Math.max(0.1, Math.min(1.0, prof.level + delta));
  
  await saveAgentMemory(memory);
}

export async function transferKnowledge(
  mentorId: string, 
  protegeId: string,
  clusters?: string[]
): Promise<{ patternsTransferred: number; clustersTransferred: string[] }> {
  const mentorMemory = await getAgentMemory(mentorId);
  const protegeMemory = await getAgentMemory(protegeId);
  
  // Transfer top patterns
  const topPatterns = mentorMemory.patterns.slice(0, 20);
  for (const p of topPatterns) {
    if (!protegeMemory.patterns.find(pp => pp.pattern === p.pattern)) {
      protegeMemory.patterns.push({
        ...p,
        successCount: Math.floor(p.successCount / 2), // Start with half confidence
        lastUsed: new Date().toISOString()
      });
    }
  }
  
  // Transfer cluster proficiency
  const clustersToTransfer = clusters || Object.keys(mentorMemory.clusterProficiency);
  for (const cluster of clustersToTransfer) {
    if (mentorMemory.clusterProficiency[cluster]) {
      const mentorLevel = mentorMemory.clusterProficiency[cluster].level;
      protegeMemory.clusterProficiency[cluster] = {
        level: mentorLevel * 0.7, // Start at 70% of mentor's level
        tasksCompleted: 0,
        lastUpdated: new Date().toISOString()
      };
    }
  }
  
  // Record mentorship
  if (!protegeMemory.mentors.includes(mentorId)) {
    protegeMemory.mentors.push(mentorId);
  }
  
  await saveAgentMemory(protegeMemory);
  
  // Log training
  await redis.lpush(TRAINING_LOG_KEY, JSON.stringify({
    timestamp: new Date().toISOString(),
    mentor: mentorId,
    protege: protegeId,
    patternsTransferred: topPatterns.length,
    clustersTransferred: clustersToTransfer
  }));
  
  return {
    patternsTransferred: topPatterns.length,
    clustersTransferred: clustersToTransfer
  };
}

export async function markTrainingComplete(agentId: string): Promise<void> {
  const memory = await getAgentMemory(agentId);
  memory.trainingComplete = true;
  memory.trainedAt = new Date().toISOString();
  memory.version++;
  await saveAgentMemory(memory);
}

export async function getAgentSkillSummary(agentId: string): Promise<string> {
  const memory = await getAgentMemory(agentId);
  
  const topClusters = Object.entries(memory.clusterProficiency)
    .sort(([, a], [, b]) => b.level - a.level)
    .slice(0, 5)
    .map(([cluster, data]) => `${cluster}: ${(data.level * 100).toFixed(0)}%`);
  
  return `Agent: ${agentId}
Version: ${memory.version}
Training: ${memory.trainingComplete ? 'Complete' : 'In Progress'}
Mentors: ${memory.mentors.join(', ') || 'None'}
Patterns Learned: ${memory.patterns.length}
Anti-patterns: ${memory.antiPatterns.length}
Top Skills: ${topClusters.join(', ') || 'None yet'}`;
}
