# Claude Code CLI Agent Spawning

## Quick Command (PowerShell)
To spawn a new Claude Code CLI agent with agent-coord-mcp connected:

```powershell
Start-Process cmd -ArgumentList '/k', 'cd /d C:\Users\tyler\Desktop\agent-coord-mcp && claude --dangerously-skip-permissions --mcp-config mcp-config.json'
```

## Spawn Multiple Agents
Run the command multiple times to spawn multiple agents in separate terminal windows.

## Key Details
- Must `cd` into the project directory first
- Uses `mcp-config.json` which points to `dist/index.js`
- `--dangerously-skip-permissions` bypasses approval prompts
- Each agent gets its own terminal window via `Start-Process cmd /k`

## GPU Cache Warnings
You may see cache/GPU errors on startup - these are harmless and can be ignored.
The agent is working if you see the `>` prompt waiting for input.
