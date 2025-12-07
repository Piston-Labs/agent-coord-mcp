---
cluster: [agent-patterns, automation]
complexity: L2
ai_summary: Hook development patterns for Claude Code - PreToolUse, PostToolUse, Stop, SessionStart events with prompt-based and command-based implementations
dependencies: [plugin-settings.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [hooks, claude-code, events, automation, validation, lifecycle]
---

# Hook Development Patterns

## Hook Types

### Prompt-Based Hooks (Recommended)
LLM-driven decisions for context-aware validation:
```json
{
  "type": "prompt",
  "prompt": "Evaluate if this tool use is appropriate: $TOOL_INPUT",
  "timeout": 30
}
```
**Supported:** Stop, SubagentStop, UserPromptSubmit, PreToolUse

### Command Hooks
Bash scripts for deterministic checks:
```json
{
  "type": "command",
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/validate.sh",
  "timeout": 60
}
```

## Hook Events

| Event | When | Use For |
|-------|------|---------|
| **PreToolUse** | Before tool | Approve/deny/modify tool calls |
| **PostToolUse** | After tool | React to results, provide feedback |
| **Stop** | Agent stopping | Validate task completion |
| **SubagentStop** | Subagent done | Ensure subagent completed task |
| **UserPromptSubmit** | User input | Add context, validate prompts |
| **SessionStart** | Session begins | Load project context |
| **SessionEnd** | Session ends | Cleanup, logging |

## Configuration Formats

### Plugin hooks.json (wrapper format)
```json
{
  "description": "Validation hooks",
  "hooks": {
    "PreToolUse": [...],
    "Stop": [...]
  }
}
```

### User settings (direct format)
```json
{
  "PreToolUse": [...],
  "Stop": [...]
}
```

## Key Patterns

### PreToolUse Validation
```json
{
  "PreToolUse": [{
    "matcher": "Write|Edit",
    "hooks": [{
      "type": "prompt",
      "prompt": "Validate file write safety. Check: system paths, credentials, path traversal. Return 'approve' or 'deny'."
    }]
  }]
}
```

### Stop Completion Check
```json
{
  "Stop": [{
    "matcher": "*",
    "hooks": [{
      "type": "prompt",
      "prompt": "Verify task completion: tests run, build succeeded. Return 'approve' to stop or 'block' to continue."
    }]
  }]
}
```

### SessionStart Context Loading
```json
{
  "SessionStart": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.sh"
    }]
  }]
}
```

## Matchers

```json
"matcher": "Write"           // Exact match
"matcher": "Read|Write|Edit" // Multiple tools
"matcher": "*"               // All tools
"matcher": "mcp__.*__delete" // Regex pattern
```

## Environment Variables

- `$CLAUDE_PROJECT_DIR` - Project root
- `$CLAUDE_PLUGIN_ROOT` - Plugin directory (use for portable paths)
- `$CLAUDE_ENV_FILE` - SessionStart only: persist env vars

## Output Format

```json
{
  "decision": "approve|block|deny",
  "reason": "Explanation",
  "systemMessage": "Message for Claude"
}
```

**Exit codes:** 0=success, 2=blocking error

## Performance

- All matching hooks run **in parallel**
- Use command hooks for quick checks
- Use prompt hooks for complex reasoning
- Hooks load at session start (no hot-swap)

## Application to Agent Coordination

**Direct mappings:**
- PreToolUse → Agent permission checks before actions
- Stop/SubagentStop → Task completion validation
- SessionStart → Agent hot-start context loading
- PostToolUse → Result logging for coordination
