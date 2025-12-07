---
cluster: [development, coordination]
complexity: L2
ai_summary: Systematic code review methodology with 4-phase process, severity labels, and collaborative feedback techniques
dependencies: []
last_updated: 2025-12-07
tags: [code-review, pr-review, feedback, collaboration, quality]
source: ordinary-claude-skills
---

# Code Review Excellence

Transform reviews from gatekeeping into collaborative knowledge-sharing through constructive feedback and systematic analysis.

## Core Purpose

Reviews aim to:
- Catch bugs before production
- Ensure maintainability
- Share knowledge across team
- Enforce standards
- Improve design
- Build team culture

Reviews do NOT aim to:
- Showcase expertise
- Enforce personal preferences
- Block progress unnecessarily
- Rewrite code to your taste

## Feedback Quality Principles

Effective feedback is:
- **Specific and actionable** - Not vague criticism
- **Educational** - Explains the why
- **Code-focused** - Not about the person
- **Balanced** - Includes praise
- **Prioritized** - Important issues first

## Four-Phase Review Process

### Phase 1: Context (2-3 min)

Before looking at code:
- [ ] Read PR description fully
- [ ] Check PR size (ideal: 200-400 lines)
- [ ] Verify CI/CD status
- [ ] Understand the requirement
- [ ] Note relevant architecture decisions

### Phase 2: High-Level (5-10 min)

Scan for:
- Architecture/design fit
- File organization
- Overall approach
- Testing strategy completeness
- Consistency with codebase

### Phase 3: Line-by-Line (10-20 min)

Evaluate each file for:
- Logic correctness
- Edge cases
- Security vulnerabilities
- Performance implications
- Maintainability
- Error handling

### Phase 4: Summary (2-3 min)

- Highlight main concerns
- Acknowledge strengths
- Make clear decision: Approve / Comment / Request Changes

## Severity Labels

Use consistent labels for feedback priority:

| Label | Meaning | Action Required |
|-------|---------|-----------------|
| 🔴 **Blocking** | Must fix before merge | Yes |
| 🟡 **Important** | Should fix, can discuss | Recommended |
| 🟢 **Nice-to-have** | Improvement opportunity | Optional |
| 💡 **Suggestion** | Alternative approach | Consider |
| 📚 **Educational** | Learning opportunity | FYI |
| 🎉 **Praise** | Great work! | None |

## Feedback Techniques

### Question Approach

Instead of directives, ask questions:

```
❌ "This will fail if items is empty"
✅ "What happens if items is empty here?"
```

Questions invite discussion and often reveal context you didn't have.

### Collaborative Language

```
❌ "Extract this into a utility function"
✅ "Consider extracting this into a utility function - it's used in three places"
```

### Specific Examples

```
❌ "This could be cleaner"
✅ "This could use early return to reduce nesting:
    if (!user) return null;
    return processUser(user);"
```

## Review Checklist

### Security
- [ ] Input validated/sanitized
- [ ] Authentication checked
- [ ] Authorization verified
- [ ] No secrets in code
- [ ] SQL injection prevented
- [ ] XSS prevented

### Performance
- [ ] No N+1 queries
- [ ] Appropriate caching
- [ ] No unnecessary re-renders
- [ ] Efficient algorithms
- [ ] Pagination for large data

### Maintainability
- [ ] Clear naming
- [ ] Appropriate comments
- [ ] Single responsibility
- [ ] Consistent patterns
- [ ] Tests included

### Error Handling
- [ ] Errors caught appropriately
- [ ] User-friendly messages
- [ ] Logging for debugging
- [ ] Graceful degradation

## Handling Disagreements

When you disagree with the author:

1. **Seek understanding** - Ask why they chose this approach
2. **Acknowledge valid points** - There may be context you lack
3. **Provide data** - Back opinions with evidence
4. **Escalate if needed** - Get a third opinion
5. **Know when to let go** - Not every hill is worth dying on

## Time Management

- **Review promptly** - Within 24 hours
- **Focused blocks** - 60 minutes max per session
- **PR size** - Request splits for 400+ line changes
- **Automate** - Let linters handle formatting

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Nitpicking | Blocks on trivial issues | Focus on important issues |
| Perfectionism | Never approves | Set realistic standards |
| Delayed reviews | Blocks team progress | Prioritize reviews |
| Scope creep | Requests unrelated changes | Stay focused on PR scope |
| Drive-by comments | No follow-up | Complete the conversation |
| Rubber stamping | Misses real issues | Allocate proper time |

## Application to Agent Coordination Hub

### Current Review Process
- QC workflow in CLAUDE.md requires review before push
- Another agent (not implementer) must approve
- Build and tests must pass

### Enhancement Ideas

1. **Review command**
   - `/review <pr-number>` triggers systematic review
   - Applies 4-phase process
   - Generates structured feedback

2. **Review handoff**
   - Create handoff with review request
   - Include context and concerns
   - Track review status

3. **Review templates**
   - Pre-built checklists for common changes
   - Security review template
   - Performance review template

4. **Review metrics**
   - Track review turnaround time
   - Measure review quality (bugs caught)
   - Identify training opportunities
