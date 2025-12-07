---
cluster: [development, research]
complexity: L2
ai_summary: Systematic technical research methodology prioritizing real code over tutorials with GitHub code search, web search, and documentation tools
dependencies: []
last_updated: 2025-12-07
tags: [research, github, code-search, methodology, documentation]
source: ordinary-claude-skills
---

# Research Methodology

Conduct systematic technical research using code search and web tools to find real-world implementations, not tutorials.

## Core Philosophy

> "Talk is cheap. Show me the code." - Linus Torvalds

Prioritize:
1. Real code > Blog posts
2. Production usage > Tutorials
3. Official docs > Medium articles
4. Recent content > Old posts
5. Specific examples > Generic advice

## Research Tools

| Tool | Purpose | Best For |
|------|---------|----------|
| **GitHub Code Search** | Literal code pattern matching | Real implementations |
| **Web Search** | Current articles and analysis | Best practices, comparisons |
| **Documentation Search** | Official docs, SDK references | Library how-tos |

### GitHub Code Search Tips

Search for actual syntax, not keywords:
```
# Good - finds real usage
"useState(" language:typescript

# Bad - too generic
react hooks state management

# Good - specific pattern
"try {" "await" language:python

# Good - configuration patterns
"CircuitBreaker(" "failureThreshold"
```

## Five-Step Research Workflow

### Step 1: Understand the Need

Identify research type:
- **How-to**: Implement specific feature
- **Comparison**: Choose between options
- **Debugging**: Solve specific problem
- **Best Practices**: Learn patterns
- **Architecture**: Design decisions

### Step 2: Choose Tools

| Need Type | Primary Tool | Secondary Tool |
|-----------|--------------|----------------|
| Library how-to | Documentation | GitHub code |
| Real examples | GitHub code | - |
| Best practices | Web search | GitHub verification |
| Comparisons | Web search | Code verification |
| Architecture | Documentation | Real implementations |

### Step 3: Execute Search

**Start specific:**
- Use exact function names
- Include version numbers
- Filter by language

**Verify with code:**
- Don't trust articles without code
- Check if code actually works
- Look for production repos

**Check dates:**
- Prefer 2025 content
- Be cautious of pre-2023 articles
- Verify library versions match

**Cross-reference:**
- Multiple sources confirm patterns
- Official docs validate approaches
- Real usage proves viability

### Step 4: Synthesize Findings

Output structure:
```markdown
## Research: [Topic]

### Core Answer
Direct answer to the research question.

### Evidence
1. **Code Example 1** - [source link]
   ```language
   // Real code snippet
   ```

2. **Code Example 2** - [source link]
   ```language
   // Another real example
   ```

### Official Context
What documentation says.

### Recommendations
Based on evidence, recommend:
1. Primary approach
2. Alternative if needed

### Pitfalls
Common mistakes to avoid.
```

### Step 5: Document

Save to: `docs/research/<YYYY-MM-DD>_<topic-slug>.md`

Include:
- Search queries used
- Sources consulted
- Date of research
- Confidence level

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Tutorial-only research | Verify with real code |
| Outdated documentation | Check version dates |
| Opinion without evidence | Find actual implementations |
| Keyword searches | Use code pattern searches |
| Single source | Cross-reference multiple |
| Generic advice | Find specific examples |

## Quality Indicators

### Good Research
- Multiple code examples from different repos
- Official documentation confirmation
- Recent (2024-2025) sources
- Production-grade implementations
- Clear confidence assessment

### Bad Research
- Only blog posts, no code
- Single source reliance
- Outdated versions
- Tutorial-only evidence
- No confidence statement

## Application to Agent Coordination Hub

### Current Research
We have `research/PERSISTENCE/` with curated research documents.

### Enhancement Ideas

1. **Research command**
   - `/research <topic>` triggers methodology
   - Auto-saves to docs/research/

2. **Memory integration**
   - Save key findings to memory tool
   - Tag with research category
   - Build knowledge base over time

3. **Verification workflow**
   - Research claims require code evidence
   - Link to actual implementations
   - Version and date stamp

4. **Research templates**
   - Standard format for research docs
   - YAML frontmatter for clustering
   - Confidence ratings
