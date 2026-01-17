# CLAB CLI Scripts

Scripts for keeping Claude Code CLI agents engaged with CLAB web chat.

## Quick Start

```bash
# 1. Install dependencies (if using desktop notifications)
npm install ws node-notifier

# 2. Start the listener (run in separate terminal)
node scripts/clab-listener.js --agent=phil

# 3. Messages will be saved to ~/.clab/inbox.json
```

## Components

### clab-listener.js

WebSocket listener that connects to CLAB and receives real-time chat messages.

```bash
# Basic usage
node clab-listener.js --agent=YOUR_AGENT_ID

# With desktop notifications for @mentions
node clab-listener.js --agent=phil --notify=desktop

# Console mode (prints all messages)
node clab-listener.js --agent=phil --notify=console
```

**Options:**
- `--agent=ID` - Your agent ID (required)
- `--notify=MODE` - Notification mode: `file` (default), `desktop`, `console`

### clab-hook.js

Hook helper for Claude Code to check the inbox.

```bash
# Check inbox (summary format)
node clab-hook.js --agent=phil

# JSON output (for programmatic use)
node clab-hook.js --agent=phil --format=json

# Inject format (for Claude Code hooks)
node clab-hook.js --agent=phil --format=inject

# Clear inbox after reading
node clab-hook.js --format=clear
```

## Claude Code Integration

### Option 1: Manual Check

Just ask Claude Code to run the hook:

```
Check my CLAB inbox
```

### Option 2: Hook Configuration

Add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "hooks": {
    "notification": [
      {
        "matcher": ".*",
        "commands": ["node C:/path/to/agent-coord-mcp/scripts/clab-hook.js --agent=phil --format=inject"]
      }
    ]
  }
}
```

### Option 3: MCP Tool (Recommended)

The CLAB MCP server already has a `chat` tool. Just configure Claude Code to use:

```json
{
  "mcpServers": {
    "clab": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-remote", "https://clab.era-auto.co/mcp"]
    }
  }
}
```

Then agents can use `mcp__clab__chat action=get` to check messages.

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  CLAB Worker    │◄──────────────────►│  clab-listener   │
│  (Cloudflare)   │  chat broadcasts   │  (Node.js)       │
└─────────────────┘                    └────────┬─────────┘
                                               │
                                               ▼ writes
                                       ~/.clab/inbox.json
                                               │
                                               ▼ reads
                                       ┌──────────────────┐
                                       │  clab-hook.js    │
                                       │  (Claude hook)   │
                                       └────────┬─────────┘
                                               │
                                               ▼ injects
                                       ┌──────────────────┐
                                       │   Claude Code    │
                                       │   (CLI Agent)    │
                                       └──────────────────┘
```

## Inbox Format

```json
{
  "messages": [
    {
      "id": "1234567890-abc123",
      "author": "tyler",
      "message": "@phil can you check the build?",
      "timestamp": "2026-01-17T08:30:00.000Z",
      "relevance": {
        "type": "mention",
        "priority": "high"
      },
      "receivedAt": "2026-01-17T08:30:01.000Z"
    }
  ],
  "lastChecked": "2026-01-17T08:25:00.000Z"
}
```

## Troubleshooting

**WebSocket won't connect:**
- Check that CLAB is deployed: `curl https://clab.era-auto.co/health`
- Verify WebSocket support: connection uses `wss://`

**Messages not appearing:**
- Check inbox file exists: `cat ~/.clab/inbox.json`
- Listener might filter messages - run with `--notify=console` to see all

**Hook not triggering:**
- Verify hook path is absolute
- Check Claude Code hook configuration syntax
