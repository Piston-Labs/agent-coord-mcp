---
cluster: [development, technical]
complexity: L2
ai_summary: Systematic debugging methodology with scientific method framework, 4-phase process, and technology-specific tools for JS/Python/Go
dependencies: []
last_updated: 2025-12-07
tags: [debugging, troubleshooting, profiling, devtools, scientific-method]
source: ordinary-claude-skills
---

# Debugging Strategies

Transform debugging from trial-and-error into systematic problem-solving through proven techniques and methodologies.

## Foundational Approach

### Scientific Method Framework

```
OBSERVE → HYPOTHESIZE → EXPERIMENT → ANALYZE → REPEAT
```

1. **Observe** - What exactly is happening?
2. **Hypothesize** - What could cause this?
3. **Experiment** - Test the hypothesis
4. **Analyze** - Did the test confirm or refute?
5. **Repeat** - Until root cause found

### Critical Mindset Shifts

| Instead of | Do This |
|------------|---------|
| "It can't be X" | Verify with evidence |
| Assuming it works | Reproduce the issue |
| Shotgun debugging | Isolate methodically |
| Mental tracking | Document findings |
| Trusting intuition | Question everything |

### Rubber Duck Debugging

Articulate the code and problem aloud. Explaining forces clarity and often reveals the solution.

## Four-Phase Systematic Process

### Phase 1: Reproduction

**Questions to answer:**
- Does this happen consistently or intermittently?
- What are the exact steps to reproduce?
- What's the minimal reproducible case?
- What environment details matter?

**Create minimal reproduction:**
```
1. Remove unrelated code
2. Simplify data
3. Isolate the failing path
4. Document exact steps
```

### Phase 2: Information Gathering

Collect:
- **Error messages** - Full stack traces, error codes, log output
- **Environment** - OS, runtime versions, dependencies
- **Recent changes** - Git history, deployments
- **Scope** - Who/what is affected?

### Phase 3: Hypothesis Formation

Ask:
- What changed recently?
- What's different between working/broken states?
- Where are the failure points?
  - Input validation
  - Business logic
  - Data layer
  - External services

### Phase 4: Testing & Verification

Techniques:
- **Binary search** - Narrow down with git bisect
- **Strategic logging** - Add logs at key points
- **Component isolation** - Test parts independently
- **Differential analysis** - Compare working vs broken

## Binary Search Debugging

Use `git bisect` to find regression commits:

```bash
git bisect start
git bisect bad                    # Current commit is broken
git bisect good v1.2.0           # Last known good version
# Git checks out middle commit
# Test and report: git bisect good/bad
# Repeat until culprit found
git bisect reset
```

## Differential Debugging

Create comparison matrix:

| Factor | Working | Broken |
|--------|---------|--------|
| Environment | Dev | Prod |
| Node version | 18.0 | 20.0 |
| Database | Fresh | Migrated |
| User type | Admin | Regular |
| Browser | Chrome | Safari |
| Time | Morning | Evening |

Find the difference that matters.

## Technology-Specific Tools

### JavaScript/TypeScript

**Chrome DevTools:**
- Breakpoints (line, conditional, DOM, XHR)
- Watch expressions
- Call stack inspection
- Network throttling
- Performance profiler

**Console methods:**
```javascript
console.table(array);      // Display as table
console.time('label');     // Start timer
console.timeEnd('label');  // End timer
console.trace();           // Print stack trace
console.assert(condition); // Conditional log
```

### Python

**pdb / breakpoint():**
```python
import pdb; pdb.set_trace()  # Python < 3.7
breakpoint()                  # Python 3.7+

# Commands: n(ext), s(tep), c(ontinue), p(rint), l(ist)
```

**Post-mortem debugging:**
```python
import pdb
try:
    failing_function()
except:
    pdb.post_mortem()  # Inspect at crash point
```

### Go

**Delve debugger:**
```bash
dlv debug main.go
# break main.go:42
# continue
# print variable
# step
```

**Stack trace:**
```go
import "runtime/debug"
debug.PrintStack()
```

## Issue-Type Patterns

### Intermittent Bugs
- Add extensive logging
- Look for race conditions
- Check timing dependencies
- Stress test to reproduce

### Performance Issues
1. Profile BEFORE optimizing
2. Check common culprits:
   - N+1 database queries
   - Unnecessary re-renders
   - Large data processing
   - Missing indexes
3. Use appropriate tools (profilers, APM)

### Production Bugs
1. Gather evidence (logs, metrics, errors)
2. Reproduce locally with anonymized data
3. Never debug by changing production
4. Use feature flags for safe testing

## Quick Reference Checklist

When stuck, verify:
- [ ] Spelling and case sensitivity
- [ ] Null/undefined values
- [ ] Array index bounds
- [ ] Async/await timing
- [ ] Variable scope
- [ ] Type matching
- [ ] Dependencies installed
- [ ] Environment variables set
- [ ] File paths correct
- [ ] Cache cleared
- [ ] Data fresh

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Multiple changes at once | One change, test, repeat |
| Not reading full error | Read every line of stack trace |
| Overcomplicating | Simple issues hide in complexity |
| Leaving debug code | Remove before commit |
| Console.log only | Use real debugger |
| Giving up early | Take a break, return fresh |
| Not verifying fix | Confirm issue is resolved |

## Application to Agent Coordination Hub

### Current Debugging
- `errors` tool captures and tracks issues
- `do-trace` logs work steps
- Group chat for sharing findings

### Enhancement Ideas

1. **Debugging workflow command**
   - `/debug <issue>` triggers systematic process
   - Auto-gathers relevant logs
   - Creates investigation trace

2. **Shared debugging sessions**
   - Multiple agents collaborate on issue
   - Share findings in thread
   - Track hypotheses tested

3. **Post-mortem templates**
   - Structured format for resolved issues
   - Save to memory for future reference
   - Pattern matching for similar issues
