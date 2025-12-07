---
cluster: [agent-patterns, configuration]
complexity: L2
ai_summary: Plugin settings pattern using .claude/plugin-name.local.md files with YAML frontmatter for per-project agent configuration and state management
dependencies: [hook-development.md]
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [plugin-settings, yaml-frontmatter, agent-state, configuration, claude-code]
---

# Plugin Settings Pattern

## Core Pattern

Store per-project agent configuration in `.claude/plugin-name.local.md`:

```markdown
---
enabled: true
agent_name: auth-agent
task_number: 3.5
coordinator_session: team-leader
---

# Task Assignment

Implement JWT authentication for the API.
```

**Key characteristics:**
- Location: `.claude/plugin-name.local.md` in project root
- Structure: YAML frontmatter + markdown body
- Lifecycle: User-managed, gitignored
- Access: Hooks, commands, and agents can read

## Parsing Frontmatter (Bash)

```bash
STATE_FILE=".claude/my-plugin.local.md"

# Quick exit if not configured
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Extract frontmatter between --- markers
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE")

# Read individual fields
ENABLED=$(echo "$FRONTMATTER" | grep '^enabled:' | sed 's/enabled: *//')
AGENT_NAME=$(echo "$FRONTMATTER" | grep '^agent_name:' | sed 's/agent_name: *//')

# Extract markdown body (after second ---)
BODY=$(awk '/^---$/{i++; next} i>=2' "$STATE_FILE")
```

## Common Use Patterns

### 1. Temporarily Active Hooks
Enable/disable hooks without editing hooks.json:
```yaml
---
enabled: true  # Toggle this
strict_mode: false
---
```

### 2. Multi-Agent State Management
```yaml
---
agent_name: auth-implementation
task_number: 3.5
pr_number: 1234
coordinator_session: team-leader
dependencies: ["Task 3.4"]
---

# Task: Implement Authentication
Build JWT-based auth for the REST API.
```

### 3. Configuration-Driven Behavior
```yaml
---
validation_level: strict
max_file_size: 1000000
allowed_extensions: [".js", ".ts", ".tsx"]
---
```

## Best Practices

**File Naming:**
- Use `.claude/plugin-name.local.md` format
- Add `.claude/*.local.md` to `.gitignore`

**Defaults:** Provide sensible defaults when file doesn't exist

**Validation:** Validate settings values before use

**Restart Required:** Changes require Claude Code restart

## Security

- Escape quotes in user input when writing
- Check for path traversal in file paths
- Keep files readable by user only (chmod 600)

## Application to Agent Coordination

**Direct mappings:**
- Agent task assignment → `task_number`, `coordinator_session`
- Handoff state → `dependencies`, `pr_number`
- Hook activation → `enabled` flag for conditional processing
