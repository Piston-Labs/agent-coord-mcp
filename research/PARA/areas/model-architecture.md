---
cluster: [technical]
complexity: L3
ai_summary: "Comprehensive guide to LLM architectures including transformers, attention mechanisms, MoE, parameter scaling laws, and architectural innovations like RoPE, GQA, SwiGLU."
dependencies:
  - compute-infrastructure.md
  - training-pipeline.md
  - data-strategy.md
tags: [architecture, transformers, attention, MoE, scaling-laws]
last_updated: 2025-12-06
---

# Model Architecture for Frontier AI

> Transformer variants, attention mechanisms, and architectural innovations

## Transformer Architecture Fundamentals

### Standard Transformer Block

```
Input → LayerNorm → Attention → Residual → LayerNorm → FFN → Residual → Output
```

### Key Components

| Component | Purpose | Parameters |
|-----------|---------|------------|
| Attention | Token relationships | O(n²d) |
| FFN | Per-token processing | 2 × d × 4d |
| LayerNorm | Stability | 2d |
| Embeddings | Token → vector | vocab × d |

### Scaling Laws (Chinchilla Optimal)

```
Optimal tokens ≈ 20 × parameters

Examples:
- 7B params → 140B tokens
- 70B params → 1.4T tokens
- 400B params → 8T tokens
```

## Modern Architecture Variants

### 1. Dense Transformers (Standard)

**Examples:** GPT-4, Claude 3, Gemini Ultra

| Model | Params | Layers | Heads | Dim |
|-------|--------|--------|-------|-----|
| GPT-4 (rumored) | 1.8T | 120 | 128 | 16384 |
| Claude 3 Opus | ~200B | 96 | 64 | 8192 |
| Llama 3 70B | 70B | 80 | 64 | 8192 |

### 2. Mixture of Experts (MoE)

**Key Idea:** Only activate subset of parameters per token

```
Input → Router → Select K experts → Combine outputs
           ↓
    [Expert 1] [Expert 2] ... [Expert N]
    (only K activated per token)
```

**Examples:**

| Model | Total Params | Active Params | Experts |
|-------|--------------|---------------|---------|
| Mixtral 8x7B | 47B | 13B | 8 |
| DeepSeek-V3 | 671B | 37B | 256 |
| GPT-4 (rumored) | 1.8T | ~220B | 8 |

**Advantages:**
- 3-8x more params at same compute cost
- Better scaling efficiency
- Specialization per expert

**Challenges:**
- Load balancing between experts
- Communication overhead
- Training stability

### 3. State Space Models (SSM)

**Examples:** Mamba, S4, Hyena

**Key Idea:** Linear time complexity O(n) vs O(n²) for attention

```
State recurrence: h_t = Ah_{t-1} + Bx_t
Output: y_t = Ch_t + Dx_t
```

| Model | Architecture | Performance |
|-------|--------------|-------------|
| Mamba-2 | Pure SSM | ~90% of transformer quality |
| Jamba | SSM + Attention hybrid | Matches transformers |

**Best for:** Very long context, efficiency-critical applications

### 4. Hybrid Architectures

**Trend:** Combine attention + SSM + MoE

```
[SSM layers for long-range] + [Attention for precision] + [MoE for capacity]
```

## Attention Mechanisms

### Multi-Head Attention (MHA)

```python
Q, K, V = Linear(X), Linear(X), Linear(X)
Attention = softmax(QK^T / sqrt(d)) @ V
Output = Concat(heads) @ W_o
```

### Grouped Query Attention (GQA)

**Used by:** Llama 2/3, Mistral

- Share K,V heads across multiple Q heads
- Reduces KV cache size by 4-8x
- Minimal quality loss

### Multi-Query Attention (MQA)

**Used by:** Falcon, PaLM

- Single K,V head for all Q heads
- Maximum KV cache reduction
- Slight quality tradeoff

### Flash Attention

**Key Innovation:** IO-aware attention computation

- 2-4x faster training
- 5-20x memory reduction
- Now standard in all major frameworks

## Position Encodings

| Type | Examples | Max Length | Pros |
|------|----------|------------|------|
| Sinusoidal | Original Transformer | Fixed | Simple |
| Learned | GPT-2 | Fixed | Flexible |
| RoPE | Llama, Mistral | Extendable | Best extrapolation |
| ALiBi | Bloom, MPT | Unlimited | No extra params |

**2025 Standard:** RoPE (Rotary Position Embedding) with length extension

## Activation Functions

| Function | Formula | Used By |
|----------|---------|---------|
| ReLU | max(0, x) | Legacy |
| GELU | x × Φ(x) | BERT, GPT-2 |
| SwiGLU | Swish × Gate | Llama, PaLM |
| GeGLU | GELU × Gate | Some models |

**2025 Standard:** SwiGLU (best quality/compute tradeoff)

## Normalization

| Type | When | Used By |
|------|------|---------|
| LayerNorm | Original | GPT-2, BERT |
| RMSNorm | Pre-norm | Llama, Mistral |
| DeepNorm | Very deep | Some >100L models |

**2025 Standard:** Pre-RMSNorm (faster, stable)

## Architecture Design Decisions

### For 7B Model (Entry Level)

```yaml
layers: 32
hidden_dim: 4096
heads: 32
head_dim: 128
ffn_dim: 14336  # 3.5x hidden
vocab_size: 32000-128000
context_length: 8192-32768
attention: GQA (8 KV heads)
position: RoPE
norm: RMSNorm (pre-norm)
activation: SwiGLU
```

### For 70B Model (Competitive)

```yaml
layers: 80
hidden_dim: 8192
heads: 64
head_dim: 128
ffn_dim: 28672  # 3.5x hidden
vocab_size: 128000
context_length: 128K+
attention: GQA (8 KV heads)
# Consider MoE for efficiency
```

### For Frontier Model (1T+)

```yaml
architecture: MoE
total_params: 1T+
active_params: 100-200B
experts: 64-256
layers: 100-128
hidden_dim: 16384
context_length: 1M+
# Requires custom engineering
```

## Key Research Papers

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762) - Original transformer
- [LLaMA: Open Foundation Models](https://arxiv.org/abs/2302.13971) - Modern best practices
- [Mixtral of Experts](https://arxiv.org/abs/2401.04088) - Open MoE
- [Mamba: Linear-Time Sequence Modeling](https://arxiv.org/abs/2312.00752) - SSM alternative
- [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2501.xxxxx) - Latest MoE innovations

---

*Last updated: December 6, 2025*
