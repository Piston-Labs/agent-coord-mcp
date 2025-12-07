---
cluster: [development, technical]
complexity: L2
ai_summary: Meta-skill for creating Claude Code skills with YAML frontmatter, trigger patterns, two-hook architecture, and 500-line rule for context management
dependencies: [hook-development.md]
last_updated: 2025-12-07
tags: [skills, meta-skill, plugins, triggers, hooks, claude-code]
source: ordinary-claude-skills
---

# Skill Development

Guide for creating and managing Claude Code skills using Anthropic's auto-activation system.

## Skill Anatomy

```
.claude/skills/{skill-name}/
├── SKILL.md           # Required: Instructions + metadata
├── scripts/           # Optional: Automation scripts
├── references/        # Optional: Reference documents
└── assets/            # Optional: Templates, configs
```

### SKILL.md Structure

```markdown
---
name: skill-name
description: This skill should be used when the user asks to...
version: 0.1.0
---

# Skill Name

Instructions for Claude in imperative form.

## When to Use

Describe trigger conditions.

## Key Patterns

Document important patterns.

## Examples

Show concrete examples.
```

## Key Principles

### Progressive Disclosure

Information loads in three stages:
1. **Metadata** - Always available (name, description)
2. **SKILL.md body** - When skill triggered
3. **Bundled resources** - As needed during execution

### 500-Line Rule

Keep SKILL.md under 500 lines. Move detailed content to reference files:
- Long examples → `references/examples.md`
- API documentation → `references/api.md`
- Templates → `assets/template.md`

### Writing Style

Use imperative/infinitive form:
- "Analyze the code for security issues"
- "Generate tests for the function"

NOT second person:
- "You should analyze..." (wrong)
- "This will help you..." (wrong)

## Two-Hook Architecture

### UserPromptSubmit Hook
Proactively suggests skills before Claude processes input.
- Runs on every user message
- Injects skill context if triggered
- Non-blocking by default

### Stop Hook
Provides gentle post-response reminders.
- Runs after Claude's response
- Advisory, not blocking
- Good for quality checks

## Trigger Mechanisms

| Trigger Type | Description | Example |
|--------------|-------------|---------|
| **Keywords** | Explicit topic mentions | `["security", "vulnerability"]` |
| **Intent Patterns** | Regex for implicit actions | `"review.*code"` |
| **File Paths** | Glob patterns | `"**/*.sql"` |
| **Content Patterns** | Technology detection | `"SELECT.*FROM"` |

### skill-rules.json

```json
{
  "skills": [
    {
      "name": "security-review",
      "path": ".claude/skills/security-review",
      "triggers": {
        "keywords": ["security", "vulnerability", "CVE"],
        "intentPatterns": ["review.*security", "check.*safe"],
        "filePaths": ["**/auth/**", "**/crypto/**"]
      },
      "enforcement": "suggest"
    }
  ]
}
```

## Enforcement Levels

| Level | Exit Code | Behavior |
|-------|-----------|----------|
| **BLOCK** | 2 | Prevents execution until addressed |
| **SUGGEST** | 0 | Injects context reminder |
| **WARN** | 0 | Low-priority advisory |

## Skill Categories

### Guardrail Skills
Type: `guardrail`, Enforcement: `block`
- Critical safety measures
- Prevent dangerous operations
- Example: Block destructive commands

### Domain Skills
Type: `domain`, Enforcement: `suggest`
- Comprehensive domain guidance
- Best practices and patterns
- Example: API design principles

## User Control Features

Allow users to skip skills when needed:
- **Session tracking** - Don't repeat suggestions
- **File markers** - `// @skip-validation`
- **Environment variables** - `SKIP_SKILL_GUARDRAILS=true`

## Creation Workflow

1. **Create directory** - `.claude/skills/{skill-name}/`
2. **Write SKILL.md** - Frontmatter + instructions
3. **Register in rules** - Add to `skill-rules.json`
4. **Test triggers** - Verify activation
5. **Refine patterns** - Adjust based on testing
6. **Document** - Clear usage instructions

## Best Practices

1. **Single responsibility** - One skill, one purpose
2. **Clear triggers** - Specific, not overly broad
3. **Lean content** - Under 500 lines
4. **Good examples** - Show, don't just tell
5. **Skip mechanisms** - Respect user control
6. **Test thoroughly** - Edge cases matter

## Application to Agent Coordination Hub

### Current Skills in Hub
We have this `/skills/` library with curated patterns.

### Enhancement Ideas

1. **Auto-loading skills**
   - Skills triggered by task type
   - workflow-orchestration for orchestrate tasks
   - error-handling for debugging tasks

2. **Skill recommendations**
   - hot-start suggests relevant skills
   - Based on current work context

3. **Custom hub skills**
   - Agent coordination patterns
   - QC workflow enforcement
   - Checkpoint reminders
