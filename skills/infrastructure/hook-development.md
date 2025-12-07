---
cluster: [technical, infrastructure]
complexity: L2
ai_summary: Claude Code hook development for event-driven automation including PreToolUse, PostToolUse, Stop, and SessionStart hooks with prompt-based validation
dependencies: [mcp-integration.md]
last_updated: 2025-12-07
tags: [hooks, events, automation, validation, claude-code, plugins]
source: ordinary-claude-skills
---

# Hook Development

Create hooks for event-driven automation in Claude Code, with emphasis on prompt-based hooks for context-aware validation.

## Hook Types

| Hook | Trigger | Use Case |
|------|---------|----------|
| **PreToolUse** | Before tool execution | Validate, block, or modify tool calls |
| **PostToolUse** | After tool execution | React to results, trigger follow-up |
| **Stop** | When agent completes | Enforce completion standards |
| **SubagentStop** | When subagent completes | Validate subagent work |
| **SessionStart** | Session begins | Load context, initialize state |
| **UserPromptSubmit** | User sends message | Preprocess, validate, or augment |

## Hook Types: Prompt vs Command

### Prompt-Based Hooks (Recommended)

LLM-driven decision making for context-aware validation.

**Benefits:**
- Context-aware reasoning
- No bash scripting required
- Superior edge case handling
- Natural language rules

**Supported events:** Stop, SubagentStop, UserPromptSubmit, PreToolUse

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "type": "prompt",
        "prompt": "Review this bash command. Block if it could delete files, modify system config, or access sensitive directories. Allow normal development commands."
      }
    ]
  }
}
```

### Command Hooks

Bash execution for deterministic checks.

**Use for:**
- File operations
- Performance-critical validations
- External tool integration
- Simple pattern matching

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "type": "command",
        "command": "echo 'File written: $FILE_PATH' >> /tmp/write-log.txt"
      }
    ]
  }
}
```

## Configuration Formats

### Plugin Format (hooks.json)
```json
{
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "Stop": [...]
  }
}
```

### Settings Format (direct)
```json
{
  "PreToolUse": [...],
  "PostToolUse": [...],
  "Stop": [...]
}
```

## Matcher Syntax

| Pattern | Matches |
|---------|---------|
| `"Bash"` | Bash tool only |
| `"*"` | All tools |
| `"mcp__*"` | All MCP tools |
| `["Bash", "Write"]` | Bash OR Write |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | Plugin directory path |
| `$TOOL_NAME` | Current tool name |
| `$FILE_PATH` | File being operated on |
| `$ARGUMENTS` | Tool arguments (JSON) |

## Hook Input/Output

### Input (passed to hook)
```json
{
  "tool": "Bash",
  "arguments": {
    "command": "rm -rf node_modules"
  },
  "context": "User requested cleanup"
}
```

### Output (from prompt hook)
```json
{
  "decision": "block",
  "reason": "Destructive command detected"
}
```

Or:
```json
{
  "decision": "allow"
}
```

## Common Hook Patterns

### 1. Safety Gate (PreToolUse)
```json
{
  "matcher": "Bash",
  "type": "prompt",
  "prompt": "Evaluate if this bash command is safe. Block commands that: delete files recursively, modify system files, access credentials, or could cause data loss."
}
```

### 2. Code Quality Check (Stop)
```json
{
  "matcher": "*",
  "type": "prompt",
  "prompt": "Before completing, verify: 1) All files are properly formatted, 2) No TODO comments left, 3) Tests pass if applicable."
}
```

### 3. Context Loading (SessionStart)
```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/scripts/load-context.sh"
}
```

### 4. Audit Logging (PostToolUse)
```json
{
  "matcher": ["Write", "Edit"],
  "type": "command",
  "command": "echo \"$(date): Modified $FILE_PATH\" >> ${CLAUDE_PLUGIN_ROOT}/audit.log"
}
```

## Best Practices

1. **Start with prompt hooks** - More flexible, context-aware
2. **Be specific with matchers** - Avoid `"*"` unless necessary
3. **Test thoroughly** - Hooks can block work if misconfigured
4. **Log decisions** - Audit trail for blocked actions
5. **Fail open carefully** - Decide if hook failure should block or allow

## Application to Agent Coordination Hub

### Current State
We don't extensively use hooks yet.

### Enhancement Ideas

1. **PreToolUse for claims**
   - Before editing a file, check if another agent has claimed it
   - Block or warn on conflict

2. **PostToolUse for tracking**
   - After file edits, log to WorkTrace
   - Update agent status automatically

3. **Stop for QC**
   - Enforce QC checklist before task completion
   - Require test pass before marking done

4. **SessionStart for context**
   - Auto-load hot-start on session begin
   - Register agent profile automatically
