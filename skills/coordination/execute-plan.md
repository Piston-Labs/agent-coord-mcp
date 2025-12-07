---
cluster: [coordination]
complexity: L1
ai_summary: Plan execution pattern with status markers (PENDING, IN_PROGRESS, DONE, FAILED) and systematic task completion cycle
dependencies: []
last_updated: 2025-12-07
tags: [planning, execution, task-tracking, status-markers, workflow]
source: ordinary-claude-skills
---

# Execute-Plan Pattern

Systematic completion of structured task plans with automatic progress tracking through status markers.

## Core Commitment

Before execution begins, recite:
> "I will execute this plan to completion. All the [X] tasks will be addressed and marked as DONE."

## Status Markers

| Marker | Status | Meaning |
|--------|--------|---------|
| `[ ]` | PENDING | Not started |
| `[~]` | IN_PROGRESS | Currently working on |
| `[x]` | DONE | Completed successfully |
| `[!]` | FAILED | Could not complete |

## Execution Cycle

```
1. RECITE COMMITMENT
   ↓
2. READ PLAN
   → Identify pending tasks via status markers
   ↓
3. ANNOUNCE NEXT TASK
   → Signal which task is next
   ↓
4. UPDATE STATUS
   → Change marker to [~] IN_PROGRESS
   ↓
5. EXECUTE & COMPLETE
   → Perform all required actions
   → Mark [x] DONE or [!] FAILED
   ↓
6. VERIFY COMPLETION
   → Re-read plan to confirm all tasks finished
   → Loop back to step 2 if tasks remain
```

## Plan File Format

```markdown
# Plan: [Task Name]

## Objective
Clear statement of what this plan achieves.

## Tasks

- [ ] Task 1: Description of first task
- [ ] Task 2: Description of second task
- [ ] Task 3: Description of third task

## Verification
How to confirm the plan succeeded.
```

## Activation Pattern

Recognize plan file paths formatted as:
- `plans/{date}-{task-name}-{version}.md`
- Or explicit execution requests

## Best Practices

1. **One task at a time** - Only one `[~]` at a time
2. **Immediate status updates** - Update markers as you work
3. **Clear announcements** - Say what you're doing before doing it
4. **Verify before finishing** - Re-read plan to confirm completion
5. **Handle failures explicitly** - Use `[!]` and document why

## Application to Agent Coordination Hub

### Current State
We have `TodoWrite` tool with similar status tracking (pending, in_progress, completed).

### Enhancement Ideas
1. **Adopt markers in tasks** - Add marker field to task schema
2. **Commitment recitation** - Agents announce commitment at start
3. **Verification step** - Explicit verification before marking complete
4. **Plan files** - Store complex plans as markdown files
5. **Execute-plan command** - Slash command to execute a plan file

### Mapping to Hub
| Execute-Plan | Hub Equivalent |
|--------------|----------------|
| `[ ]` PENDING | `status: todo` |
| `[~]` IN_PROGRESS | `status: in-progress` |
| `[x]` DONE | `status: done` |
| `[!]` FAILED | `status: blocked` |
