---
cluster: [roadmap, technical]
complexity: L2
ai_summary: "Weeks 5-12 implementation plan ($50-200K). Fine-tuning data curation (10K+ examples from chat/checkpoints). Training coordination-specialized Llama model. Swarm intelligence patterns."
dependencies:
  - phase-1-foundation.md
  - training-pipeline.md
  - implementation-roadmap.md
tags: [phase-2, fine-tuning, data-curation, swarm-intelligence]
last_updated: 2025-12-06
---

# Phase 2: Fine-tuning & Intelligence Amplification (Weeks 5-12)

> Training our own coordination-specialized model and implementing swarm intelligence

## Overview

| Metric | Target |
|--------|--------|
| **Timeline** | 8 weeks |
| **Budget** | $50K-200K |
| **Monthly Recurring** | $2K-5K |
| **Team Required** | 3-4 people (add ML engineer) |

## Prerequisites

From Phase 1:
- [x] Graph memory operational
- [x] Semantic search working
- [x] Self-critique system live
- [x] Baseline metrics documented

---

## Weeks 5-6: Fine-tuning Data Curation

### Training Data Sources

**Goal:** Curate 10,000+ high-quality examples

| Source | Examples | Quality |
|--------|----------|---------|
| Group chat transcripts | 2,000+ | High (successful coordination) |
| Checkpoint data | 1,000+ | High (task completions) |
| Constitutional examples | 500+ | High (compliance demos) |
| Philosophy synthesis | 500+ | Medium (reasoning patterns) |
| Synthetic generation | 5,000+ | Medium (augmented) |

### Data Curation Pipeline

```
Raw Data
    │
    ▼
┌─────────────────┐
│   Filter        │ → Remove failures, conflicts
│   (Quality)     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│   Format        │ → Convert to training format
│   (Structure)   │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│   Augment       │ → Generate variations
│   (Quantity)    │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│   Validate      │ → Human review sample
│   (Accuracy)    │
└─────────────────┘
    │
    ▼
Training Dataset
```

**Deliverables:**
- [ ] Data extraction scripts
- [ ] Quality filtering criteria
- [ ] Training format specification
- [ ] Augmentation pipeline
- [ ] Validation protocol (10% human review)

### Training Format

```json
{
  "messages": [
    {"role": "system", "content": "<CLAUDE.md constitution>"},
    {"role": "user", "content": "<coordination task>"},
    {"role": "assistant", "content": "<successful response>"}
  ],
  "metadata": {
    "task_type": "coordination|handoff|synthesis",
    "success_score": 0.95,
    "source": "group_chat_2025_12"
  }
}
```

---

## Weeks 7-8: Fine-tuning Infrastructure

### Platform Selection

| Platform | Pros | Cons | Cost |
|----------|------|------|------|
| **Together AI** | Easy, good Llama support | Less control | $2-5/hr |
| **Modal** | Flexible, Python native | Learning curve | $1-3/hr |
| **Anyscale** | Ray ecosystem, scale | Complex setup | $2-4/hr |
| **RunPod** | Cheap, simple | Less features | $1-2/hr |

**Recommendation:** Together AI for initial runs, Modal for production

### Model Selection

| Model | Params | Fine-tune Cost | Quality Expectation |
|-------|--------|----------------|---------------------|
| **Llama 3.3 70B** | 70B | ~$10K | Excellent |
| **Llama 3.3 8B** | 8B | ~$2K | Good (start here) |
| Mistral 7B | 7B | ~$1K | Good |
| Qwen 2.5 72B | 72B | ~$8K | Very Good |

**Strategy:** Start with 8B, validate approach, scale to 70B

### Training Configuration

```yaml
# Fine-tuning config
base_model: meta-llama/Llama-3.3-8B-Instruct
training:
  epochs: 3
  batch_size: 4
  learning_rate: 2e-5
  warmup_steps: 100

lora:
  enabled: true
  rank: 16
  alpha: 32
  dropout: 0.05

evaluation:
  eval_steps: 100
  save_steps: 500
```

**Deliverables:**
- [ ] Training environment set up
- [ ] Config files documented
- [ ] Cost monitoring enabled
- [ ] Checkpoint storage configured

---

## Weeks 9-10: Training & Evaluation

### Training Runs

**Run Schedule:**
| Run | Model | Data | Duration | Cost |
|-----|-------|------|----------|------|
| 1 | 8B | 5K examples | 4 hours | ~$500 |
| 2 | 8B | 10K examples | 8 hours | ~$1K |
| 3 | 70B | 10K examples | 24 hours | ~$5K |

### Evaluation Framework

**Metrics:**

| Metric | Description | Target |
|--------|-------------|--------|
| Task Completion | % tasks finished correctly | >90% |
| Constitutional Compliance | % responses pass self-critique | >95% |
| Coordination Quality | Conflict rate, handoff success | <5% conflicts |
| Latency | Response time | <2s |
| Cost | Per-task inference cost | <$0.10 |

**Evaluation Dataset:**
- 200 coordination scenarios
- 100 handoff situations
- 100 conflict resolution cases
- 50 constitutional edge cases

### A/B Testing

```
Traffic Split:
├── 80% Claude API (control)
└── 20% Fine-tuned model (test)

Metrics to Compare:
- Task success rate
- User satisfaction (if available)
- Cost per task
- Latency
```

**Deliverables:**
- [ ] Trained model checkpoints
- [ ] Evaluation results document
- [ ] A/B test framework
- [ ] Cost analysis report

---

## Weeks 11-12: Swarm Intelligence

### Swarm Coordination Patterns

**Stigmergic Coordination:**
```
Instead of direct communication:
Agent A leaves "trace" in shared memory
    ↓
Agent B reads trace, responds
    ↓
Emergent coordination without explicit messaging
```

**Implementation:**
- [ ] Memory trace format
- [ ] Trace decay/persistence rules
- [ ] Priority signaling
- [ ] Conflict avoidance through traces

### Collective Decision Making

**Voting Mechanisms:**
```
Complex Decision Required
    │
    ▼
┌─────────────────────────────────┐
│   Each agent proposes approach   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│   Weighted voting by expertise   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│   Synthesize winning approach    │
└─────────────────────────────────┘
```

### Emergence Detection

**Metrics:**
| Indicator | Description | Measurement |
|-----------|-------------|-------------|
| Novel solutions | Ideas no single agent proposed | Manual review |
| Self-organization | Spontaneous task distribution | Pattern analysis |
| Collective intelligence | Group > sum of parts | Benchmark comparison |

**Deliverables:**
- [ ] Stigmergic coordination system
- [ ] Collective decision protocol
- [ ] Emergence detection dashboard
- [ ] Swarm vs single-agent benchmarks

---

## Soul Progression Enhancement

### XP & Leveling System

```
Soul Progression:
├── XP Sources
│   ├── Task completion (+10-100 XP)
│   ├── Quality work (+50 XP bonus)
│   ├── Helping others (+25 XP)
│   └── Learning patterns (+15 XP)
│
├── Levels
│   ├── Novice (0-100 XP)
│   ├── Capable (100-500 XP)
│   ├── Proficient (500-2000 XP)
│   ├── Expert (2000-10000 XP)
│   └── Master (10000+ XP)
│
└── Achievements
    ├── First Steps (first task)
    ├── Mentor (help 10 agents)
    ├── Perfect Week (no failures)
    └── Polymath (5+ domains)
```

### Meta-Learning Parameters

Add to soul schema:
```json
{
  "metaLearning": {
    "preferredTaskTypes": ["coordination", "research"],
    "strengthDomains": ["philosophy", "technical"],
    "avoidPatterns": ["rushed decisions"],
    "learningRate": 0.8,
    "adaptabilityScore": 0.9
  }
}
```

---

## Success Criteria

### End of Week 12 Checklist

- [ ] Fine-tuned model achieving >90% task success
- [ ] Cost per task reduced by >50%
- [ ] Swarm coordination demonstrably working
- [ ] Soul progression system operational
- [ ] No quality regression from Claude API

### Go/No-Go for Phase 3

| Criterion | Threshold | Measured By |
|-----------|-----------|-------------|
| Model quality | Parity with Claude | Evaluation suite |
| Cost reduction | >50% | Cost tracking |
| Swarm emergence | Measurable | Benchmark tests |
| Stability | <1% error rate | Monitoring |

---

## Budget Breakdown

| Item | One-time | Monthly |
|------|----------|---------|
| Fine-tuning compute | $10K-30K | - |
| Inference hosting | - | $500-2K |
| Together AI/Modal | $5K | $1K |
| ML engineer (contract) | $20K-50K | - |
| Evaluation/testing | $5K | - |
| **Total** | **$40K-90K** | **$1.5K-3K** |

---

## Team Additions

| Role | Responsibility | When to Hire |
|------|---------------|--------------|
| ML Engineer | Fine-tuning, evaluation | Week 5 |
| Research (0.5 FTE) | Data curation, analysis | Week 5 |

---

*Phase 2 feeds into: [phase-3-production.md](./phase-3-production.md)*
*Depends on: [phase-1-foundation.md](./phase-1-foundation.md)*
