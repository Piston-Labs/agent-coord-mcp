# Compute Infrastructure for Training AI

> Hardware, cloud, and infrastructure requirements for frontier model training

## Compute Requirements by Model Scale

### GPU/TPU Requirements (2025)

| Model Size | Training Compute | Hardware Config | Training Time |
|------------|------------------|-----------------|---------------|
| 7B params | ~10^21 FLOPs | 64 H100s | 1-2 weeks |
| 70B params | ~10^23 FLOPs | 512-1024 H100s | 1-2 months |
| 400B params | ~10^24 FLOPs | 4000+ H100s | 3-6 months |
| 1T+ params | ~10^25 FLOPs | 10,000+ H100s | 6-12 months |

### Cost Estimates

| Scale | Cloud Cost | On-Prem Investment |
|-------|------------|-------------------|
| 7B model | $100K - $500K | Not worth it |
| 70B model | $5M - $20M | $10M+ hardware |
| 400B model | $50M - $100M | $100M+ datacenter |
| Frontier | $100M - $500M | $500M+ |

## Hardware Options

### NVIDIA GPUs (Dominant 2025)

| GPU | Memory | FP16 TFLOPS | Cost (Cloud/hr) |
|-----|--------|-------------|-----------------|
| H100 SXM | 80GB | 1,979 | $3-4/hr |
| H200 | 141GB | 1,979 | $4-5/hr |
| B100 | 192GB | 3,500 | Coming 2025 |
| B200 | 192GB | 4,500 | Coming 2025 |

**Key:** H100 is current workhorse. Blackwell (B100/B200) offers 2-3x improvement.

### AMD GPUs (Emerging Alternative)

| GPU | Memory | Notes |
|-----|--------|-------|
| MI300X | 192GB | 2.4x H100 memory, competitive perf |
| MI325X | 256GB | Coming late 2025 |
| MI350 | TBD | 2026, claimed 35x MI300 for inference |

### Google TPUs

| TPU | Config | Best For |
|-----|--------|----------|
| TPUv5p | Pods of 8960 chips | Google's internal training |
| TPUv6 (Trillium) | 4.7x v5p perf | Coming 2025 |

### Custom ASICs

- **Groq LPU** - Inference focused, 500+ tokens/sec
- **Cerebras CS-3** - Wafer-scale, 900K cores
- **Amazon Trainium2** - AWS custom, 4x Trainium1

## Cloud Providers

### Tier 1: Hyperscalers

| Provider | GPU Availability | Pros | Cons |
|----------|-----------------|------|------|
| **AWS** | H100, Trainium | Best ecosystem, SageMaker | Expensive, limited H100 |
| **Azure** | H100, A100 | OpenAI partnership | Availability issues |
| **GCP** | TPU, H100, A100 | TPU access, best ML tools | Limited regions |

### Tier 2: GPU Clouds

| Provider | Specialty | Pricing |
|----------|-----------|---------|
| **Lambda Labs** | H100 clusters | ~$2/hr H100 |
| **CoreWeave** | Large GPU clusters | Competitive |
| **Together AI** | Training + inference | Usage-based |
| **Crusoe** | Clean energy | Similar to Lambda |

### Tier 3: Marketplace/Spot

| Provider | Model | Savings |
|----------|-------|---------|
| **Vast.ai** | P2P GPU rental | 50-70% off |
| **RunPod** | Serverless GPU | Flexible |
| **Jarvis Labs** | Research focused | Budget option |

## Training Infrastructure Stack

### Software Stack

```
┌─────────────────────────────────────┐
│           Training Code             │
│    (PyTorch, JAX, custom)          │
├─────────────────────────────────────┤
│      Distributed Training           │
│  (DeepSpeed, FSDP, Megatron-LM)    │
├─────────────────────────────────────┤
│        Communication Layer          │
│      (NCCL, Gloo, MPI)             │
├─────────────────────────────────────┤
│      Cluster Orchestration          │
│   (Kubernetes, Slurm, Ray)         │
├─────────────────────────────────────┤
│          Hardware                   │
│   (GPUs + NVLink + InfiniBand)     │
└─────────────────────────────────────┘
```

### Key Technologies

| Component | Options | Recommendation |
|-----------|---------|----------------|
| Framework | PyTorch, JAX | PyTorch (ecosystem) |
| Distributed | DeepSpeed, FSDP | DeepSpeed ZeRO-3 |
| Orchestration | K8s, Slurm | Kubernetes + Ray |
| Networking | InfiniBand, RoCE | InfiniBand (training) |
| Storage | Lustre, GPFS, S3 | Parallel FS + object store |

## Networking Requirements

### Interconnect Bandwidth

| Scale | Minimum | Recommended |
|-------|---------|-------------|
| 8 GPUs | NVLink | NVLink + PCIe |
| 64 GPUs | 100Gbps IB | 400Gbps IB |
| 1000+ GPUs | 400Gbps IB | 800Gbps IB |

**Critical:** Network is often the bottleneck. Budget 30-40% of hardware cost for networking.

## Power & Cooling

### Power Requirements

| GPU | TDP | Per-rack (8 GPUs) |
|-----|-----|-------------------|
| H100 SXM | 700W | 8-10 kW |
| B200 | 1000W | 12-15 kW |

### Datacenter Considerations

- **PUE** (Power Usage Effectiveness): Target < 1.3
- **Cooling**: Liquid cooling increasingly required
- **Location**: Access to cheap, clean power

## Build vs Buy Decision

### Build On-Prem When:
- Training 400B+ params
- Multi-year training roadmap
- $100M+ budget
- Need data sovereignty

### Use Cloud When:
- < 70B params
- Experimenting/research phase
- Variable compute needs
- < $50M budget

## Cost Optimization Strategies

1. **Spot/Preemptible instances** - 60-70% savings
2. **Reserved capacity** - 30-50% savings
3. **Multi-cloud arbitrage** - Use cheapest available
4. **Efficient architectures** - MoE, sparse attention
5. **Mixed precision** - FP8/INT8 where possible
6. **Checkpoint efficiently** - Resume from interruptions

---

*Last updated: December 6, 2025*
