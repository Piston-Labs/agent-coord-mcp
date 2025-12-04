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
 * Updated for Piston Labs two-sided marketplace: consumers buy devices, shops subscribe to SaaS dashboard
 */
const INTERVIEW_SCENARIOS = {
  'cold-call': {
    title: 'Cold Call - Auto Shop Owner (SaaS Pitch)',
    systemPrompt: `You're a busy auto repair shop owner with 3 bays and 2 technicians. You get sales calls all the time. Your pain points: customers forget about oil changes and don't come back, you have no way to remind them, and the big chains (Jiffy Lube, Firestone) are taking your customers with their reminder systems. You've never heard of Piston Labs. Start dismissive but warm up if they talk about customer retention.`,
    objectives: ['Build rapport with busy shop owner', 'Identify customer retention pain points', 'Explain the consumer device + shop dashboard model', 'Schedule a demo']
  },
  'discovery': {
    title: 'Discovery Call - Shop Interested in CRM',
    systemPrompt: `You own an independent auto shop and agreed to a call because customer retention is your biggest problem. You do great work but customers forget about you between visits. You've tried sending postcards but it's expensive and you never know if they work. You want something automated. Ask how the system knows when customers need service.`,
    objectives: ['Understand their current customer communication', 'Explain how device telemetry enables smart reminders', 'Show how the shop dashboard works', 'Qualify for pilot program']
  },
  'objection-handling': {
    title: 'Objection Handling - Shop Concerns',
    systemPrompt: `You're interested in the Piston Labs dashboard but have concerns: 1) How do customers get the devices? You don't want to sell hardware. 2) What if customers don't want to share their data? 3) You already have a basic customer database - why pay for another system? Raise these objections one at a time.`,
    objectives: ['Explain consumers buy devices independently', 'Address data privacy and consumer control', 'Show value beyond basic customer database', 'Demonstrate ROI from automated reminders']
  },
  'demo': {
    title: 'Product Demo - Shop Dashboard',
    systemPrompt: `You're watching a demo of the Piston Labs shop dashboard. You want to see: How do I see which customers need oil changes soon? How do automated reminders work? Can I send marketing campaigns? What does the customer see on their end? How much does this cost per month? Be engaged but ask practical questions.`,
    objectives: ['Show customer list with vehicle data', 'Demonstrate automated reminder system', 'Show marketing campaign features', 'Explain pricing tiers']
  },
  'closing': {
    title: 'Closing - Dashboard Subscription',
    systemPrompt: `You've seen the demo and like the idea. But you're hesitant: What if none of your customers have the device? Is there a free trial? You need to think about it. Your spouse helps with the business and needs to see it too. Push back but be persuadable with a good trial offer and onboarding help.`,
    objectives: ['Explain network growth and customer acquisition', 'Offer free trial or pilot period', 'Address spouse/partner involvement', 'Get commitment to start trial']
  }
};

/**
 * Get opening line for interview scenario
 */
function getOpeningLine(scenario: string): string {
  const openings: Record<string, string> = {
    'cold-call': "Yeah, this is Mike's Auto... hold on, I got a customer. *pause* Okay, what do you need? I'm pretty busy here.",
    'discovery': "Hey, thanks for calling back. Yeah, my problem is customers just don't come back. We do good work but they forget about us. What've you got?",
    'objection-handling': "Alright, I've been thinking about your dashboard thing. I like the idea of automated reminders but I have some questions.",
    'demo': "Okay, show me how this works. I want to see how I'd actually use this to get customers to come back more often.",
    'closing': "Look, I showed this to my wife - she handles the books. She likes it but we're wondering about the trial and how many of our customers would actually have the device."
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
      message = "Look, I get calls like this all the time. We're a small shop - we don't need another software subscription.";
      if (!feedback) feedback = 'Tip: Acknowledge they are busy. Ask about their biggest challenge with repeat customers.';
    } else if (messageCount === 2) {
      message = "Customer retention? I mean yeah, that's always an issue. People get their oil change and then you never see them again.";
      if (!feedback) feedback = 'They acknowledged the pain point! Dig deeper - ask how they currently try to bring customers back.';
    } else if (messageCount === 3) {
      message = "We send postcards sometimes but who knows if they work. It's expensive and feels like throwing money away.";
      if (!feedback) feedback = 'Great discovery! Contrast postcards with automated, data-driven reminders.';
    } else if (messageCount === 4) {
      message = "Wait, so the customer has a device in their car and you can tell when they need service? How does that work exactly?";
      if (!feedback) feedback = 'They are curious! Explain the consumer device + shop dashboard model simply.';
    } else {
      message = "Huh, that's actually pretty interesting. Send me some info - I'll look at it when things slow down.";
      if (!feedback) feedback = 'Good progress! Push for a specific follow-up time instead of just sending info.';
    }
  } else if (simulation.scenario === 'discovery') {
    if (messageCount === 1) {
      message = "Yeah exactly. We do good work but customers just disappear. The chains like Jiffy Lube have those reminder systems - how do I compete with that?";
      if (!feedback) feedback = 'Key pain point! Empathize and position Piston as the solution for independent shops.';
    } else if (messageCount === 2) {
      message = "Right now I keep a spreadsheet with customer info but honestly I never have time to call people or send reminders.";
      if (!feedback) feedback = 'Manual process with no follow-through - this is exactly what automation solves.';
    } else if (messageCount === 3) {
      message = "So the system automatically knows when someone needs an oil change based on their actual mileage? Not just guessing at 3 months?";
      if (!feedback) feedback = 'They understand the value of real data! Confirm and explain how telemetry beats guesswork.';
    } else if (messageCount === 4) {
      message = "What do you mean the customer buys the device? I don't want to be selling hardware to my customers.";
      if (!feedback) feedback = 'Important clarification! Explain consumers buy devices independently - shops just subscribe to dashboard.';
    } else {
      message = "Okay that makes more sense. So I just get the dashboard and any customer who has the device can connect with my shop?";
      if (!feedback) feedback = 'They get it! Confirm the model and move toward a trial conversation.';
    }
  } else if (simulation.scenario === 'objection-handling') {
    if (messageCount === 1) {
      message = "My first question - how do my customers even get these devices? I'm not going to sell gadgets. That's not my business.";
      if (!feedback) feedback = 'Address the business model concern - shops don\'t sell devices, consumers buy them directly.';
    } else if (messageCount === 2) {
      message = "Okay but what if my customers don't want some device tracking them? People are private about that stuff.";
      if (!feedback) feedback = 'Data privacy objection - emphasize consumer control and opt-in connection with shops.';
    } else if (messageCount === 3) {
      message = "I already have a customer database in my shop management software. Why do I need another system?";
      if (!feedback) feedback = 'Differentiate from basic database - Piston has real-time mileage data and automated outreach.';
    } else if (messageCount === 4) {
      message = "What if none of my current customers have the device? Then I'm paying for nothing.";
      if (!feedback) feedback = 'Chicken-and-egg concern - explain network growth and how to seed with existing customers.';
    } else {
      message = "Alright, those are fair points. What does the dashboard actually cost per month?";
      if (!feedback) feedback = 'Buying signal! They want pricing - present tiers clearly with ROI framing.';
    }
  } else if (simulation.scenario === 'demo') {
    if (messageCount === 1) {
      message = "So this is the dashboard? Show me how I see which of my customers need service soon.";
      if (!feedback) feedback = 'Show the customer list sorted by upcoming service needs based on mileage.';
    } else if (messageCount === 2) {
      message = "Okay I see the list. But how do the reminders actually go out? Do I have to send them manually?";
      if (!feedback) feedback = 'Show the automated reminder setup - set rules once, system sends automatically.';
    } else if (messageCount === 3) {
      message = "Can I send promotions too? Like a winter special for tire checks or something?";
      if (!feedback) feedback = 'Great question! Show marketing campaign feature and targeting options.';
    } else if (messageCount === 4) {
      message = "What does the customer see on their end? Do they get an app notification or what?";
      if (!feedback) feedback = 'Show the consumer experience - app notification, service history, appointment booking.';
    } else {
      message = "This is pretty slick. What's the monthly cost and is there a contract?";
      if (!feedback) feedback = 'Buying signal! Present pricing (monthly, no contract) and push for trial.';
    }
  } else if (simulation.scenario === 'closing') {
    if (messageCount === 1) {
      message = "Yeah so my wife and I talked about it. We like the automated reminders but we're worried - what if we sign up and none of our customers have the device?";
      if (!feedback) feedback = 'Valid concern - explain how to seed network: offer devices to loyal customers or promote to new ones.';
    } else if (messageCount === 2) {
      message = "Is there a free trial? I don't want to pay if I'm not sure it'll work for our shop.";
      if (!feedback) feedback = 'Trial request - offer pilot period and explain what success looks like.';
    } else if (messageCount === 3) {
      message = "How long until we'd actually see customers coming back because of the reminders?";
      if (!feedback) feedback = 'Set realistic expectations - first reminders go out within weeks of customers connecting.';
    } else if (messageCount === 4) {
      message = "Okay, and if we want to cancel after the trial we can just stop? No penalties?";
      if (!feedback) feedback = 'Confirm no-contract, month-to-month terms. Remove all risk.';
    } else {
      message = "Alright, let's try the trial. What do I need to do to get started?";
      if (!feedback) feedback = 'They said yes! Walk through onboarding: account setup, connect first customers, set reminder rules.';
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
 * Default training modules - Updated for Piston Labs two-sided marketplace
 * Consumers buy devices, shops subscribe to SaaS dashboard
 */
function getDefaultModules(): TrainingModule[] {
  return [
    // Sales Track
    {
      id: 'sales-101',
      title: 'Sales Training - Shop Dashboard',
      description: 'Foundation training for selling the Piston Labs shop dashboard SaaS to auto repair shops',
      role: 'sales',
      category: 'Onboarding',
      order: 1,
      estimatedMinutes: 120,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: 'sales-101-icp',
          title: 'Understanding Our Two Customer Types',
          type: 'reading',
          order: 1,
          content: `# Piston Labs Has Two Customer Types

## 1. Consumers (Device Buyers)
People who buy and install OBD-II devices in their cars:
- **Car owners** wanting to track their vehicle's health and mileage
- **Parents** monitoring teen drivers
- **Used car buyers** wanting maintenance history that follows the car
- **DIY mechanics** who want data on their vehicles

## 2. Auto Repair Shops (SaaS Subscribers)
Shops that subscribe to our dashboard:
- **Independent repair shops** struggling with customer retention
- **Multi-location shops** needing centralized customer data
- **Shops** wanting to compete with chain reminder systems (Jiffy Lube, etc.)
- **Forward-thinking owners** who want to automate marketing

## The Magic: Network Effects
- Consumers create the telemetry network by buying devices
- Shops pay for access to engage with customers on the network
- More consumers = more value for shops
- More shops = more value for consumers (appointment booking, find trusted shops)

## Key Shop Pain Points
1. **Customer retention** - People get one oil change and never come back
2. **No reminder system** - Can't compete with chain stores' automated outreach
3. **Manual processes** - Keeping spreadsheets, sending postcards
4. **No customer insight** - Don't know actual mileage or service needs`
        },
        {
          id: 'sales-101-pitch',
          title: 'The Shop Pitch',
          type: 'reading',
          order: 2,
          content: `# The Elevator Pitch for Auto Shops

> "Turn every oil change into a lifetime customer."

## Full Pitch Structure

### 1. Problem (30 sec)
"Your biggest competitor isn't the shop down the street - it's forgetting. Customers come in for an oil change, you do great work, and then they never come back because they forgot about you."

### 2. Solution (30 sec)
"Piston Labs connects you with customers who have our telemetry device in their car. You see their actual mileage and service needs, and the system automatically sends reminders when they're due. No more postcards that go in the trash."

### 3. Proof (30 sec)
"Shops using our dashboard see 30% more repeat visits because reminders go out at exactly the right time - based on real mileage, not guessing."

### 4. Ask (15 sec)
"Want to see how the dashboard works? I can show you in 5 minutes."

## Key Points to Emphasize
- **You don't sell the devices** - Consumers buy them directly
- **Real data, not guessing** - Mileage-based reminders, not calendar-based
- **Set it and forget it** - Automated reminders once you configure rules
- **Low risk** - Month-to-month, no contracts`
        },
        {
          id: 'sales-101-objections',
          title: 'Handling Shop Owner Objections',
          type: 'reading',
          order: 3,
          content: `# Common Shop Owner Objections

## "I don't want to sell devices to my customers"
**Response:** "You don't have to! Consumers buy devices on their own - for mileage tracking, maintenance reminders, teen driver monitoring. When they need service, they connect with shops like yours through the network. You just subscribe to the dashboard."

## "What if my customers don't have the device?"
**Response:** "That's where growth comes in. You can mention Piston to customers who'd benefit - parents of teen drivers, people who forget oil changes. Or just wait for network growth - we're adding consumers every day. Start with a trial and see which of your existing customers are already on the network."

## "What about customer privacy? People don't want to be tracked."
**Response:** "Consumers choose to share data with specific shops. They control everything - who sees their info, when to disconnect. Most consumers love it because they get smart reminders and easy appointment booking. Nobody's tracking them without consent."

## "I already have shop management software"
**Response:** "This isn't replacing your POS or scheduler. It's a customer engagement layer. Your software tracks what happened - our dashboard tells you what's coming. When should you reach out? Who needs service? That's what we automate."`
        },
        {
          id: 'sales-101-demo',
          title: 'Demo Best Practices',
          type: 'task',
          order: 4,
          content: `# Demo Checklist for Shop Dashboard

Complete these tasks to master the shop owner demo:`,
          taskChecklist: [
            'Learn the customer list view - sorted by upcoming service needs',
            'Master the automated reminder configuration flow',
            'Practice showing the marketing campaign builder',
            'Understand the consumer app experience (what customers see)',
            'Know the pricing tiers and when to mention trial',
            'Practice handling the "chicken and egg" question about device adoption'
          ]
        },
        {
          id: 'sales-101-quiz',
          title: 'Shop Sales Quiz',
          type: 'quiz',
          order: 5,
          content: 'Test your knowledge of selling the shop dashboard.',
          quiz: [
            {
              question: 'What are Piston Labs\' two customer types?',
              options: [
                'Fleet managers and drivers',
                'Consumers (device buyers) and Auto Repair Shops (SaaS)',
                'Car dealers and insurance companies',
                'Mechanics and parts suppliers'
              ],
              correctIndex: 1,
              explanation: 'Consumers buy devices to track their cars. Shops subscribe to the dashboard to engage with those consumers.'
            },
            {
              question: 'When a shop owner asks "Do I have to sell the devices?", the correct answer is:',
              options: [
                'Yes, you make a commission on each device',
                'No - consumers buy devices directly, shops just subscribe to the dashboard',
                'Yes, but we provide them at cost',
                'Only if you want the full features'
              ],
              correctIndex: 1,
              explanation: 'Shops never sell hardware. They subscribe to the SaaS dashboard to access customers on the network.'
            },
            {
              question: 'What is our opening hook for shops?',
              options: [
                'Track your fleet in real-time',
                'Turn every oil change into a lifetime customer',
                'The cheapest GPS tracking solution',
                'Enterprise-grade fleet management'
              ],
              correctIndex: 1,
              explanation: 'This hook speaks to the shop\'s real pain point: customer retention, not fleet tracking.'
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

## Two-Sided Marketplace
- **Consumer Side:** OBD-II devices + mobile app for car owners
- **Shop Side:** SaaS dashboard for customer engagement

## Core Components

### 1. IoT Layer (Consumer Devices)
- Teltonika FMC130 OBD-II devices
- Captures: GPS, mileage, speed, battery voltage, engine codes
- MQTT via AWS IoT Core → Lambda → DynamoDB

### 2. Consumer App
- View car health and telemetry
- Get smart maintenance reminders
- Find and connect with shops
- Book appointments, view service history

### 3. Shop Dashboard (SaaS)
- Customer list with real-time vehicle data
- Automated reminder configuration
- Marketing campaign builder
- Appointment queue management

### 4. Backend Services
- **Vercel Functions** - API endpoints
- **Upstash Redis** - Real-time data, caching
- **DynamoDB** - Device telemetry, user profiles

## Key Repositories
- \`agent-coord-mcp\` - Coordination hub (this!)
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
      description: 'Understanding Piston Labs two-sided marketplace - consumer devices + shop SaaS',
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
**Connect car owners with trusted repair shops through vehicle telemetry.**

## Two-Sided Marketplace

### For Consumers (Device Buyers)
- OBD-II device plugs into any car (1996+)
- Mobile app shows car health, mileage, battery status
- Smart maintenance reminders based on actual mileage
- Find trusted shops and book appointments
- Service history follows the car if sold

### For Shops (SaaS Dashboard)
- CRM showing customers with Piston devices
- See real mileage and upcoming service needs
- Automated reminders (oil change, tires, inspections)
- Marketing campaigns to customers due for service
- Appointment booking from the consumer app

## Revenue Model
1. **Device Sales** - One-time purchase by consumers
2. **Shop SaaS** - Monthly subscription for dashboard access
3. **Future: Network fees** - Appointment bookings, lead generation

## Why We Win
- **Network Effects** - More consumers = more value for shops, and vice versa
- **Real Data** - Mileage-based reminders beat calendar guessing
- **Independent Shop Focus** - Help them compete with chains
- **Consumer Control** - Privacy-first, opt-in connections`
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
