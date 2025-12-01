#!/usr/bin/env python3
"""
Fix BigBrain (autonomous-agent) duplication issue.
The agent was responding multiple times to the same message because it wasn't
tracking processed message IDs properly.
"""

with open('src/autonomous-agent.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add a Set to track processed message IDs
old_vars = '''let lastProcessedTimestamp: string | null = null;
let conversationHistory: Anthropic.MessageParam[] = [];'''

new_vars = '''let lastProcessedTimestamp: string | null = null;
let conversationHistory: Anthropic.MessageParam[] = [];
const processedMessageIds = new Set<string>();  // Track processed messages to prevent duplicates'''

if old_vars in content:
    content = content.replace(old_vars, new_vars)
    print('Added processedMessageIds Set')

# Update the message processing to check and track message IDs
old_processing = '''      if (newMessages.length > 0) {
        console.log(`[agent] Found ${newMessages.length} new message(s)`);
        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        // Process messages through context manager
        contextManager.processMessages(newMessages.map(m => ({
          author: m.author,
          message: m.message,
          authorType: m.authorType
        })));

        // Check for special commands first (like rename)
        await checkForRenameCommand(newMessages);

        if (await shouldRespond(newMessages)) {'''

new_processing = '''      if (newMessages.length > 0) {
        console.log(`[agent] Found ${newMessages.length} new message(s)`);

        // Filter out already processed messages to prevent duplicates
        const unprocessedMessages = newMessages.filter(m => !processedMessageIds.has(m.id));

        if (unprocessedMessages.length === 0) {
          console.log(`[agent] All ${newMessages.length} messages already processed, skipping`);
          lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;
          continue;
        }

        // Mark all new messages as processed BEFORE responding (prevents duplicates)
        unprocessedMessages.forEach(m => processedMessageIds.add(m.id));

        // Keep set from growing indefinitely (keep last 100)
        if (processedMessageIds.size > 100) {
          const toDelete = Array.from(processedMessageIds).slice(0, processedMessageIds.size - 100);
          toDelete.forEach(id => processedMessageIds.delete(id));
        }

        lastProcessedTimestamp = newMessages[newMessages.length - 1].timestamp;

        // Process messages through context manager
        contextManager.processMessages(unprocessedMessages.map(m => ({
          author: m.author,
          message: m.message,
          authorType: m.authorType
        })));

        // Check for special commands first (like rename)
        await checkForRenameCommand(unprocessedMessages);

        if (await shouldRespond(unprocessedMessages)) {'''

if old_processing in content:
    content = content.replace(old_processing, new_processing)
    print('Fixed message processing to track and skip processed IDs')
else:
    print('Could not find old_processing pattern')

# Also update the context line to use unprocessedMessages
old_context = '''          const context = newMessages.map(m => `${m.author}: ${m.message}`).join('\\n');'''

new_context = '''          const context = unprocessedMessages.map(m => `${m.author}: ${m.message}`).join('\\n');'''

if old_context in content:
    content = content.replace(old_context, new_context)
    print('Updated context to use unprocessedMessages')

with open('src/autonomous-agent.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('\nDone! Rebuild with: npm run build')
