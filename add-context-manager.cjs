const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'autonomous-agent.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import for ContextManager at the top
const oldImport = `import Anthropic from '@anthropic-ai/sdk';`;
const newImport = `import Anthropic from '@anthropic-ai/sdk';
import ContextManager, { ContextPriority } from './context-manager.js';`;

content = content.replace(oldImport, newImport);

// 2. Add context manager initialization after anthropic client
const oldAnthropicInit = `const anthropic = new Anthropic();`;
const newAnthropicInit = `const anthropic = new Anthropic();

// Initialize bulletproof context manager
const contextManager = new ContextManager(CONFIG.AGENT_ID, 50000);
let checkpointInterval: NodeJS.Timeout | null = null;`;

content = content.replace(oldAnthropicInit, newAnthropicInit);

// 3. Add new tools for context management
const oldToolsDef = `const TOOLS: Anthropic.Tool[] = [`;
const newToolsDef = `const TOOLS: Anthropic.Tool[] = [
  {
    name: 'save_checkpoint',
    description: 'Save current context state to Redis for persistence. Use this before shutting down or after important decisions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'sync_context',
    description: 'Post a context sync message to help other agents get up to speed quickly. Use when agents come online.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'record_decision',
    description: 'Record an important decision for future reference. Decisions are persisted across restarts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        decision: { type: 'string', description: 'The decision made' },
        reason: { type: 'string', description: 'Why this decision was made' }
      },
      required: ['decision']
    }
  },
  {
    name: 'add_blocker',
    description: 'Record a blocker that is preventing progress. Blockers are tracked across restarts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blocker: { type: 'string', description: 'Description of what is blocking progress' }
      },
      required: ['blocker']
    }
  },
  {
    name: 'resolve_blocker',
    description: 'Mark a blocker as resolved.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blocker: { type: 'string', description: 'The blocker that was resolved (partial match OK)' }
      },
      required: ['blocker']
    }
  },
  {
    name: 'set_focus',
    description: 'Update the current focus/priority. This is tracked and shared with other agents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        focus: { type: 'string', description: 'What you are currently focused on' }
      },
      required: ['focus']
    }
  },`;

content = content.replace(oldToolsDef, newToolsDef);

// 4. Add tool implementations for context management
const oldSwitch = `switch (toolName) {`;
const newSwitch = `switch (toolName) {
    case 'save_checkpoint': {
      const success = await contextManager.saveCheckpoint();
      return success ? 'Checkpoint saved successfully' : 'Failed to save checkpoint';
    }

    case 'sync_context': {
      const syncMessage = contextManager.generateContextSync();
      await fetch(\`\${CONFIG.API_BASE}/api/chat\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: CONFIG.AGENT_ID, authorType: 'agent', message: syncMessage })
      });
      return 'Context sync posted to chat';
    }

    case 'record_decision': {
      const { decision, reason } = toolInput as { decision: string; reason?: string };
      const fullDecision = reason ? \`\${decision} (reason: \${reason})\` : decision;
      contextManager.addContextItem({
        type: 'decision',
        content: fullDecision,
        priority: ContextPriority.HIGH
      });
      return \`Decision recorded: \${fullDecision}\`;
    }

    case 'add_blocker': {
      const { blocker } = toolInput as { blocker: string };
      contextManager.addContextItem({
        type: 'blocker',
        content: blocker,
        priority: ContextPriority.CRITICAL
      });
      return \`Blocker added: \${blocker}\`;
    }

    case 'resolve_blocker': {
      const { blocker } = toolInput as { blocker: string };
      contextManager.resolveBlocker(blocker);
      return \`Blocker resolved: \${blocker}\`;
    }

    case 'set_focus': {
      const { focus } = toolInput as { focus: string };
      contextManager.setFocus(focus);
      return \`Focus updated to: \${focus}\`;
    }

`;

content = content.replace(oldSwitch, newSwitch);

// 5. Update system prompt to include context manager info
const oldSystemPrompt = `const SYSTEM_PROMPT = \`You are \${CONFIG.AGENT_ID}`;
const newSystemPrompt = `// Dynamic system prompt with live context
function getSystemPrompt(): string {
  const contextSection = contextManager.getContextForPrompt();

  return \`You are \${CONFIG.AGENT_ID}`;

content = content.replace(oldSystemPrompt, newSystemPrompt);

// 6. Close the dynamic system prompt function and update references
const oldEndPrompt = `When humans or agents ask you to do something, use your tools to accomplish it. Think step by step.\`;`;
const newEndPrompt = `When humans or agents ask you to do something, use your tools to accomplish it. Think step by step.

\${contextSection ? '\\n## LIVE CONTEXT\\n' + contextSection : ''}\`;
}

// Legacy static prompt for backwards compatibility
const SYSTEM_PROMPT = getSystemPrompt();`;

content = content.replace(oldEndPrompt, newEndPrompt);

// 7. Update processWithTools to use dynamic prompt and context manager
const oldProcessStart = `async function processWithTools(userContent: string): Promise<string> {
  // Ensure user content is never empty
  const safeUserContent = userContent.trim() || '[No content provided]';
  conversationHistory.push({ role: 'user', content: safeUserContent });`;
const newProcessStart = `async function processWithTools(userContent: string): Promise<string> {
  // Ensure user content is never empty
  const safeUserContent = userContent.trim() || '[No content provided]';

  // Add to context manager for persistence
  contextManager.addContextItem({
    type: 'message',
    content: safeUserContent,
    priority: ContextPriority.MEDIUM
  });

  conversationHistory.push({ role: 'user', content: safeUserContent });`;

content = content.replace(oldProcessStart, newProcessStart);

// 8. Update Claude calls to use dynamic system prompt
content = content.replace(
  /system: SYSTEM_PROMPT,/g,
  'system: getSystemPrompt(),'
);

// 9. Update mainLoop to initialize context manager
const oldMainLoopStart = `async function mainLoop(): Promise<void> {
  console.log(\`[agent] Starting \${CONFIG.AGENT_ID} (\${CONFIG.AGENT_ROLE})\`);
  console.log(\`[agent] Connecting to \${CONFIG.API_BASE}\`);
  console.log(\`[agent] Poll interval: \${CONFIG.POLL_INTERVAL}ms\`);

  // Register presence silently - no chat message spam on startup
  await updateStatus('Online - monitoring chat');`;
const newMainLoopStart = `async function mainLoop(): Promise<void> {
  console.log(\`[agent] Starting \${CONFIG.AGENT_ID} (\${CONFIG.AGENT_ROLE})\`);
  console.log(\`[agent] Connecting to \${CONFIG.API_BASE}\`);
  console.log(\`[agent] Poll interval: \${CONFIG.POLL_INTERVAL}ms\`);

  // Try to restore from checkpoint (hot start)
  const restored = await contextManager.restoreFromCheckpoint();
  if (restored) {
    console.log('[agent] Context restored from checkpoint - hot start enabled');
  } else {
    console.log('[agent] Starting fresh - no checkpoint found');
  }

  // Sync current system state
  await contextManager.syncSystemState();
  console.log('[agent] System state synced');

  // Start auto-checkpoint every 5 minutes
  checkpointInterval = contextManager.startAutoCheckpoint(5);
  console.log('[agent] Auto-checkpoint enabled (every 5 minutes)');

  // Register presence silently - no chat message spam on startup
  await updateStatus('Online - monitoring chat');
  contextManager.setFocus('Monitoring chat and coordinating team');`;

content = content.replace(oldMainLoopStart, newMainLoopStart);

// 10. Update message processing to sync state
const oldNewMessages = `if (newMessages.length > 0) {
        console.log(\`[agent] Found \${newMessages.length} new message(s)\`);
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;`;
const newNewMessages = `if (newMessages.length > 0) {
        console.log(\`[agent] Found \${newMessages.length} new message(s)\`);
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        // Process messages through context manager
        contextManager.processMessages(newMessages.map(m => ({
          author: m.author,
          message: m.message,
          authorType: m.authorType
        })));`;

content = content.replace(oldNewMessages, newNewMessages);

// 11. Update shutdown handlers to save checkpoint
const oldShutdown = `// Graceful shutdown - no chat spam, just log and exit
process.on('SIGINT', async () => {
  console.log('[agent] Shutting down (SIGINT)...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[agent] Shutting down (SIGTERM)...');
  process.exit(0);
});`;
const newShutdown = `// Graceful shutdown with checkpoint save
process.on('SIGINT', async () => {
  console.log('[agent] Shutting down (SIGINT)...');
  if (checkpointInterval) clearInterval(checkpointInterval);
  await contextManager.saveCheckpoint();
  console.log('[agent] Checkpoint saved before exit');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[agent] Shutting down (SIGTERM)...');
  if (checkpointInterval) clearInterval(checkpointInterval);
  await contextManager.saveCheckpoint();
  console.log('[agent] Checkpoint saved before exit');
  process.exit(0);
});`;

content = content.replace(oldShutdown, newShutdown);

// 12. Sync state periodically in the main loop
const oldPollWait = `await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}`;
const newPollWait = `// Periodically sync system state (every 10 polls)
      if (Math.random() < 0.1) {
        await contextManager.syncSystemState();
      }

      await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}`;

content = content.replace(oldPollWait, newPollWait);

fs.writeFileSync(filePath, content, 'utf8');
console.log('BigBrain context management integration complete!');
console.log('');
console.log('New capabilities:');
console.log('- Checkpoint/restore for hot starts');
console.log('- Auto-checkpoint every 5 minutes');
console.log('- Context summarization for token efficiency');
console.log('- Decision and blocker tracking');
console.log('- Dynamic system prompt with live context');
console.log('- Team and resource awareness');
console.log('- Context sync for other agents');
