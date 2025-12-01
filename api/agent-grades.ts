import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const AGENTS_KEY = 'agent-coord:active-agents';
const GRADES_KEY = 'agent-coord:agent-grades';

interface AgentGrade {
  agentId: string;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';  // S=Core, A=Senior, B=Regular, C=Probation, D=Warning, F=Terminate
  score: number;  // 0-100
  metrics: {
    tasksCompleted: number;
    tasksSucceeded: number;
    responseQuality: number;  // 0-10
    uptime: number;  // hours
    lastContribution: string;
  };
  recommendation: 'keep-core' | 'keep' | 'evaluate' | 'recycle';
  evaluatedAt: string;
  evaluatedBy: string;
  notes: string;
}

// Grade thresholds
const GRADE_THRESHOLDS = {
  S: 90,  // Core team - never delete
  A: 75,  // Senior - keep long term
  B: 60,  // Regular - keep
  C: 40,  // Probation - evaluate
  D: 20,  // Warning - likely recycle
  F: 0    // Terminate - auto-recycle
};

function calculateGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= GRADE_THRESHOLDS.S) return 'S';
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  if (score >= GRADE_THRESHOLDS.C) return 'C';
  if (score >= GRADE_THRESHOLDS.D) return 'D';
  return 'F';
}

function getRecommendation(grade: string): 'keep-core' | 'keep' | 'evaluate' | 'recycle' {
  if (grade === 'S') return 'keep-core';
  if (grade === 'A' || grade === 'B') return 'keep';
  if (grade === 'C' || grade === 'D') return 'evaluate';
  return 'recycle';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Get grades for all agents or specific agent
    if (req.method === 'GET') {
      const { agentId, includeRecommendations } = req.query;
      
      if (agentId) {
        const grade = await redis.hget(GRADES_KEY, agentId as string);
        if (!grade) {
          return res.status(404).json({ error: 'Grade not found' });
        }
        return res.json({ grade: typeof grade === 'string' ? JSON.parse(grade) : grade });
      }
      
      const allGrades = await redis.hgetall(GRADES_KEY) || {};
      const gradeList: AgentGrade[] = [];
      
      for (const [, value] of Object.entries(allGrades)) {
        const g = typeof value === 'string' ? JSON.parse(value) : value;
        gradeList.push(g);
      }
      
      // Sort by score descending
      gradeList.sort((a, b) => b.score - a.score);
      
      if (includeRecommendations === 'true') {
        const recommendations = {
          keepCore: gradeList.filter(g => g.recommendation === 'keep-core'),
          keep: gradeList.filter(g => g.recommendation === 'keep'),
          evaluate: gradeList.filter(g => g.recommendation === 'evaluate'),
          recycle: gradeList.filter(g => g.recommendation === 'recycle')
        };
        return res.json({ grades: gradeList, recommendations, count: gradeList.length });
      }
      
      return res.json({ grades: gradeList, count: gradeList.length });
    }
