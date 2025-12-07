---
cluster: [llm-techniques, prompting]
complexity: L2
ai_summary: Prompt engineering patterns - Chain-of-Thought, Few-Shot, Progressive Disclosure, Instruction Hierarchy for effective LLM communication
dependencies: []
source: microck/ordinary-claude-skills
last_updated: 2025-12-07
tags: [prompt-engineering, chain-of-thought, few-shot, llm, prompting]
---

# Prompt Engineering Patterns

## Core Patterns

### Few-Shot Learning
Provide examples for pattern recognition:
- Input-output pairs demonstrating desired behavior
- Strategic example selection (diversity sampling)
- Dynamic retrieval from knowledge bases
- Edge case coverage

### Chain-of-Thought (CoT)
Step-by-step reasoning elicitation:
- Zero-shot: "Let's think step by step"
- Few-shot: Examples with reasoning traces
- Self-consistency: Multiple sampling paths
- Verification steps at end

### Progressive Disclosure
Start simple, increase complexity:
```
1. Direct instruction
2. Add constraints
3. Incorporate reasoning requirements
4. Include examples
```
Avoids over-engineering from start.

### Instruction Hierarchy
Standard structure:
```
[System Context]
↓
[Task Instruction]
↓
[Examples]
↓
[Input Data]
↓
[Output Format]
```

## Integration Patterns

### RAG Integration
Combine retrieved context with prompts:
- Explicitly request answers based on provided materials
- Include source citations
- Handle uncertainty gracefully

### Validation Integration
Self-verification in prompts:
- "Check if response is direct"
- "Verify sources are cited"
- "Acknowledge uncertainty where present"

## Optimization Strategies

### Token Efficiency
- Remove redundancy
- Use consistent abbreviations
- Consolidate instructions
- Move stable content to system prompts

### Performance
- Minimize prompt length
- Use streaming for long outputs
- Cache common prefixes
- Batch similar requests

## Metrics to Track

- Accuracy
- Consistency across runs
- Latency
- Token usage
- Success rate
- User satisfaction

## Application to Agent Coordination

**Direct mappings:**
- Instruction hierarchy → Agent system prompts structure
- Chain-of-thought → Agent reasoning traces in work logs
- Progressive disclosure → Hot-start context loading (summary first)
- Few-shot → Showing agents examples from memory
