---
cluster: [technical, safety]
complexity: L2
ai_summary: "AI evaluation benchmarks (MMLU, ARC-AGI, HLE, SWE-bench), capability assessment frameworks, and progress measurement. Covers benchmark saturation and newer evaluation approaches."
dependencies:
  - training-pipeline.md
  - responsible-ai.md
tags: [evaluation, benchmarks, MMLU, ARC-AGI, capability-assessment]
last_updated: 2025-12-06
---

# Evaluation Framework for AI Development

> Benchmarking, capability assessment, and measuring progress

## Why Evaluation Matters

Without rigorous evaluation:
- You can't measure progress
- You can't compare to competitors
- You can't identify weaknesses
- You can't communicate value to stakeholders

## Core Benchmark Categories

### Knowledge & Reasoning

| Benchmark | What It Measures | Current SOTA |
|-----------|------------------|--------------|
| **MMLU** | General knowledge (57 subjects) | ~90% |
| **MMLU-Pro** | Harder reasoning variants | ~75% |
| **ARC-Challenge** | Science reasoning | ~95% |
| **HellaSwag** | Commonsense reasoning | ~95% |
| **Winogrande** | Pronoun resolution | ~85% |

### Mathematics

| Benchmark | What It Measures | Current SOTA |
|-----------|------------------|--------------|
| **GSM8K** | Grade school math | ~95% |
| **MATH** | Competition math | ~75% |
| **Minerva** | STEM problem solving | ~60% |

### Coding

| Benchmark | What It Measures | Current SOTA |
|-----------|------------------|--------------|
| **HumanEval** | Python functions | ~95% (pass@1) |
| **MBPP** | Python basics | ~90% |
| **SWE-bench** | Real GitHub issues | ~55% |
| **LiveCodeBench** | Fresh coding problems | ~40% |

### Agent Capabilities

| Benchmark | What It Measures | Current SOTA |
|-----------|------------------|--------------|
| **GAIA** | General AI assistant | ~60% (L3) |
| **AgentBench** | 8 environment tasks | Varies |
| **WebArena** | Web navigation | ~35% |
| **OSWorld** | Computer use | ~20% |

### Safety & Alignment

| Benchmark | What It Measures | Purpose |
|-----------|------------------|---------|
| **TruthfulQA** | Factual accuracy | Hallucination |
| **BBQ** | Social bias | Fairness |
| **RealToxicityPrompts** | Toxic outputs | Safety |
| **HarmBench** | Harmful capabilities | Red teaming |
| **AdvBench** | Jailbreak resistance | Robustness |

## Evaluation Framework Design

### Multi-Dimensional Assessment

```
                    Capability
                       ↑
           Safety ←─── Model ───→ Efficiency
                       ↓
                    Alignment
```

### Recommended Evaluation Matrix

| Dimension | Metrics | Weight |
|-----------|---------|--------|
| Capability | Benchmark scores | 30% |
| Safety | Refusal rate, toxicity | 25% |
| Efficiency | Latency, cost/token | 20% |
| Alignment | Helpfulness, honesty | 15% |
| Robustness | Adversarial performance | 10% |

## Evaluation Best Practices

### 1. Avoid Contamination

```python
# Check for benchmark leakage
for example in test_set:
    if fuzzy_match(example, training_data, threshold=0.8):
        flag_contaminated(example)
```

**Signs of contamination:**
- Perfect scores on specific subsets
- Sudden jumps in performance
- Memorized formatting

### 2. Use Multiple Evaluation Methods

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| Static benchmarks | Reproducible | Can be gamed |
| LLM-as-judge | Nuanced | Biased toward similar models |
| Human evaluation | Ground truth | Expensive, slow |
| A/B testing | Real-world signal | Requires users |

### 3. Test at Multiple Temperatures

| Temperature | What It Tests |
|-------------|---------------|
| 0.0 | Deterministic capability |
| 0.3-0.5 | Typical usage |
| 0.7-1.0 | Creativity, diversity |

### 4. Evaluate Edge Cases

- Very long inputs
- Adversarial prompts
- Multi-turn conversations
- Tool use chains
- Rare languages/domains

## Building Internal Evaluation Suite

### Essential Components

```
evaluation/
├── benchmarks/           # Standard benchmarks
│   ├── mmlu/
│   ├── humaneval/
│   └── custom/
├── safety/              # Safety evaluations
│   ├── toxicity/
│   ├── bias/
│   └── jailbreak/
├── capability/          # Capability tests
│   ├── reasoning/
│   ├── coding/
│   └── knowledge/
├── human_eval/          # Human evaluation
│   ├── preference/
│   └── quality/
└── reports/             # Results tracking
```

### Evaluation Pipeline

```python
# Pseudocode for evaluation pipeline
def evaluate_model(model, suite="standard"):
    results = {}

    # Run benchmarks
    for benchmark in get_benchmarks(suite):
        results[benchmark.name] = run_benchmark(model, benchmark)

    # Safety checks
    results["safety"] = run_safety_suite(model)

    # Capability probes
    results["capabilities"] = probe_capabilities(model)

    # Generate report
    return generate_report(results)
```

## Tracking Progress Over Time

### Metrics Dashboard

| Metric | Week 1 | Week 4 | Week 8 | Target |
|--------|--------|--------|--------|--------|
| MMLU | 45% | 52% | 61% | 75% |
| HumanEval | 30% | 42% | 55% | 70% |
| Toxicity | 2.1% | 1.5% | 0.8% | <0.5% |
| Latency | 850ms | 620ms | 480ms | <300ms |

### Progress Visualization

Track:
- Absolute benchmark scores
- Relative to competitors
- Improvement rate per training compute
- Safety metrics alongside capability

## Common Evaluation Pitfalls

### 1. Over-Optimizing for Benchmarks
- Teaching to the test
- Ignoring real-world performance
- **Fix:** Use held-out eval sets, live benchmarks

### 2. Single Metric Focus
- Ignoring trade-offs
- Missing capability gaps
- **Fix:** Multi-dimensional scoring

### 3. Ignoring Calibration
- Overconfident predictions
- Poor uncertainty estimates
- **Fix:** Test calibration explicitly

### 4. Static Evaluation
- Benchmarks become stale
- Model memorizes test data
- **Fix:** Regular benchmark updates, live evals

## Human Evaluation Protocol

### When to Use Human Eval

- Final quality assessment
- Subjective judgments (helpfulness, tone)
- Edge cases and failures
- A/B comparisons

### Rating Guidelines

| Score | Description |
|-------|-------------|
| 5 | Exceptional - Could be from an expert |
| 4 | Good - Correct and helpful |
| 3 | Acceptable - Mostly correct, minor issues |
| 2 | Poor - Significant errors or issues |
| 1 | Unacceptable - Wrong, harmful, or useless |

### Inter-Rater Reliability

- Use multiple raters per sample
- Calculate agreement metrics (Cohen's κ)
- Calibrate raters regularly
- Target κ > 0.7 for consistency

## Competitive Benchmarking

### Maintaining Leaderboard Position

1. Track competitor releases
2. Run same evals on competitor models
3. Identify capability gaps
4. Prioritize closing gaps

### Benchmark Timing Strategy

| Release Stage | Evaluation Focus |
|---------------|------------------|
| Development | Internal evals, fast iteration |
| Pre-release | Full benchmark suite |
| Launch | Public benchmarks, human eval |
| Post-launch | User feedback, live metrics |

---

*Last updated: December 6, 2025*
