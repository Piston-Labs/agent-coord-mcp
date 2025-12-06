# Data Strategy for Training Frontier AI

> How to acquire and curate the massive datasets needed for training

## Training Data Requirements

### Scale Requirements (2025 Frontier)

| Model Tier | Training Tokens | Unique Data | Compute Optimal |
|------------|-----------------|-------------|-----------------|
| GPT-4 class | 13T tokens | ~5T unique | 1.8T params |
| Claude 3 class | 10-15T tokens | ~4T unique | 1T+ params |
| Llama 3 70B | 15T tokens | ~2T unique | 70B params |
| Competitive entry | 2-5T tokens | 1-2T unique | 70-200B params |

### Data Sources

#### 1. Web Crawl Data
- **Common Crawl** - 250B pages, free, requires heavy filtering
- **FineWeb** (HuggingFace) - 15T tokens, deduplicated, high quality
- **RefinedWeb** (Falcon) - 5T tokens, aggressive deduplication
- **C4** (Google) - 800GB, cleaned Common Crawl

**Quality Pipeline:**
```
Raw Crawl → Language Filter → Dedup → Quality Score → Domain Filter → Final
   100%   →      60%       →  40%  →     25%      →     15%     →  10%
```

#### 2. Curated High-Quality Sources
- **Books** - Books3, Gutenberg, academic texts
- **Wikipedia** - All languages, ~20B tokens
- **Academic Papers** - arXiv, Semantic Scholar, PubMed
- **Code** - GitHub (The Stack), GitLab, permissive licenses only

#### 3. Synthetic Data
- **Self-instruct** - Model generates training examples
- **Evol-Instruct** - Iteratively complexify instructions
- **Constitutional AI** - Model-generated preference data
- **Code execution** - Filter by whether code runs

**Warning:** Pure synthetic training leads to model collapse. Always maintain real data foundation.

## Data Curation Pipeline

### Step 1: Collection
```python
# Example pipeline architecture
sources = [
    CommonCrawl(shards=1000),
    GitHubCode(languages=['python', 'javascript', 'rust']),
    ArxivPapers(categories=['cs.AI', 'cs.LG', 'cs.CL']),
    Wikipedia(languages='all'),
    Books(license='permissive')
]
```

### Step 2: Filtering
- **Language detection** - fastText, langdetect
- **Quality scoring** - perplexity, classifier-based
- **Deduplication** - MinHash, exact match, fuzzy
- **Content filtering** - PII, toxic content, copyright

### Step 3: Tokenization
- **BPE** (Byte Pair Encoding) - GPT-style
- **SentencePiece** - Llama-style
- **Vocabulary size** - 32K-128K tokens typical

## Data Mix Optimization

### Recommended Proportions (2025 Best Practice)

| Source Type | Proportion | Notes |
|-------------|------------|-------|
| Web text | 60-70% | Quality filtered |
| Code | 10-15% | Improves reasoning |
| Books | 5-10% | Long-form coherence |
| Academic | 3-5% | Technical accuracy |
| Conversation | 5-10% | Dialog ability |
| Math/Science | 3-5% | Reasoning boost |

### Domain Upsampling
- Repeat high-quality domains 2-10x
- Downsample low-quality but large sources
- Dynamic mixing based on loss curves

## Legal & Ethical Considerations

### Copyright
- Use permissively licensed data when possible
- Understand fair use limitations
- Consider opt-out mechanisms (robots.txt, C2PA)

### Privacy
- Remove PII during preprocessing
- No training on private communications
- GDPR compliance for EU data

### Consent
- Respect opt-out requests
- Transparency about training data sources
- Consider data contributor compensation

## Cost Estimates

| Component | Cost Range |
|-----------|------------|
| Raw data acquisition | $100K - $1M |
| Storage (petabyte-scale) | $500K - $2M/year |
| Processing compute | $500K - $5M |
| Quality annotation | $1M - $10M |
| **Total data pipeline** | **$2M - $20M** |

## Key Research Papers

- [Scaling Data-Constrained Language Models](https://arxiv.org/abs/2305.16264)
- [FineWeb: Decanting the Web for LLM Pretraining](https://arxiv.org/abs/2406.17557)
- [The Pile: An 800GB Dataset of Diverse Text](https://arxiv.org/abs/2101.00027)
- [Textbooks Are All You Need](https://arxiv.org/abs/2306.11644)

---

*Last updated: December 6, 2025*
