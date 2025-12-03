import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TRAINING_PROGRESS_KEY = 'agent-coord:training-progress';
const TRAINING_MODULES_KEY = 'agent-coord:training-modules';
const TRAINING_ADAPTIVE_KEY = 'agent-coord:training-adaptive';
const TRAINING_SIMULATIONS_KEY = 'agent-coord:training-simulations';

/**
 * Training Module - A unit of learning content
 */
interface TrainingModule {
  id: string;
  title: string;
  description: string;
  role: 'sales' | 'developer' | 'investor' | 'all';
  category: string;
  order: number;
  lessons: TrainingLesson[];
  estimatedMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Training Lesson - Individual content within a module
 */
interface TrainingLesson {
  id: string;
  title: string;
  content: string;  // Markdown content
  type: 'reading' | 'video' | 'quiz' | 'task';
  videoUrl?: string;
  quiz?: QuizQuestion[];
  taskChecklist?: string[];
  order: number;
}

/**
 * Quiz Question
 */
interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

/**
 * User Progress - Tracks completion per user
 */
interface UserProgress {
  userId: string;
  moduleId: string;
  lessonId: string;
  completed: boolean;
  score?: number;      // For quizzes
  completedAt?: string;
  attempts?: number;
}

/**
 * Adaptive Learning State - Self-optimizing conversation mechanism
 * Implements spaced repetition (SM-2 algorithm) and difficulty adjustment
 */
interface AdaptiveLearningState {
  userId: string;
  // Overall performance metrics
  overallScore: number;           // 0-100 weighted average
  totalQuizzes: number;
  totalCorrect: number;
  totalQuestions: number;
  // Difficulty level (adjusts quiz complexity)
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced';
  // Spaced repetition data per lesson
  lessonReviews: {
    [lessonId: string]: {
      easeFactor: number;         // SM-2 ease factor (starts at 2.5)
      interval: number;           // Days until next review
      repetitions: number;        // Successful review count
      nextReviewDate: string;     // ISO date for next review
      lastScore: number;          // Last quiz score
    };
  };
  // Learning style detection
  learningPatterns: {
    preferredContentType: 'reading' | 'video' | 'quiz' | 'task';
    avgTimePerLesson: number;     // Minutes
    peakLearningHour: number;     // 0-23
    streakDays: number;           // Consecutive learning days
  };
  updatedAt: string;
}

/**
 * Interview Simulation - AI-powered roleplay for sales training
 */
interface InterviewSimulation {
  id: string;
  userId: string;
  scenario: 'cold-call' | 'discovery' | 'demo' | 'objection-handling' | 'closing';
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'in-progress' | 'completed' | 'abandoned';
  // Conversation history
  messages: {
    role: 'system' | 'prospect' | 'user';
    content: string;
    timestamp: string;
    feedback?: string;            // AI feedback on user's response
  }[];
  // Scoring
  scores: {
    rapport: number;              // 0-100
    discovery: number;            // Asked good questions
    valueProposition: number;     // Clear pitch
    objectionHandling: number;    // Handled pushback
    closing: number;              // Asked for commitment
  };
  overallScore: number;
  feedback: string;               // Summary feedback
  startedAt: string;
  completedAt?: string;
}

/**
 * Calculate next review date using SM-2 algorithm
 * Quality: 0-5 rating (0-2 = fail, 3+ = pass)
 */
function calculateSpacedRepetition(
  easeFactor: number,
  interval: number,
  repetitions: number,
  quality: number
): { easeFactor: number; interval: number; repetitions: number } {
  // Quality < 3 means failed - reset
  if (quality < 3) {
    return { easeFactor, interval: 1, repetitions: 0 };
  }

  // Calculate new ease factor
  let newEF = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  newEF = Math.max(1.3, newEF); // Minimum ease factor

  // Calculate new interval
  let newInterval: number;
  if (repetitions === 0) {
    newInterval = 1;
  } else if (repetitions === 1) {
    newInterval = 6;
  } else {
    newInterval = Math.round(interval * newEF);
  }

  return {
    easeFactor: newEF,
    interval: newInterval,
    repetitions: repetitions + 1
  };
}

/**
 * Convert quiz score (0-100) to SM-2 quality (0-5)
 */
function scoreToQuality(score: number): number {
  if (score >= 90) return 5;
  if (score >= 80) return 4;
  if (score >= 70) return 3;
  if (score >= 50) return 2;
  if (score >= 30) return 1;
  return 0;
}

/**
 * Determine difficulty level based on performance
 */
function calculateDifficultyLevel(overallScore: number, totalQuizzes: number): 'beginner' | 'intermediate' | 'advanced' {
  if (totalQuizzes < 3) return 'beginner';
  if (overallScore >= 85 && totalQuizzes >= 5) return 'advanced';
  if (overallScore >= 70) return 'intermediate';
  return 'beginner';
}

/**
 * Interview scenario prompts for AI simulation
 */
const INTERVIEW_SCENARIOS = {
  'cold-call': {
    title: 'Cold Call Practice',
    systemPrompt: `You are a busy plant manager at a manufacturing facility. You receive cold calls regularly and are skeptical but not rude. You have real problems with equipment downtime costing you $15K/hour. You haven't heard of Piston Labs. Start dismissive but warm up if the caller asks good questions and demonstrates understanding of your problems. Don't make it too easy - push back on vague claims.`,
    objectives: ['Build initial rapport', 'Earn the right to ask questions', 'Identify a pain point', 'Schedule a follow-up']
  },
  'discovery': {
    title: 'Discovery Call Practice',
    systemPrompt: `You are the operations director at a food processing plant. You agreed to a 30-minute call because equipment failures are hurting your production. You have a maintenance team of 5 people and are evaluating options. You've looked at Samsara but found it too expensive. Be open but don't volunteer information - make them earn it with good questions.`,
    objectives: ['Understand current pain points', 'Map the decision process', 'Identify budget and timeline', 'Qualify the opportunity']
  },
  'objection-handling': {
    title: 'Objection Handling Practice',
    systemPrompt: `You are interested in the product but have concerns: 1) Your IT team is understaffed and worried about security, 2) You're in a budget freeze until Q2, 3) Your boss doesn't believe in "predictive" technology. Raise these objections one at a time. Be convinced by good arguments but don't give in easily.`,
    objectives: ['Address security concerns', 'Navigate budget constraints', 'Handle skepticism about AI/predictive tech', 'Find a path forward']
  },
  'demo': {
    title: 'Product Demo Practice',
    systemPrompt: `You are watching a demo of Piston Labs. You manage 50 pieces of equipment across 3 facilities. Ask practical questions: How does installation work? What happens when a sensor fails? How do I train my team? What does the mobile app look like? Be engaged but skeptical of any claims that seem too good.`,
    objectives: ['Clear product explanation', 'Handle technical questions', 'Show relevant use cases', 'Create urgency without pressure']
  },
  'closing': {
    title: 'Closing Practice',
    systemPrompt: `You've seen the demo and are impressed but hesitant to commit. You need to talk to your boss. You're worried about implementation disruption. You want to start smaller than the proposal suggests. You're also evaluating one other vendor. Push back on the close but be persuadable with the right approach.`,
    objectives: ['Summarize value proposition', 'Address final concerns', 'Propose clear next steps', 'Ask for commitment']
  }
};

/**
 * Default training modules based on researcher's findings
 */
function getDefaultModules(): TrainingModule[] {
  return [
    // Sales Track
    {
      id: 'sales-101',
      title: 'Sales Engineer Onboarding',
      description: 'Foundation training for sales engineers - ICP, pitch, objections, and demo skills',
      role: 'sales',
      category: 'Onboarding',
      order: 1,
      estimatedMinutes: 120,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: 'sales-101-icp',
          title: 'Ideal Customer Profile (ICP)',
          type: 'reading',
          order: 1,
          content: `# Ideal Customer Profile

## Primary Targets
- **Manufacturing facilities** - Equipment downtime costs $10K-50K/hour
- **Food processing plants** - Cold chain monitoring, FDA compliance
- **HVAC contractors** - Fleet management, job tracking
- **Property managers** - Building systems monitoring

## Key Pain Points
1. Unplanned equipment failures
2. Reactive maintenance costs 3x more than preventive
3. No visibility into field operations
4. Manual tracking and paperwork

## Qualification Questions
- "How much does an hour of downtime cost you?"
- "How do you currently track equipment health?"
- "What's your maintenance budget vs. emergency repair budget?"`
        },
        {
          id: 'sales-101-pitch',
          title: 'The Piston Labs Pitch',
          type: 'reading',
          order: 2,
          content: `# The Elevator Pitch

> "Stop equipment failures before they stop your business."

## Full Pitch Structure

### 1. Problem (30 sec)
"Most businesses find out about equipment problems when something breaks. By then, you're looking at emergency repairs, overtime labor, and lost production."

### 2. Solution (30 sec)
"Piston Labs connects your equipment to our monitoring platform. We detect problems before they become failures, so you can schedule maintenance on your terms."

### 3. Proof (30 sec)
"Our beta customers have reduced unplanned downtime by 40% and cut emergency repair costs in half."

### 4. Ask (15 sec)
"Would you like to see how this would work for your [specific equipment]?"`
        },
        {
          id: 'sales-101-objections',
          title: 'Handling Objections',
          type: 'reading',
          order: 3,
          content: `# Common Objections & Responses

## "It's too expensive"
**Response:** "I understand budget is a concern. Let me ask - what did your last emergency repair cost? Our customers typically see ROI in 3-6 months just from avoided emergencies."

## "We have maintenance staff already"
**Response:** "That's great - our tool makes them more effective. Instead of routine check-ups, they can focus on the issues that actually need attention. We've seen maintenance teams handle 30% more equipment with our alerts."

## "What about data security?"
**Response:** "Security is critical for us too. We use bank-level encryption, and your data never leaves US servers. We're also SOC 2 compliant."

## "We already use Samsara/Uptake"
**Response:** "Those are solid platforms for fleet tracking. We focus specifically on equipment health and predictive maintenance - we often complement those tools rather than replace them."`
        },
        {
          id: 'sales-101-demo',
          title: 'Demo Best Practices',
          type: 'task',
          order: 4,
          content: `# Demo Checklist

Complete these tasks to master the product demo:`,
          taskChecklist: [
            'Watch the recorded demo walkthrough (Loom)',
            'Set up your own demo environment',
            'Practice the 5-minute quick demo',
            'Practice the 20-minute full demo',
            'Shadow 3 live customer demos',
            'Deliver a demo to a team member for feedback'
          ]
        },
        {
          id: 'sales-101-quiz',
          title: 'Sales Fundamentals Quiz',
          type: 'quiz',
          order: 5,
          content: 'Test your knowledge of the sales fundamentals.',
          quiz: [
            {
              question: 'What is our primary elevator pitch headline?',
              options: [
                'The future of IoT monitoring',
                'Stop equipment failures before they stop your business',
                'Smart sensors for smart businesses',
                'Predictive maintenance made easy'
              ],
              correctIndex: 1,
              explanation: 'This headline focuses on the customer benefit (avoiding failures) rather than our technology.'
            },
            {
              question: 'Which is NOT a primary ICP segment?',
              options: [
                'Manufacturing facilities',
                'Food processing plants',
                'Retail stores',
                'HVAC contractors'
              ],
              correctIndex: 2,
              explanation: 'Retail stores are not a primary target - we focus on businesses with critical equipment.'
            },
            {
              question: 'When a prospect says "it\'s too expensive", what should you ask about?',
              options: [
                'Their budget for next year',
                'Their last emergency repair cost',
                'Competitor pricing',
                'Payment plans'
              ],
              correctIndex: 1,
              explanation: 'Anchoring to their emergency repair costs helps them see ROI potential.'
            }
          ]
        }
      ]
    },

    // Developer Track
    {
      id: 'dev-101',
      title: 'Developer Onboarding',
      description: 'Technical onboarding for developers - codebase, architecture, and contribution guidelines',
      role: 'developer',
      category: 'Onboarding',
      order: 1,
      estimatedMinutes: 90,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: 'dev-101-architecture',
          title: 'System Architecture',
          type: 'reading',
          order: 1,
          content: `# Piston Labs Architecture

## Core Components

### 1. IoT Layer (Teltonika Devices)
- FMC130 GPS trackers with CAN bus readers
- MQTT over AWS IoT Core
- Lambda processors for data ingestion

### 2. Backend Services
- **Vercel Functions** - API endpoints
- **Upstash Redis** - Real-time data, caching
- **PostgreSQL** - Historical data (via Supabase)

### 3. Frontend
- Single-page dashboard (vanilla JS)
- Real-time WebSocket updates
- Mobile-responsive design

### 4. Agent Coordination Hub
- Multi-agent collaboration platform
- MCP (Model Context Protocol) tools
- Cloudflare Durable Objects for state

## Key Repositories
- \`piston-dashboard\` - Main web application
- \`gran-autismo\` - Teltonika device management
- \`agent-coord-mcp\` - This hub!
- \`teltonika-context-system\` - Documentation & context`
        },
        {
          id: 'dev-101-setup',
          title: 'Development Environment Setup',
          type: 'task',
          order: 2,
          content: `# Setup Checklist

Complete these tasks to set up your development environment:`,
          taskChecklist: [
            'Clone the main repositories from GitHub',
            'Install Node.js 18+ and pnpm',
            'Set up Vercel CLI and link projects',
            'Configure environment variables (.env.local)',
            'Run local development server',
            'Make a test change and verify hot reload',
            'Create your first PR (even a typo fix counts!)'
          ]
        },
        {
          id: 'dev-101-conventions',
          title: 'Code Conventions',
          type: 'reading',
          order: 3,
          content: `# Code Conventions

## TypeScript
- Strict mode enabled
- Explicit return types for functions
- Use interfaces over types for objects

## Naming
- \`camelCase\` for variables and functions
- \`PascalCase\` for types and components
- \`SCREAMING_SNAKE_CASE\` for constants

## Git
- Conventional commits: \`feat:\`, \`fix:\`, \`docs:\`, \`refactor:\`
- Branch naming: \`feat/description\`, \`fix/issue-number\`
- Squash and merge for PRs

## API Design
- RESTful endpoints
- Consistent error format: \`{ error: string, details?: any }\`
- Use query params for GET filters
- Return created/updated objects in responses`
        }
      ]
    },

    // Product Overview (All roles)
    {
      id: 'product-101',
      title: 'Product Overview',
      description: 'Understanding Piston Labs products and value proposition',
      role: 'all',
      category: 'Product',
      order: 0,
      estimatedMinutes: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: 'product-101-overview',
          title: 'What We Build',
          type: 'reading',
          order: 1,
          content: `# Piston Labs Product Overview

## Mission
**Make predictive maintenance accessible to every business.**

## Products

### 1. Equipment Monitoring Platform
- Real-time telemetry from industrial equipment
- Predictive failure alerts
- Maintenance scheduling

### 2. Fleet Tracking
- GPS location for service vehicles
- Driver behavior monitoring
- Route optimization

### 3. Agent Coordination Hub
- AI agent collaboration platform
- Multi-model orchestration
- Real-time team visibility

## Competitive Advantages
1. **Price** - 60% less than enterprise solutions
2. **Setup** - Deploy in hours, not months
3. **Flexibility** - Works with existing equipment
4. **AI-Powered** - Predictive, not just monitoring`
        }
      ]
    }
  ];
}

/**
 * Training API - Self-Optimizing Learning System
 *
 * GET /api/training - List modules (optionally filtered by role)
 * GET /api/training?module=X - Get specific module with lessons
 * GET /api/training?user=X&progress=true - Get user's progress
 * GET /api/training?user=X&adaptive=true - Get adaptive learning state
 * GET /api/training?user=X&reviews=true - Get lessons due for review (spaced repetition)
 * GET /api/training?simulations=list - List available interview scenarios
 * GET /api/training?simulation=X - Get simulation details
 * POST /api/training - Mark lesson complete / submit quiz
 * POST /api/training?action=simulate - Start/continue interview simulation
 * POST /api/training?action=endSimulation - End and score simulation
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List modules or get progress
    if (req.method === 'GET') {
      const { role, module: moduleId, user, progress, adaptive, reviews, simulations, simulation } = req.query;

      // List available simulation scenarios
      if (simulations === 'list') {
        const scenarios = Object.entries(INTERVIEW_SCENARIOS).map(([id, data]) => ({
          id,
          title: data.title,
          objectives: data.objectives
        }));
        return res.json({ scenarios, count: scenarios.length });
      }

      // Get specific simulation
      if (simulation && typeof simulation === 'string') {
        const sim = await redis.hget(TRAINING_SIMULATIONS_KEY, simulation);
        if (!sim) {
          return res.status(404).json({ error: 'Simulation not found' });
        }
        return res.json({ simulation: typeof sim === 'string' ? JSON.parse(sim) : sim });
      }

      // Get user's adaptive learning state
      if (user && adaptive === 'true') {
        const adaptiveKey = `${TRAINING_ADAPTIVE_KEY}:${user}`;
        const state = await redis.get(adaptiveKey);

        if (!state) {
          // Initialize new adaptive state
          const newState: AdaptiveLearningState = {
            userId: user as string,
            overallScore: 0,
            totalQuizzes: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            difficultyLevel: 'beginner',
            lessonReviews: {},
            learningPatterns: {
              preferredContentType: 'reading',
              avgTimePerLesson: 0,
              peakLearningHour: 9,
              streakDays: 0
            },
            updatedAt: new Date().toISOString()
          };
          await redis.set(adaptiveKey, JSON.stringify(newState));
          return res.json({ adaptive: newState });
        }

        return res.json({ adaptive: typeof state === 'string' ? JSON.parse(state) : state });
      }

      // Get lessons due for review (spaced repetition)
      if (user && reviews === 'true') {
        const adaptiveKey = `${TRAINING_ADAPTIVE_KEY}:${user}`;
        const state = await redis.get(adaptiveKey);

        if (!state) {
          return res.json({ dueForReview: [], count: 0 });
        }

        const adaptiveState: AdaptiveLearningState = typeof state === 'string' ? JSON.parse(state) : state;
        const now = new Date();
        const dueForReview: { lessonId: string; daysOverdue: number; lastScore: number }[] = [];

        for (const [lessonId, review] of Object.entries(adaptiveState.lessonReviews)) {
          const nextReview = new Date(review.nextReviewDate);
          if (nextReview <= now) {
            const daysOverdue = Math.floor((now.getTime() - nextReview.getTime()) / (1000 * 60 * 60 * 24));
            dueForReview.push({ lessonId, daysOverdue, lastScore: review.lastScore });
          }
        }

        // Sort by most overdue first
        dueForReview.sort((a, b) => b.daysOverdue - a.daysOverdue);

        return res.json({
          dueForReview,
          count: dueForReview.length,
          difficultyLevel: adaptiveState.difficultyLevel,
          streakDays: adaptiveState.learningPatterns.streakDays
        });
      }

      // Get user progress
      if (user && progress === 'true') {
        const progressKey = `${TRAINING_PROGRESS_KEY}:${user}`;
        const userProgress = await redis.hgetall(progressKey) || {};

        const progressList: UserProgress[] = Object.values(userProgress).map(
          p => typeof p === 'string' ? JSON.parse(p) : p
        );

        // Calculate completion stats
        const modules = getDefaultModules();
        const stats = modules.map(mod => {
          const totalLessons = mod.lessons.length;
          const completedLessons = progressList.filter(
            p => p.moduleId === mod.id && p.completed
          ).length;
          return {
            moduleId: mod.id,
            title: mod.title,
            totalLessons,
            completedLessons,
            percentComplete: Math.round((completedLessons / totalLessons) * 100)
          };
        });

        return res.json({
          user,
          progress: progressList,
          stats,
          totalModules: modules.length,
          completedModules: stats.filter(s => s.percentComplete === 100).length
        });
      }

      // Get specific module
      if (moduleId) {
        const modules = getDefaultModules();
        const mod = modules.find(m => m.id === moduleId);
        if (!mod) {
          return res.status(404).json({ error: 'Module not found' });
        }
        return res.json({ module: mod });
      }

      // List all modules (optionally filtered by role)
      let modules = getDefaultModules();

      if (role && typeof role === 'string') {
        modules = modules.filter(m => m.role === role || m.role === 'all');
      }

      // Sort by order
      modules.sort((a, b) => a.order - b.order);

      // Return summary (without full lesson content)
      const summary = modules.map(m => ({
        id: m.id,
        title: m.title,
        description: m.description,
        role: m.role,
        category: m.category,
        lessonCount: m.lessons.length,
        estimatedMinutes: m.estimatedMinutes
      }));

      return res.json({
        modules: summary,
        count: summary.length,
        roles: ['sales', 'developer', 'investor', 'all']
      });
    }

    // POST - Mark progress
    if (req.method === 'POST') {
      const { user, moduleId, lessonId, completed, quizAnswers } = req.body;

      if (!user || !moduleId || !lessonId) {
        return res.status(400).json({ error: 'user, moduleId, and lessonId required' });
      }

      // Validate module and lesson exist
      const modules = getDefaultModules();
      const mod = modules.find(m => m.id === moduleId);
      if (!mod) {
        return res.status(404).json({ error: 'Module not found' });
      }
      const lesson = mod.lessons.find(l => l.id === lessonId);
      if (!lesson) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      const progressKey = `${TRAINING_PROGRESS_KEY}:${user}`;
      const progressId = `${moduleId}:${lessonId}`;

      // Handle quiz submission
      let score: number | undefined;
      let quizResults: any[] | undefined;
      let adaptiveUpdate: Partial<AdaptiveLearningState> | undefined;

      if (lesson.type === 'quiz' && quizAnswers && lesson.quiz) {
        quizResults = lesson.quiz.map((q, i) => ({
          question: q.question,
          correct: quizAnswers[i] === q.correctIndex,
          yourAnswer: q.options[quizAnswers[i]],
          correctAnswer: q.options[q.correctIndex],
          explanation: q.explanation
        }));
        const correctCount = quizResults.filter(r => r.correct).length;
        score = Math.round((correctCount / lesson.quiz.length) * 100);

        // Update adaptive learning state
        const adaptiveKey = `${TRAINING_ADAPTIVE_KEY}:${user}`;
        const existingState = await redis.get(adaptiveKey);
        let adaptiveState: AdaptiveLearningState = existingState
          ? (typeof existingState === 'string' ? JSON.parse(existingState) : existingState)
          : {
              userId: user as string,
              overallScore: 0,
              totalQuizzes: 0,
              totalCorrect: 0,
              totalQuestions: 0,
              difficultyLevel: 'beginner' as const,
              lessonReviews: {},
              learningPatterns: {
                preferredContentType: 'reading' as const,
                avgTimePerLesson: 0,
                peakLearningHour: new Date().getHours(),
                streakDays: 0
              },
              updatedAt: new Date().toISOString()
            };

        // Update performance metrics
        adaptiveState.totalQuizzes++;
        adaptiveState.totalCorrect += correctCount;
        adaptiveState.totalQuestions += lesson.quiz.length;
        adaptiveState.overallScore = Math.round(
          (adaptiveState.totalCorrect / adaptiveState.totalQuestions) * 100
        );

        // Update difficulty level
        adaptiveState.difficultyLevel = calculateDifficultyLevel(
          adaptiveState.overallScore,
          adaptiveState.totalQuizzes
        );

        // Calculate spaced repetition for this lesson
        const quality = scoreToQuality(score);
        const existingReview = adaptiveState.lessonReviews[lessonId] || {
          easeFactor: 2.5,
          interval: 1,
          repetitions: 0,
          nextReviewDate: new Date().toISOString(),
          lastScore: 0
        };

        const newReview = calculateSpacedRepetition(
          existingReview.easeFactor,
          existingReview.interval,
          existingReview.repetitions,
          quality
        );

        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + newReview.interval);

        adaptiveState.lessonReviews[lessonId] = {
          easeFactor: newReview.easeFactor,
          interval: newReview.interval,
          repetitions: newReview.repetitions,
          nextReviewDate: nextReviewDate.toISOString(),
          lastScore: score
        };

        // Track learning patterns (peak hour)
        const currentHour = new Date().getHours();
        adaptiveState.learningPatterns.peakLearningHour = currentHour;

        adaptiveState.updatedAt = new Date().toISOString();
        await redis.set(adaptiveKey, JSON.stringify(adaptiveState));

        adaptiveUpdate = {
          difficultyLevel: adaptiveState.difficultyLevel,
          overallScore: adaptiveState.overallScore,
          nextReviewDate: nextReviewDate.toISOString()
        };
      }

      // Get existing progress
      const existing = await redis.hget(progressKey, progressId);
      const prev = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null;

      const progress: UserProgress = {
        oderId: user,
        moduleId,
        lessonId,
        completed: completed ?? true,
        score,
        completedAt: new Date().toISOString(),
        attempts: (prev?.attempts || 0) + 1
      };

      await redis.hset(progressKey, { [progressId]: JSON.stringify(progress) });

      // Check if module is now complete
      const allProgress = await redis.hgetall(progressKey) || {};
      const moduleProgress = Object.entries(allProgress)
        .filter(([key]) => key.startsWith(moduleId))
        .map(([, v]) => typeof v === 'string' ? JSON.parse(v) : v);

      const moduleComplete = mod.lessons.every(
        l => moduleProgress.some(p => p.lessonId === l.id && p.completed)
      );

      // Post to chat if module completed
      if (moduleComplete) {
        const chatMessage = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
          author: 'system',
          authorType: 'system',
          message: `🎓 **${user}** completed training module: **${mod.title}**!`,
          timestamp: new Date().toISOString(),
          reactions: []
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
      }

      return res.json({
        success: true,
        progress,
        quizResults,
        moduleComplete,
        adaptiveUpdate,
        message: moduleComplete
          ? `Congratulations! You completed "${mod.title}"!`
          : `Progress saved for "${lesson.title}"`
      });
    }

    // POST - Start/continue interview simulation
    if (req.method === 'POST') {
      const { action } = req.query;

      if (action === 'simulate') {
        const { user, scenario, message: userMessage, simulationId } = req.body;

        if (!user) {
          return res.status(400).json({ error: 'user required' });
        }

        // Continue existing simulation
        if (simulationId) {
          const existing = await redis.hget(TRAINING_SIMULATIONS_KEY, simulationId);
          if (!existing) {
            return res.status(404).json({ error: 'Simulation not found' });
          }

          const simulation: InterviewSimulation = typeof existing === 'string'
            ? JSON.parse(existing)
            : existing;

          if (simulation.status !== 'in-progress') {
            return res.status(400).json({ error: 'Simulation already completed' });
          }

          // Add user message
          simulation.messages.push({
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString()
          });

          // Generate prospect response (placeholder - would use AI in production)
          const scenarioData = INTERVIEW_SCENARIOS[simulation.scenario];
          const prospectResponse = generateProspectResponse(simulation, scenarioData);

          simulation.messages.push({
            role: 'prospect',
            content: prospectResponse.message,
            timestamp: new Date().toISOString(),
            feedback: prospectResponse.feedback
          });

          await redis.hset(TRAINING_SIMULATIONS_KEY, { [simulationId]: JSON.stringify(simulation) });

          return res.json({
            success: true,
            simulation,
            prospectMessage: prospectResponse.message,
            feedback: prospectResponse.feedback
          });
        }

        // Start new simulation
        if (!scenario || !INTERVIEW_SCENARIOS[scenario as keyof typeof INTERVIEW_SCENARIOS]) {
          return res.status(400).json({
            error: 'Valid scenario required',
            scenarios: Object.keys(INTERVIEW_SCENARIOS)
          });
        }

        const scenarioData = INTERVIEW_SCENARIOS[scenario as keyof typeof INTERVIEW_SCENARIOS];
        const newSimulation: InterviewSimulation = {
          id: `sim-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          userId: user,
          scenario: scenario as InterviewSimulation['scenario'],
          difficulty: 'medium',
          status: 'in-progress',
          messages: [
            {
              role: 'system',
              content: scenarioData.systemPrompt,
              timestamp: new Date().toISOString()
            },
            {
              role: 'prospect',
              content: getOpeningLine(scenario as string),
              timestamp: new Date().toISOString()
            }
          ],
          scores: { rapport: 0, discovery: 0, valueProposition: 0, objectionHandling: 0, closing: 0 },
          overallScore: 0,
          feedback: '',
          startedAt: new Date().toISOString()
        };

        await redis.hset(TRAINING_SIMULATIONS_KEY, { [newSimulation.id]: JSON.stringify(newSimulation) });

        return res.json({
          success: true,
          simulation: newSimulation,
          objectives: scenarioData.objectives,
          message: `Started ${scenarioData.title}. The prospect says: "${newSimulation.messages[1].content}"`
        });
      }

      if (action === 'endSimulation') {
        const { simulationId } = req.body;

        if (!simulationId) {
          return res.status(400).json({ error: 'simulationId required' });
        }

        const existing = await redis.hget(TRAINING_SIMULATIONS_KEY, simulationId);
        if (!existing) {
          return res.status(404).json({ error: 'Simulation not found' });
        }

        const simulation: InterviewSimulation = typeof existing === 'string'
          ? JSON.parse(existing)
          : existing;

        // Score the simulation
        const scored = scoreSimulation(simulation);
        simulation.scores = scored.scores;
        simulation.overallScore = scored.overallScore;
        simulation.feedback = scored.feedback;
        simulation.status = 'completed';
        simulation.completedAt = new Date().toISOString();

        await redis.hset(TRAINING_SIMULATIONS_KEY, { [simulationId]: JSON.stringify(simulation) });

        // Post to chat if score is high
        if (simulation.overallScore >= 80) {
          const chatMessage = {
            id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
            author: 'system',
            authorType: 'system',
            message: `🎯 **${simulation.userId}** scored ${simulation.overallScore}% on ${INTERVIEW_SCENARIOS[simulation.scenario].title}!`,
            timestamp: new Date().toISOString(),
            reactions: []
          };
          await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        }

        return res.json({
          success: true,
          simulation,
          message: `Simulation completed with score: ${simulation.overallScore}%`
        });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Training API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
