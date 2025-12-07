---
cluster: [technical, development]
complexity: L2
ai_summary: Prompt engineering patterns including few-shot learning, chain-of-thought, template systems, and optimization techniques for reliable LLM outputs
dependencies: []
last_updated: 2025-12-07
tags: [prompting, llm, few-shot, chain-of-thought, templates, optimization]
source: ordinary-claude-skills
---

# Prompt Engineering Patterns

Advanced techniques for optimizing LLM performance through sophisticated prompting strategies for production-grade applications.

## Five Core Competencies

### 1. Few-Shot Learning

Select effective examples through:
- **Semantic matching** - Examples similar to expected inputs
- **Diversity sampling** - Cover edge cases and variations
- **Token constraints** - Stay within context limits

```markdown
Example 1:
Input: "The food was amazing and service was quick"
Output: {"sentiment": "positive", "confidence": 0.95}

Example 2:
Input: "Waited 2 hours, food was cold"
Output: {"sentiment": "negative", "confidence": 0.90}

Now analyze:
Input: "{{user_input}}"
```

### 2. Chain-of-Thought Prompting

Elicit step-by-step reasoning:

**Zero-Shot CoT:**
```
Let's think step by step.
```

**Few-Shot CoT:**
```
Question: If a store has 45 apples and sells 12, then receives 20 more, how many apples does it have?

Reasoning:
1. Start with 45 apples
2. Sell 12: 45 - 12 = 33 apples
3. Receive 20: 33 + 20 = 53 apples

Answer: 53 apples
```

**Self-Consistency:**
- Generate multiple reasoning paths
- Take majority vote on final answer
- Increases reliability for complex problems

### 3. Prompt Optimization

Iterative refinement process:
1. Start with simple direct instruction
2. Test on diverse inputs
3. Identify failure modes
4. Add constraints for failures
5. A/B test variations
6. Measure metrics (accuracy, latency, cost)

**Reducing tokens without quality loss:**
- Remove redundant instructions
- Use shorter example formats
- Compress context
- Use references instead of full content

### 4. Template Systems

```python
class PromptTemplate:
    def __init__(self, template: str):
        self.template = template

    def render(self, **variables) -> str:
        result = self.template
        for key, value in variables.items():
            result = result.replace(f"{{{{{key}}}}}", str(value))
        return result

# Usage
template = PromptTemplate("""
Analyze the following {{document_type}}:

{{content}}

Focus on: {{focus_areas}}
""")

prompt = template.render(
    document_type="code review",
    content=code,
    focus_areas="security, performance"
)
```

### 5. System Prompt Design

Establish model behavior:
- Role definition
- Output format specifications
- Safety guidelines
- Contextual framing
- Constraints and boundaries

```markdown
You are a code reviewer for a Python project.

ROLE: Senior Python developer with security expertise
OUTPUT FORMAT: JSON with fields: issues[], suggestions[], score
CONSTRAINTS:
- Only comment on actual problems
- Provide specific line numbers
- Suggest fixes, don't just criticize
```

## Progressive Complexity Framework

Start simple, add complexity only as needed:

```
Level 1: Direct instruction
"Summarize this text"

Level 2: Add constraints
"Summarize this text in 3 bullet points"

Level 3: Add reasoning
"Summarize this text in 3 bullet points. Focus on key facts."

Level 4: Add examples
"Summarize this text in 3 bullet points like this example: ..."
```

## Critical Success Factors

1. **Specificity over vagueness** - Be precise about what you want
2. **Show, don't tell** - Examples are more effective than descriptions
3. **Test extensively** - Diverse inputs reveal edge cases
4. **Iterate rapidly** - Small changes, frequent testing
5. **Monitor production** - Track metrics and failures
6. **Version control** - Prompts are code, treat them as such
7. **Document rationale** - Why this prompt works

## Key Warnings

- Don't over-complicate initial prompts
- Don't use mismatched examples
- Don't exceed token limits
- Don't use ambiguous language
- Don't skip edge case testing

## Application to Agent Coordination Hub

### Current Prompting
- CLAUDE.md provides system-level instructions
- Soul injection for identity persistence
- Context clusters for domain knowledge

### Enhancement Ideas

1. **Prompt templates for tools**
   - Standardize how agents call tools
   - Reduce token usage with templates

2. **Few-shot for common tasks**
   - Code review examples
   - Bug fix patterns
   - Feature implementation patterns

3. **Chain-of-thought for complex tasks**
   - Multi-step orchestrations
   - Debugging sessions
   - Architecture decisions

4. **Prompt versioning**
   - Track changes to CLAUDE.md
   - A/B test different instructions
   - Measure impact on agent performance
