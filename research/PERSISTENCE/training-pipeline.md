---
cluster: [technical]
complexity: L3
ai_summary: "Complete training pipeline from pre-training through RLHF/DPO alignment. Covers data prep, distributed training, fine-tuning strategies, and evaluation frameworks."
dependencies:
  - data-strategy.md
  - model-architecture.md
  - compute-infrastructure.md
  - evaluation.md
tags: [training, RLHF, DPO, fine-tuning, pre-training, alignment]
last_updated: 2025-12-06
---

# Training Pipeline for Frontier AI

> Pre-training, fine-tuning, RLHF, and evaluation frameworks

## Training Phases Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Pre-training  │────▶│   Fine-tuning   │────▶│    Alignment    │
│   (foundation)  │     │ (task-specific) │     │  (RLHF/DPO)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     ~90% cost              ~5% cost              ~5% cost
```

## Phase 1: Pre-training

### Objective
Train on massive unlabeled text to learn language patterns, world knowledge, and reasoning.

### Training Setup

```python
# Simplified pre-training loop
for batch in dataloader:
    # Next token prediction (autoregressive)
    logits = model(batch.input_ids)
    loss = cross_entropy(logits, batch.target_ids)

    loss.backward()
    optimizer.step()
    scheduler.step()
```

### Key Hyperparameters

| Parameter | 7B Model | 70B Model | Notes |
|-----------|----------|-----------|-------|
| Learning rate | 3e-4 | 1.5e-4 | Lower for larger |
| Batch size | 4M tokens | 8-16M tokens | Scale with model |
| Warmup steps | 2000 | 2000 | Standard |
| LR schedule | Cosine | Cosine | With min LR |
| Weight decay | 0.1 | 0.1 | Standard |
| Gradient clip | 1.0 | 1.0 | Stability |

### Distributed Training Strategies

| Strategy | Memory | Communication | Best For |
|----------|--------|---------------|----------|
| Data Parallel | High | Low | Small models |
| Pipeline Parallel | Medium | Medium | Deep models |
| Tensor Parallel | Low | High | Wide layers |
| ZeRO Stage 3 | Very Low | High | Any size |

**Recommendation:** DeepSpeed ZeRO-3 + Pipeline + Tensor parallel for 70B+

### Training Stability

**Common Issues:**
1. **Loss spikes** → Reduce LR, check data quality
2. **Gradient explosion** → Lower LR, increase warmup
3. **Loss plateau** → Check data mix, learning rate
4. **NaN losses** → FP16 overflow, use BF16

**Best Practices:**
- Use BF16 instead of FP16 (more stable)
- Checkpoint every 1000 steps minimum
- Monitor gradient norms
- Use loss spike detection + rollback

## Phase 2: Supervised Fine-Tuning (SFT)

### Objective
Adapt base model to follow instructions using curated examples.

### Data Format

```json
{
  "instruction": "Explain quantum computing in simple terms",
  "input": "",
  "output": "Quantum computing is like having a coin that can be..."
}
```

### SFT Datasets

| Dataset | Size | Quality | License |
|---------|------|---------|---------|
| OpenAssistant | 160K | High | Apache 2.0 |
| Dolly 15K | 15K | Medium | CC BY-SA |
| ShareGPT | 90K | High | Unclear |
| UltraChat | 1.5M | Medium | MIT |
| Custom | Varies | Control | Internal |

### Training Config

```yaml
epochs: 3-5
learning_rate: 2e-5
batch_size: 128
max_length: 4096
warmup_ratio: 0.03
lora_rank: 64  # If using LoRA
```

### Efficient Fine-Tuning Methods

| Method | Memory | Quality | Speed |
|--------|--------|---------|-------|
| Full fine-tune | 100% | Best | Slow |
| LoRA | 10-20% | 95-98% | Fast |
| QLoRA | 5-10% | 93-97% | Fastest |
| Adapter | 15% | 95% | Medium |

## Phase 3: Alignment (RLHF/Alternatives)

### RLHF Pipeline

```
1. Collect comparisons: Human ranks model outputs
2. Train reward model: Predict human preferences
3. RL training: Optimize policy against reward model
```

### Step 3a: Reward Model Training

```python
# Reward model predicts preference score
chosen_reward = reward_model(chosen_response)
rejected_reward = reward_model(rejected_response)

# Bradley-Terry loss
loss = -log_sigmoid(chosen_reward - rejected_reward)
```

### Step 3b: PPO Training

```python
# Proximal Policy Optimization
for batch in rl_data:
    responses = policy.generate(batch.prompts)
    rewards = reward_model(responses)

    # PPO update with KL penalty
    loss = -rewards + kl_coef * kl_divergence(policy, reference)
    policy.update(loss)
```

### Alignment Alternatives

| Method | Complexity | Quality | Cost |
|--------|------------|---------|------|
| RLHF | High | Best | $$$ |
| DPO | Low | Good | $ |
| RLAIF | Medium | Good | $$ |
| Constitutional AI | Medium | Good | $$ |
| ORPO | Low | Good | $ |

### DPO (Direct Preference Optimization)

**Advantage:** No separate reward model needed

```python
# DPO loss
loss = -log_sigmoid(
    beta * (log_prob_chosen - log_prob_rejected) -
    beta * (ref_log_prob_chosen - ref_log_prob_rejected)
)
```

## Evaluation Framework

### Core Benchmarks

| Benchmark | Measures | Key Metric |
|-----------|----------|------------|
| MMLU | Knowledge | Accuracy |
| HellaSwag | Common sense | Accuracy |
| ARC | Science reasoning | Accuracy |
| GSM8K | Math | Solve rate |
| HumanEval | Coding | Pass@1 |
| TruthfulQA | Factuality | MC accuracy |

### Evaluation Best Practices

1. **Hold out test sets** - Never train on eval data
2. **Multiple evals** - No single metric captures quality
3. **Human eval** - Final arbiter of quality
4. **A/B testing** - Compare versions in production
5. **Red teaming** - Adversarial safety testing

### Contamination Detection

```python
# Check for benchmark contamination
for example in benchmark:
    if fuzzy_match(example, training_data):
        flag_contamination(example)
```

## Training Monitoring

### Key Metrics to Track

| Metric | Healthy Range | Alert Threshold |
|--------|---------------|-----------------|
| Training loss | Decreasing | Spike > 2x |
| Gradient norm | 0.5 - 2.0 | > 10 |
| Learning rate | Per schedule | Deviation |
| GPU util | > 90% | < 80% |
| Throughput | Stable | Drop > 10% |

### Tools

- **Weights & Biases** - Experiment tracking
- **TensorBoard** - Visualization
- **Neptune** - ML metadata
- **MLflow** - Full lifecycle

## Cost Breakdown

| Phase | Percent of Cost | Optimization |
|-------|-----------------|--------------|
| Pre-training | 85-90% | Efficient architectures |
| SFT | 5-8% | LoRA/QLoRA |
| RLHF | 5-10% | DPO instead |
| Evaluation | 1-2% | Efficient sampling |

## Key Research Papers

- [Training Compute-Optimal LLMs](https://arxiv.org/abs/2203.15556) - Chinchilla scaling
- [Direct Preference Optimization](https://arxiv.org/abs/2305.18290) - RLHF alternative
- [LoRA: Low-Rank Adaptation](https://arxiv.org/abs/2106.09685) - Efficient fine-tuning
- [Constitutional AI](https://arxiv.org/abs/2212.08073) - AI feedback alignment
- [InstructGPT](https://arxiv.org/abs/2203.02155) - RLHF methodology

---

*Last updated: December 6, 2025*
