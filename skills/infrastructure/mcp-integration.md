---
cluster: [technical, infrastructure]
complexity: L2
ai_summary: MCP (Model Context Protocol) server integration patterns for Claude Code plugins including stdio, SSE, HTTP, and WebSocket transports
dependencies: []
last_updated: 2025-12-07
tags: [mcp, integration, plugins, tools, servers, claude-code]
source: ordinary-claude-skills
---

# MCP Integration

Guide for adding Model Context Protocol servers to Claude Code plugins, enabling external service integration through structured tool access.

## Configuration Methods

### Method 1: Dedicated .mcp.json (Recommended)
Create at plugin root with server definitions.
- Clear separation of concerns
- Suits multiple servers
- Easier to maintain

### Method 2: Inline in plugin.json
Add `mcpServers` field for simpler single-server scenarios.

## Server Types

| Type | Transport | Best Use Case | Authentication |
|------|-----------|---------------|----------------|
| stdio | Local process | Custom/local servers | Environment variables |
| SSE | HTTP | Hosted MCP servers (Asana, GitHub, etc.) | OAuth |
| HTTP | REST API | Token-authenticated backends | Bearer tokens |
| WebSocket | Real-time | Real-time data streaming | Tokens |

## Key Configuration Features

### Environment Variable Expansion
- `${CLAUDE_PLUGIN_ROOT}` - Plugin directory for portability
- `${VAR_NAME}` - User environment variables

### Tool Naming
Automatically prefixed as: `mcp__plugin_<name>_<server>__<tool>`

### Security
- Pre-allow specific tools in command frontmatter
- Avoid wildcards
- Use HTTPS/WSS exclusively
- Store tokens in environment variables, never hardcode

## Integration Patterns

### 1. Simple Wrapper
Commands gather input, validate, then call MCP tools.
```markdown
---
allowed-tools: [mcp__my-plugin__github__create-issue]
---
Create a GitHub issue with the provided title and body.
```

### 2. Autonomous Agent
Multi-step workflows using MCP tools without user interaction.
- Agent decides which tools to call
- Chains multiple operations
- Handles errors and retries

### 3. Multi-Server
Combine multiple MCP servers for cross-service workflows.
```json
{
  "mcpServers": {
    "github": { "type": "sse", "url": "..." },
    "linear": { "type": "sse", "url": "..." },
    "slack": { "type": "http", "url": "..." }
  }
}
```

## Implementation Steps

1. Select server type based on use case
2. Create `.mcp.json` configuration
3. Use `${CLAUDE_PLUGIN_ROOT}` for portability
4. Document environment requirements in README
5. Test with `/mcp` command and `claude --debug`
6. Pre-allow specific MCP tools in commands
7. Implement authentication handling
8. Test error scenarios

## Best Practices

- **Security:** HTTPS/WSS only, no hardcoded credentials
- **Documentation:** List all required environment variables
- **Scope:** Permission to specific needed tools only
- **Testing:** Local testing before publishing
- **Error handling:** Graceful failures with informative messages

## Application to Agent Coordination Hub

Our hub already uses MCP extensively. Key patterns we can adopt:

1. **Multi-server pattern** - We have many MCP tools, good organization
2. **Autonomous agent** - Our agents use MCP tools autonomously
3. **Tool registration** - `profile` tool registers available MCP tools

### Enhancement Ideas
- Add tool pre-authorization for common workflows
- Document all env vars in one place
- Add MCP tool health checks
