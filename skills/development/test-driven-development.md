---
cluster: [development, technical]
complexity: L2
ai_summary: Test-Driven Development methodology with Red-Green-Refactor cycle, verification checklist, and discipline for writing tests first
dependencies: []
last_updated: 2025-12-07
tags: [tdd, testing, red-green-refactor, test-first, quality]
source: ordinary-claude-skills
---

# Test-Driven Development

Write the test first. Watch it fail. Write minimal code to pass.

## Core Principle

> "No production code without a failing test first."

If you wrote code before the test, delete it completely and start fresh. No exceptions for "reference" or "adaptation" - this would constitute testing after, violating the methodology.

## The Red-Green-Refactor Cycle

```
   ┌──────────────────────────────┐
   │                              │
   │    ┌─────┐                   │
   │    │ RED │ Write failing test│
   │    └──┬──┘                   │
   │       │                      │
   │       ▼                      │
   │  ┌────────┐                  │
   │  │ GREEN  │ Make it pass     │
   │  └───┬────┘                  │
   │      │                       │
   │      ▼                       │
   │ ┌──────────┐                 │
   └─┤ REFACTOR │ Clean up        │
     └──────────┘                 │
```

### RED: Write One Minimal Test

Write a test demonstrating required behavior:
- Clear, descriptive name
- Single behavior per test
- Use real code (avoid mocks where possible)
- Test actual outcomes

```typescript
// Good: Tests one specific behavior
it('returns empty array when no users match filter', () => {
  const users = [{ name: 'Alice', age: 25 }];
  const result = filterUsers(users, { minAge: 30 });
  expect(result).toEqual([]);
});
```

### Verify RED

**Run the test and confirm it fails correctly.**

The failure should indicate:
- Missing functionality (not a typo)
- The test validates something real
- The assertion would catch a bug

### GREEN: Write Minimal Code

Implement the simplest code that passes the test:
- Don't add features
- Don't refactor other code
- Don't over-engineer
- Just make it pass

```typescript
// Minimal implementation
function filterUsers(users, filter) {
  return users.filter(u => u.age >= filter.minAge);
}
```

### Verify GREEN

- Confirm the new test passes
- Verify no other tests broke
- All tests green before continuing

### REFACTOR: Clean Up

While maintaining green status:
- Remove duplication
- Improve names
- Extract helpers
- Simplify logic

After each change, verify tests still pass.

## Why Order Matters

| Tests-First | Tests-After |
|-------------|-------------|
| "What should this do?" | "What does this do?" |
| Finds bugs before commit | Finds bugs in production |
| Forces clear requirements | Implementation bias |
| Documents intended behavior | Documents current behavior |
| Enables safe refactoring | Refactoring is risky |

### The Problem with Tests-After

Testing after code passes immediately, proving nothing about whether tests actually catch bugs:
- Edge cases are overlooked
- Implementation bias influences test design
- False confidence in coverage
- Tests become maintenance burden

## Verification Checklist

Before marking task complete:

- [ ] Every new function has a test
- [ ] Each test failed before implementing
- [ ] Failures indicated missing features (not syntax errors)
- [ ] Minimal code written to pass tests
- [ ] All tests pass with clean output
- [ ] Tests use real code, not excessive mocks
- [ ] Edge cases covered
- [ ] Error cases covered

## Common Rationalizations (Rejected)

| Excuse | Reality |
|--------|---------|
| "TDD is dogmatic" | TDD is pragmatic - bugs found earlier |
| "I'll add tests later" | You won't, and they'll be weaker |
| "This is too simple to test" | Simple code has bugs too |
| "Mocking is fine" | Mocks test mocks, not code |
| "It's faster without tests" | Debugging is slower than TDD |

## TDD for Different Scenarios

### New Feature
1. Write test for happy path
2. Make it pass
3. Write test for edge case
4. Make it pass
5. Write test for error case
6. Make it pass
7. Refactor

### Bug Fix
1. Write test that reproduces the bug
2. Verify it fails
3. Fix the bug
4. Verify test passes
5. Bug can't recur (regression protected)

### Refactoring
1. Ensure existing tests pass
2. Make refactoring change
3. Run tests
4. Fix any failures
5. Confidence in refactoring

## Application to Agent Coordination Hub

### Current Testing
- `npm test` runs test suite
- Build must pass before push
- QC requires test verification

### Enhancement Ideas

1. **TDD workflow enforcement**
   - Track test-before-code pattern
   - Alert on tests added after implementation

2. **Test coverage visibility**
   - Show coverage in agent dashboard
   - Require minimum coverage for new code

3. **Test-first templates**
   - Generate test skeleton before implementation
   - Prompt for test case before code

4. **Bug fix protocol**
   - Require reproduction test in bug fix PRs
   - Verify test fails without fix
