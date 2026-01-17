---
cluster: [llm-techniques, tools]
complexity: L2
ai_summary: MCP (Model Context Protocol) integration patterns - 4 transport types, tool naming conventions, security practices for external service access
dependencies: [hook-development.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [mcp, model-context-protocol, tools, integration, claude-code]
---

# MCP Integration Patterns

## Transport Types

| Type | Best For | Characteristics |
|------|----------|-----------------|
| **stdio** | Local processes | stdin/stdout, custom servers, file system |
| **SSE** | Cloud services | OAuth support, official services (Asana, GitHub) |
| **HTTP** | REST APIs | Token headers, stateless backends |
| **WebSocket** | Real-time | Bidirectional, streaming, push notifications |

## Configuration Methods

### .mcp.json (Recommended)
Dedicated file for clarity:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      }
    }
  }
}
```

### plugin.json Inline
For single-server plugins:
```json
{
  "mcpServers": {
    "inline-server": {...}
  }
}
```

## Tool Naming Convention

Pattern: `mcp__plugin_<name>_<server>__<tool>`

Examples:
- `mcp__plugin_asana_asana__create_task`
- `mcp__plugin_github_api__list_repos`

## Security Practices

**DO:**
- Use HTTPS/WSS connections
- Store tokens in environment variables
- Pre-allow only necessary tools
- Validate inputs before tool calls

**DON'T:**
- Hardcode credentials
- Use wildcard tool permissions
- Trust untrusted MCP servers
- Expose tokens in logs

## Implementation Patterns

### 1. Simple Tool Wrapper
User validates before execution:
```json
{
  "allowed-tools": ["mcp__plugin_asana_asana__create_task"]
}
```

### 2. Autonomous Agent
Agent uses MCP tools without interaction:
- Pre-configure allowed tools
- Agent decides when to use

### 3. Multi-Server Plugin
Coordinate across services:
- Multiple MCP servers in one plugin
- Cross-service workflows

## Development Workflow

1. Configure locally in .mcp.json
2. Use `/mcp` command to verify servers
3. Run with `--debug` flag
4. Validate authentication
5. Test tools individually

## Application to Agent Coordination

**Direct mappings:**
- Our MCP server → stdio transport type
- Tool prefixing → `mcp__agent-coord__*` naming
- Multi-server → Combining our tools with GitHub, Linear, etc.
- Security practices → Our authorized agents list for sensitive operations
