#!/usr/bin/env node
/**
 * CLAB Inbox Check Hook
 *
 * This script is designed to be called by Claude Code hooks.
 * It checks for unread CLAB messages and outputs a notification.
 *
 * Usage in Claude Code hooks (settings.json or .claude/hooks.json):
 *
 * {
 *   "hooks": {
 *     "notification": [
 *       {
 *         "matcher": ".*",
 *         "commands": ["node /path/to/clab-hook.js --agent=YOUR_ID"]
 *       }
 *     ]
 *   }
 * }
 *
 * Or for prompt-submit hook to inject messages:
 * {
 *   "hooks": {
 *     "prompt-submit": [
 *       {
 *         "matcher": ".*",
 *         "commands": ["node /path/to/clab-hook.js --agent=YOUR_ID --format=inject"]
 *       }
 *     ]
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const INBOX_PATH = path.join(os.homedir(), '.clab', 'inbox.json');

// Parse args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const AGENT_ID = args.agent || 'agent';
const FORMAT = args.format || 'summary'; // 'summary', 'inject', 'json', 'clear'

function loadInbox() {
  try {
    if (fs.existsSync(INBOX_PATH)) {
      return JSON.parse(fs.readFileSync(INBOX_PATH, 'utf8'));
    }
  } catch (e) {
    return { messages: [] };
  }
  return { messages: [] };
}

function clearInbox() {
  const inbox = { messages: [], lastChecked: new Date().toISOString() };
  fs.writeFileSync(INBOX_PATH, JSON.stringify(inbox, null, 2));
}

function main() {
  const inbox = loadInbox();
  const messages = inbox.messages || [];

  if (FORMAT === 'clear') {
    clearInbox();
    console.log('Inbox cleared');
    return;
  }

  if (messages.length === 0) {
    if (FORMAT === 'json') {
      console.log(JSON.stringify({ unread: 0, messages: [] }));
    }
    // Silent if no messages (don't spam Claude Code)
    return;
  }

  // Filter for high-priority (mentions) first
  const mentions = messages.filter(m => m.relevance?.type === 'mention');
  const broadcasts = messages.filter(m => m.relevance?.type === 'broadcast');
  const general = messages.filter(m => m.relevance?.type === 'general');

  if (FORMAT === 'json') {
    console.log(JSON.stringify({
      unread: messages.length,
      mentions: mentions.length,
      broadcasts: broadcasts.length,
      general: general.length,
      messages: messages
    }));
    return;
  }

  if (FORMAT === 'inject') {
    // Format for injection into Claude Code context
    // This creates a system-reminder style message
    if (mentions.length > 0) {
      console.log(`<system-reminder>`);
      console.log(`You have ${mentions.length} unread @mention(s) in CLAB chat:`);
      mentions.slice(0, 3).forEach(m => {
        console.log(`  - ${m.author}: ${m.message.substring(0, 100)}${m.message.length > 100 ? '...' : ''}`);
      });
      if (mentions.length > 3) {
        console.log(`  ... and ${mentions.length - 3} more`);
      }
      console.log(`Use group-chat action=get to see all messages and respond.`);
      console.log(`</system-reminder>`);
    } else if (broadcasts.length + general.length > 5) {
      console.log(`<system-reminder>`);
      console.log(`${messages.length} unread CLAB messages. Check chat when convenient.`);
      console.log(`</system-reminder>`);
    }
    return;
  }

  // Default: summary format
  console.log(`\n📬 CLAB Inbox (${messages.length} unread)`);

  if (mentions.length > 0) {
    console.log(`\n🔔 Mentions (${mentions.length}):`);
    mentions.forEach(m => {
      console.log(`  [${new Date(m.timestamp).toLocaleTimeString()}] ${m.author}: ${m.message.substring(0, 80)}...`);
    });
  }

  if (broadcasts.length > 0) {
    console.log(`\n📢 Broadcasts (${broadcasts.length}):`);
    broadcasts.slice(0, 3).forEach(m => {
      console.log(`  [${new Date(m.timestamp).toLocaleTimeString()}] ${m.author}: ${m.message.substring(0, 80)}...`);
    });
  }

  if (general.length > 0) {
    console.log(`\n💬 General (${general.length} messages)`);
  }

  console.log(`\nRun: node clab-hook.js --format=clear  to clear inbox`);
}

main();
