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
 * Get opening line for interview scenario
 */
function getOpeningLine(scenario: string): string {
  const openings: Record<string, string> = {
    'cold-call': "Hello? ... Yes, who is this? I'm in the middle of something.",
    'discovery': "Hi, thanks for calling. I have about 25 minutes before my next meeting. What did you want to discuss?",
    'objection-handling': "Look, I like what you're showing me, but I have some serious concerns we need to address before I can move forward.",
    'demo': "Okay, I'm ready to see the demo. Just so you know, I've seen a lot of these platforms and most of them overpromise.",
    'closing': "So, I've seen the demo and talked to my team. We're interested, but I'm not sure we're ready to sign anything today."
  };
  return openings[scenario] || "Hello, how can I help you?";
}

/**
 * Generate prospect response based on conversation context
 * In production, this would use Claude API for realistic responses
 */
function generateProspectResponse(
  simulation: InterviewSimulation,
  _scenarioData: { systemPrompt: string; objectives: string[] }
): { message: string; feedback: string } {
  const lastUserMessage = simulation.messages
    .filter(m => m.role === 'user')
    .pop()?.content || '';

  const messageCount = simulation.messages.filter(m => m.role === 'user').length;

  // Simple response generation based on keywords and conversation stage
  // In production, this would call Claude API with the systemPrompt as context

  let message = '';
  let feedback = '';

  const lowerMessage = lastUserMessage.toLowerCase();

  // Check for good behaviors and provide feedback
  if (lowerMessage.includes('?')) {
    feedback = 'Good - asking questions shows curiosity and helps with discovery.';
  }

  if (lowerMessage.includes('understand') || lowerMessage.includes('tell me more')) {
    feedback = 'Excellent - showing genuine interest in their situation builds rapport.';
  }

  if (lowerMessage.includes('cost') || lowerMessage.includes('save') || lowerMessage.includes('roi')) {
    feedback = 'Good - connecting to business value. Make sure to quantify when possible.';
  }

  // Generate contextual responses based on scenario and stage
  // messageCount = 1 means first response, 2 means second, etc.
  if (simulation.scenario === 'cold-call') {
    if (messageCount === 1) {
      message = "I really don't have time for sales calls. What company did you say you're with?";
      if (!feedback) feedback = 'Tip: Acknowledge their time is valuable before pitching.';
    } else if (messageCount === 2) {
      message = "Okay, you have 30 seconds. What do you do?";
      if (!feedback) feedback = 'Now deliver a concise value proposition focused on their problems.';
    } else if (messageCount === 3) {
      message = "That's interesting. We do have issues with our compressors going down unexpectedly. But how is your solution different from just hiring more maintenance staff?";
      if (!feedback) feedback = 'They showed interest! Now differentiate your solution.';
    } else if (messageCount === 4) {
      message = "Hmm, I'd want to see some proof. Do you have case studies from other manufacturers?";
      if (!feedback) feedback = 'They want validation - provide social proof and specific results.';
    } else {
      message = "Alright, I'm intrigued. Send me some information and maybe we can schedule a proper call next week.";
      if (!feedback) feedback = 'Great progress! Now confirm the next step and get commitment.';
    }
  } else if (simulation.scenario === 'discovery') {
    if (messageCount === 1) {
      message = "Our biggest issue right now is unexpected equipment failures. Last month we had a refrigeration unit go down and lost $40,000 in product.";
      if (!feedback) feedback = 'They shared a pain point with specific numbers - use this!';
    } else if (messageCount === 2) {
      message = "We have 5 maintenance techs. They're reactive mostly - fixing things when they break. We tried to implement a PM schedule but it's hard to stick to.";
      if (!feedback) feedback = 'Understanding their current process helps you position your solution.';
    } else if (messageCount === 3) {
      message = "Budget? We spend about $200K a year on maintenance and repairs. But getting new budget approved is tough right now.";
      if (!feedback) feedback = 'Good discovery! Now tie your solution to their existing budget pain.';
    } else if (messageCount === 4) {
      message = "Decision making? Usually it's me and my VP of Operations. For anything over $50K, the CFO gets involved too.";
      if (!feedback) feedback = 'Key info about buying process - plan your next steps accordingly.';
    } else {
      message = "What would a pilot look like? I'd be interested if we could start small and prove the value first.";
      if (!feedback) feedback = 'Excellent! They want a pilot - scope it appropriately.';
    }
  } else if (simulation.scenario === 'objection-handling') {
    if (messageCount === 1) {
      message = "My IT team is already stretched thin. They're worried about security and having another system to manage.";
      if (!feedback) feedback = 'Address their IT concerns with specific security features and ease of management.';
    } else if (messageCount === 2) {
      message = "Okay, that helps with the security side. But even if I wanted to, we're in a budget freeze until Q2. My hands are tied.";
      if (!feedback) feedback = 'Budget freeze objection - explore pilot programs or ROI-based approaches.';
    } else if (messageCount === 3) {
      message = "A pilot could work... but I'll be honest - my boss doesn't believe in this 'predictive AI' stuff. He thinks it's hype.";
      if (!feedback) feedback = 'Use case studies and concrete examples to address skepticism.';
    } else if (messageCount === 4) {
      message = "Those results are impressive. Let me talk to him. What kind of guarantee do you offer?";
      if (!feedback) feedback = 'They want risk reduction - explain your guarantee or pilot terms.';
    } else {
      message = "Alright, you've addressed my concerns. Let's set up a meeting with my boss next week.";
      if (!feedback) feedback = 'Success! You handled the objections. Now lock in that meeting.';
    }
  } else if (simulation.scenario === 'demo') {
    if (messageCount === 1) {
      message = "How long does installation take? We can't afford a lot of downtime.";
      if (!feedback) feedback = 'Technical question - be specific about installation process and timeline.';
    } else if (messageCount === 2) {
      message = "What happens if a sensor fails? Do we lose data?";
      if (!feedback) feedback = 'Good question about reliability - explain redundancy and support.';
    } else if (messageCount === 3) {
      message = "This looks good on screen, but how do my technicians actually use it day-to-day? They're not very tech-savvy.";
      if (!feedback) feedback = 'User adoption concern - show ease of use and training support.';
    } else if (messageCount === 4) {
      message = "What about integration with our CMMS? We use Fiix for work orders.";
      if (!feedback) feedback = 'Integration question - explain your API and existing integrations.';
    } else {
      message = "I like what I see. What would pricing look like for 50 pieces of equipment?";
      if (!feedback) feedback = 'Buying signal! Transition from demo to pricing discussion carefully.';
    }
  } else if (simulation.scenario === 'closing') {
    if (messageCount === 1) {
      message = "I need to run this by my boss. She makes all the final decisions on vendors.";
      if (!feedback) feedback = 'Identify the decision maker and offer to present to them directly.';
    } else if (messageCount === 2) {
      message = "The proposal is for 50 sensors but I was thinking we should start smaller. Maybe 10 units on our most critical equipment.";
      if (!feedback) feedback = 'They want to start small - this is a buying signal. Accommodate while protecting value.';
    } else if (messageCount === 3) {
      message = "Look, I'm being honest - you're not the only vendor we're looking at. What makes you different?";
      if (!feedback) feedback = 'Competitive situation - focus on unique differentiators, not price.';
    } else if (messageCount === 4) {
      message = "Your support model is better, I'll give you that. What about implementation timeline?";
      if (!feedback) feedback = "They're comparing - emphasize your implementation advantages.";
    } else {
      message = "Okay, I think we can move forward. Can you send over a revised proposal for the pilot?";
      if (!feedback) feedback = 'They want to buy! Confirm next steps and timeline for proposal.';
    }
  } else {
    message = "Tell me more about that.";
    if (!feedback) feedback = 'Keep the conversation going with more specific questions.';
  }

  return { message, feedback };
}

/**
 * Score a completed interview simulation
 */
function scoreSimulation(simulation: InterviewSimulation): {
  scores: InterviewSimulation['scores'];
  overallScore: number;
  feedback: string;
} {
  const userMessages = simulation.messages.filter(m => m.role === 'user');
  const messageCount = userMessages.length;

  // Score based on various factors
  let rapport = 50;
  let discovery = 50;
  let valueProposition = 50;
  let objectionHandling = 50;
  let closing = 50;

  const allUserText = userMessages.map(m => m.content.toLowerCase()).join(' ');

  // Rapport - built through questions and acknowledgment
  const questionCount = (allUserText.match(/\?/g) || []).length;
  rapport += Math.min(questionCount * 5, 30);
  if (allUserText.includes('understand') || allUserText.includes('appreciate')) rapport += 10;
  if (allUserText.includes('thank')) rapport += 5;

  // Discovery - asking about their situation
  if (allUserText.includes('tell me') || allUserText.includes('how do you')) discovery += 15;
  if (allUserText.includes('challenge') || allUserText.includes('problem')) discovery += 10;
  if (allUserText.includes('budget') || allUserText.includes('timeline')) discovery += 10;
  if (allUserText.includes('decision') || allUserText.includes('process')) discovery += 10;

  // Value Proposition - clear explanation of benefits
  if (allUserText.includes('reduce') || allUserText.includes('save')) valueProposition += 15;
  if (allUserText.includes('roi') || allUserText.includes('return')) valueProposition += 10;
  if (allUserText.includes('predict') || allUserText.includes('prevent')) valueProposition += 10;
  if (allUserText.includes('customer') || allUserText.includes('client')) valueProposition += 5;

  // Objection Handling - addressing concerns
  if (allUserText.includes('security') || allUserText.includes('secure')) objectionHandling += 10;
  if (allUserText.includes('support') || allUserText.includes('help')) objectionHandling += 10;
  if (allUserText.includes('pilot') || allUserText.includes('trial')) objectionHandling += 15;
  if (allUserText.includes('case study') || allUserText.includes('example')) objectionHandling += 10;

  // Closing - asking for commitment
  if (allUserText.includes('next step') || allUserText.includes('move forward')) closing += 20;
  if (allUserText.includes('schedule') || allUserText.includes('meeting')) closing += 10;
  if (allUserText.includes('sign') || allUserText.includes('start')) closing += 10;

  // Penalty for too few messages (didn't engage enough)
  if (messageCount < 3) {
    rapport -= 20;
    discovery -= 20;
  }

  // Cap scores at 100
  rapport = Math.min(100, Math.max(0, rapport));
  discovery = Math.min(100, Math.max(0, discovery));
  valueProposition = Math.min(100, Math.max(0, valueProposition));
  objectionHandling = Math.min(100, Math.max(0, objectionHandling));
  closing = Math.min(100, Math.max(0, closing));

  const overallScore = Math.round((rapport + discovery + valueProposition + objectionHandling + closing) / 5);

  // Generate feedback
  let feedback = '';
  const scores = { rapport, discovery, valueProposition, objectionHandling, closing };
  const lowestScore = Math.min(...Object.values(scores));
  const lowestArea = Object.entries(scores).find(([, v]) => v === lowestScore)?.[0];

  if (overallScore >= 80) {
    feedback = `Excellent performance! You demonstrated strong sales skills across all areas. `;
  } else if (overallScore >= 60) {
    feedback = `Good effort! You showed competence in several areas. `;
  } else {
    feedback = `This was a learning experience. Don't be discouraged - sales skills improve with practice. `;
  }

  // Add specific improvement suggestion
  switch (lowestArea) {
    case 'rapport':
      feedback += 'Focus on building more rapport by asking about their situation and acknowledging their challenges before pitching.';
      break;
    case 'discovery':
      feedback += 'Work on asking more discovery questions to understand their pain points, budget, and decision process.';
      break;
    case 'valueProposition':
      feedback += 'Practice articulating the ROI and specific benefits more clearly. Use numbers and case studies.';
      break;
    case 'objectionHandling':
      feedback += 'Prepare for common objections with specific responses. Address concerns directly rather than deflecting.';
      break;
    case 'closing':
      feedback += 'Don\'t be afraid to ask for the next step. Practice clear calls-to-action and commitment requests.';
      break;
  }

  return {
    scores: { rapport, discovery, valueProposition, objectionHandling, closing },
    overallScore,
    feedback
  };
}

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

    // POST - Handle various training actions
    if (req.method === 'POST') {
      const { action } = req.query;

      // Handle interview simulation actions first
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

          // Generate prospect response
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

      // Default: Mark lesson progress
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
      let adaptiveUpdate: { difficultyLevel: string; overallScore: number; nextReviewDate: string } | undefined;

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
        userId: user,
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

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Training API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
