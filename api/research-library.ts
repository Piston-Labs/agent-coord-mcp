import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const RESEARCH_KEY = 'agent-coord:research-library';

interface ResearchArticle {
  id: string;
  title: string;
  url: string;
  source: string;  // e.g., "Cloudflare Blog", "The New Stack", "InfraCloud"
  category: string;  // e.g., "architecture", "kubernetes", "durable-objects", "multi-agent"
  summary: string;
  discoveredBy: string;  // agent who found it
  discoveredAt: string;
  tags: string[];
  // PDF storage fields (optional - populated when PDF is extracted)
  pdfUrl?: string;       // Direct arXiv PDF URL (e.g., https://arxiv.org/pdf/1706.03762)
  pdfS3Key?: string;     // S3 storage key (e.g., papers/1706.03762.pdf)
  pdfSize?: number;      // PDF file size in bytes
  pdfExtractedAt?: string;  // When PDF was downloaded and stored
}

// Pre-seed with articles from yesterday's research session
const SEED_ARTICLES: ResearchArticle[] = [
  {
    id: 'research-cf-containers',
    title: 'Cloudflare Containers: Built on Durable Objects',
    url: 'https://blog.cloudflare.com/cloudflare-containers-coming-2025/',
    source: 'Cloudflare Blog',
    category: 'infrastructure',
    summary: 'Cloudflare now offers containers built on Durable Objects - eliminates K8s complexity. Global by default, state built-in, pay per request with free hibernation.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['cloudflare', 'containers', 'durable-objects', 'serverless']
  },
  {
    id: 'research-k8s-ai-agents',
    title: 'Deploy Agentic AI Workflows with Kubernetes and Terraform',
    url: 'https://thenewstack.io/deploy-agentic-ai-workflows-with-kubernetes-and-terraform/',
    source: 'The New Stack',
    category: 'multi-agent',
    summary: 'Patterns for deploying AI agent workflows on Kubernetes using Terraform for infrastructure-as-code. Covers orchestration, scaling, and observability.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kubernetes', 'terraform', 'ai-agents', 'orchestration']
  },
  {
    id: 'research-ai-agents-k8s',
    title: 'AI Agents for Kubernetes',
    url: 'https://www.infracloud.io/blogs/ai-agents-for-kubernetes/',
    source: 'InfraCloud',
    category: 'multi-agent',
    summary: 'How AI agents can manage and optimize Kubernetes clusters. Covers KubeIntellect for LLM-orchestrated K8s management.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kubernetes', 'ai-agents', 'kubeintellect', 'automation']
  },
  {
    id: 'research-kagent-cncf',
    title: 'Kagent: CNCF Kubernetes-Native AI Agents',
    url: 'https://kagent.dev/',
    source: 'CNCF',
    category: 'multi-agent',
    summary: 'Kagent is a CNCF project for building Kubernetes-native AI agents. Provides primitives for agent lifecycle, communication, and state management.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['kagent', 'cncf', 'kubernetes', 'ai-agents']
  },
  {
    id: 'research-dapr-agents',
    title: 'Dapr Agents: Resilient Agent Framework',
    url: 'https://docs.dapr.io/',
    source: 'Dapr',
    category: 'multi-agent',
    summary: 'Dapr provides building blocks for resilient distributed applications. Agents framework leverages Dapr sidecars for state, pub/sub, and service invocation.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-04T17:07:07.327Z',
    tags: ['dapr', 'microservices', 'resilience', 'sidecar']
  },
  {
    id: 'research-linear-ux',
    title: 'Linear App - Keyboard-First Task Management',
    url: 'https://linear.app/',
    source: 'Linear',
    category: 'ux-patterns',
    summary: 'Linear UX patterns: Cmd+K command palette, J/K navigation, 1-4 for status changes, near-instant view switching. Implemented in our dashboard.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-03T22:37:04.995Z',
    tags: ['linear', 'ux', 'keyboard-first', 'task-management']
  },
  {
    id: 'research-samsara-fleet',
    title: 'Samsara Fleet Dashboard UX Patterns',
    url: 'https://www.samsara.com/',
    source: 'Samsara',
    category: 'ux-patterns',
    summary: '1-second GPS refresh, helicopter view of all assets, smart map overlays (weather, traffic), geofence alerts. Inspiration for our telemetry dashboard.',
    discoveredBy: 'researcher',
    discoveredAt: '2025-12-03T22:37:04.995Z',
    tags: ['samsara', 'fleet', 'gps', 'real-time', 'geofence']
  },
  // ========== FOUNDATIONAL AI/ML PAPERS (1986-2017) ==========
  {
    id: 'research-backprop-1986',
    title: 'Learning Representations by Back-propagating Errors',
    url: 'https://www.nature.com/articles/323533a0',
    source: 'Nature',
    category: 'foundational-ml',
    summary: 'Rumelhart, Hinton & Williams (1986). The paper that made neural networks trainable. Introduced backpropagation algorithm for computing gradients through multi-layer networks. Foundation of all modern deep learning.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['backpropagation', 'neural-networks', 'hinton', 'gradient-descent', 'seminal']
  },
  {
    id: 'research-lstm-1997',
    title: 'Long Short-Term Memory',
    url: 'https://www.bioinf.jku.at/publications/older/2604.pdf',
    source: 'Neural Computation',
    category: 'foundational-ml',
    summary: 'Hochreiter & Schmidhuber (1997). Solved the vanishing gradient problem for recurrent networks. LSTM cells with gates for memory control became the standard for sequence modeling until Transformers.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['lstm', 'rnn', 'sequence-modeling', 'vanishing-gradient', 'seminal']
  },
  {
    id: 'research-imagenet-2009',
    title: 'ImageNet: A Large-Scale Hierarchical Image Database',
    url: 'https://ieeexplore.ieee.org/document/5206848',
    source: 'CVPR 2009',
    category: 'foundational-ml',
    summary: 'Fei-Fei Li et al. (2009). Created the dataset that enabled the deep learning revolution. 14M+ labeled images across 20k categories. The ImageNet Challenge drove computer vision breakthroughs.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['imagenet', 'dataset', 'computer-vision', 'fei-fei-li', 'seminal']
  },
  {
    id: 'research-alexnet-2012',
    title: 'ImageNet Classification with Deep Convolutional Neural Networks',
    url: 'https://papers.nips.cc/paper/2012/hash/c399862d3b9d6b76c8436e924a68c45b-Abstract.html',
    source: 'NeurIPS 2012',
    category: 'foundational-ml',
    summary: 'Krizhevsky, Sutskever & Hinton (2012). AlexNet won ImageNet 2012 by a massive margin, proving deep learning works. Used ReLU, dropout, GPU training. Triggered the modern AI boom.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['alexnet', 'cnn', 'imagenet', 'gpu-training', 'relu', 'seminal']
  },
  {
    id: 'research-dropout-2014',
    title: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting',
    url: 'https://jmlr.org/papers/v15/srivastava14a.html',
    source: 'JMLR',
    category: 'foundational-ml',
    summary: 'Srivastava, Hinton et al. (2014). Revolutionary regularization technique - randomly drop neurons during training. Prevents co-adaptation, acts like ensemble. Still used everywhere.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['dropout', 'regularization', 'overfitting', 'hinton', 'seminal']
  },
  {
    id: 'research-word2vec-2013',
    title: 'Efficient Estimation of Word Representations in Vector Space',
    url: 'https://arxiv.org/abs/1301.3781',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Mikolov et al. (2013). Word2Vec showed words can be embedded in vector space where "king - man + woman = queen". Skip-gram and CBOW architectures. Foundation for all modern NLP embeddings.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['word2vec', 'embeddings', 'nlp', 'mikolov', 'seminal']
  },
  {
    id: 'research-vae-2013',
    title: 'Auto-Encoding Variational Bayes',
    url: 'https://arxiv.org/abs/1312.6114',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Kingma & Welling (2013). Variational Autoencoders - generative models that learn latent distributions. Reparameterization trick enables backprop through sampling. Foundation for generative AI.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['vae', 'generative-models', 'latent-space', 'variational-inference', 'seminal']
  },
  {
    id: 'research-gan-2014',
    title: 'Generative Adversarial Networks',
    url: 'https://arxiv.org/abs/1406.2661',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Goodfellow et al. (2014). Generator vs Discriminator in a game-theoretic framework. Revolutionized image generation. Led to StyleGAN, image-to-image translation, and creative AI.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['gan', 'generative-models', 'goodfellow', 'adversarial', 'seminal']
  },
  {
    id: 'research-adam-2014',
    title: 'Adam: A Method for Stochastic Optimization',
    url: 'https://arxiv.org/abs/1412.6980',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Kingma & Ba (2014). Adam optimizer combines momentum and RMSprop with adaptive learning rates. Default optimizer for most deep learning. Cited 200k+ times.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['adam', 'optimizer', 'stochastic-gradient-descent', 'kingma', 'seminal']
  },
  {
    id: 'research-batchnorm-2015',
    title: 'Batch Normalization: Accelerating Deep Network Training',
    url: 'https://arxiv.org/abs/1502.03167',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Ioffe & Szegedy (2015). Normalize activations within mini-batches. Enables much faster training, higher learning rates, reduces need for dropout. Essential for training very deep networks.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['batch-normalization', 'training', 'deep-networks', 'google', 'seminal']
  },
  {
    id: 'research-resnet-2015',
    title: 'Deep Residual Learning for Image Recognition',
    url: 'https://arxiv.org/abs/1512.03385',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'He et al. (2015). Skip connections solve degradation in very deep networks. ResNet-152 won ImageNet 2015. Residual connections now standard in all architectures including Transformers.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['resnet', 'skip-connections', 'residual-learning', 'imagenet', 'seminal']
  },
  {
    id: 'research-dqn-2015',
    title: 'Human-level Control through Deep Reinforcement Learning',
    url: 'https://www.nature.com/articles/nature14236',
    source: 'Nature',
    category: 'foundational-ml',
    summary: 'DeepMind (2015). Deep Q-Networks learned to play Atari games from pixels at superhuman level. Combined deep learning with reinforcement learning. Led to AlphaGo and modern RL.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['dqn', 'reinforcement-learning', 'deepmind', 'atari', 'seminal']
  },
  {
    id: 'research-alphago-2016',
    title: 'Mastering the Game of Go with Deep Neural Networks and Tree Search',
    url: 'https://www.nature.com/articles/nature16961',
    source: 'Nature',
    category: 'foundational-ml',
    summary: 'Silver et al. (2016). AlphaGo defeated world champion Lee Sedol. Combined policy networks, value networks, and Monte Carlo tree search. Proved AI can master intuition-based games.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['alphago', 'deepmind', 'game-playing', 'monte-carlo', 'seminal']
  },
  {
    id: 'research-transformer-2017',
    title: 'Attention Is All You Need',
    url: 'https://arxiv.org/abs/1706.03762',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Vaswani et al. (2017). THE paper that started the LLM revolution. Self-attention mechanism replaces recurrence entirely. Foundation of GPT, BERT, Claude, and all modern language models.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['transformer', 'attention', 'self-attention', 'google', 'llm', 'seminal']
  },
  {
    id: 'research-bert-2018',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers',
    url: 'https://arxiv.org/abs/1810.04805',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Devlin et al. (2018). Bidirectional pre-training on masked language modeling. Transfer learning for NLP - fine-tune on any task. Dominated NLP benchmarks, inspired GPT evolution.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['bert', 'transformer', 'pre-training', 'transfer-learning', 'google', 'seminal']
  },
  {
    id: 'research-gpt3-2020',
    title: 'Language Models are Few-Shot Learners',
    url: 'https://arxiv.org/abs/2005.14165',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Brown et al. (2020). GPT-3 with 175B parameters showed emergent in-context learning. Few-shot prompting without fine-tuning. Proved scaling laws and sparked the LLM race.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['gpt-3', 'few-shot', 'scaling', 'openai', 'in-context-learning', 'seminal']
  },
  {
    id: 'research-diffusion-2020',
    title: 'Denoising Diffusion Probabilistic Models',
    url: 'https://arxiv.org/abs/2006.11239',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Ho et al. (2020). Diffusion models learn to denoise images step-by-step. Foundation of DALL-E 2, Stable Diffusion, Midjourney. Now dominant approach for image generation.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['diffusion', 'generative-models', 'denoising', 'image-generation', 'seminal']
  },
  {
    id: 'research-clip-2021',
    title: 'Learning Transferable Visual Models From Natural Language Supervision',
    url: 'https://arxiv.org/abs/2103.00020',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Radford et al. (2021). CLIP learns visual concepts from natural language. Trained on 400M image-text pairs. Enables zero-shot image classification, powers DALL-E and multimodal AI.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['clip', 'multimodal', 'vision-language', 'openai', 'zero-shot', 'seminal']
  },
  {
    id: 'research-rlhf-2022',
    title: 'Training Language Models to Follow Instructions with Human Feedback',
    url: 'https://arxiv.org/abs/2203.02155',
    source: 'arXiv',
    category: 'foundational-ml',
    summary: 'Ouyang et al. (2022). InstructGPT - RLHF makes models helpful, harmless, honest. Human feedback shapes behavior beyond pre-training. Foundation of ChatGPT and Claude alignment.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T22:00:00.000Z',
    tags: ['rlhf', 'instructgpt', 'alignment', 'openai', 'human-feedback', 'seminal']
  },
  // ========== SCALING & EFFICIENCY (2020-2024) ==========
  {
    id: 'research-scaling-laws-2020',
    title: 'Scaling Laws for Neural Language Models',
    url: 'https://arxiv.org/abs/2001.08361',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Kaplan et al. (2020). OpenAI discovered power-law relationships between loss and model size/data/compute. First to show larger models are more sample-efficient. Foundation for GPT scaling decisions.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['scaling-laws', 'openai', 'kaplan', 'compute-optimal', 'seminal']
  },
  {
    id: 'research-chinchilla-2022',
    title: 'Training Compute-Optimal Large Language Models',
    url: 'https://arxiv.org/abs/2203.15556',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Hoffmann et al. (2022). Chinchilla paper from DeepMind. Found LLMs are undertrained - model size and tokens should scale equally. 70B Chinchilla beat 280B Gopher. Changed how we train LLMs.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['chinchilla', 'scaling-laws', 'deepmind', 'compute-optimal', 'seminal']
  },
  {
    id: 'research-cot-2022',
    title: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
    url: 'https://arxiv.org/abs/2201.11903',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Wei et al. (2022). Google Brain. Showed intermediate reasoning steps dramatically improve LLM performance on math, logic, and commonsense tasks. Emergent ability of scale. Changed how we prompt LLMs.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['chain-of-thought', 'prompting', 'reasoning', 'google', 'emergent', 'seminal']
  },
  {
    id: 'research-rag-2020',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    url: 'https://arxiv.org/abs/2005.11401',
    source: 'arXiv',
    category: 'retrieval-augmented',
    summary: 'Lewis et al. (2020). Facebook AI. Combined parametric (BART) and non-parametric (DPR vector retrieval) memory. Foundation of modern RAG systems. Enables grounded, factual generation.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['rag', 'retrieval', 'vector-database', 'facebook', 'knowledge-grounding', 'seminal']
  },
  // ========== AI LABS & FRONTIER MODELS (2023-2024) ==========
  {
    id: 'research-constitutional-ai-2022',
    title: 'Constitutional AI: Harmlessness from AI Feedback',
    url: 'https://arxiv.org/abs/2212.08073',
    source: 'arXiv',
    category: 'ai-safety',
    summary: 'Bai et al. (2022). Anthropic. Train harmless AI through self-improvement using principles, no human labels for harmful outputs. RLAIF + chain-of-thought critiques. Foundation of Claude alignment.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['constitutional-ai', 'anthropic', 'alignment', 'rlaif', 'safety', 'seminal']
  },
  {
    id: 'research-llama3-2024',
    title: 'The Llama 3 Herd of Models',
    url: 'https://arxiv.org/abs/2407.21783',
    source: 'arXiv',
    category: 'frontier-models',
    summary: 'Meta AI (2024). Open-weight foundation models up to 405B params. Dense transformer, 8 language support, tool use, code generation. SFT + DPO training. Most capable open model family.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['llama', 'meta', 'open-weights', 'foundation-model', '2024']
  },
  {
    id: 'research-mixtral-2024',
    title: 'Mixtral of Experts',
    url: 'https://arxiv.org/abs/2401.04088',
    source: 'arXiv',
    category: 'frontier-models',
    summary: 'Mistral AI (2024). Sparse Mixture of Experts - 8x7B experts, only 2 active per token (13B active of 47B total). Beats Llama 2 70B and GPT-3.5. Open-source under Apache 2.0.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['mixtral', 'mistral', 'mixture-of-experts', 'sparse', 'efficient', '2024']
  },
  {
    id: 'research-mamba-2023',
    title: 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces',
    url: 'https://arxiv.org/abs/2312.00752',
    source: 'arXiv',
    category: 'architectures',
    summary: 'Gu & Dao (2023). Alternative to Transformers - selective state space models with linear scaling. 5x faster inference, handles long sequences efficiently. Mamba-3B matches Transformers 2x its size.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['mamba', 'ssm', 'state-space', 'efficient', 'alternative-architecture', 'seminal']
  },
  {
    id: 'research-alphafold3-2024',
    title: 'Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3',
    url: 'https://www.nature.com/articles/s41586-024-07487-w',
    source: 'Nature',
    category: 'scientific-ai',
    summary: 'Abramson et al. (2024). DeepMind + Isomorphic Labs. Predicts protein-DNA, protein-RNA, protein-ligand complexes. 50%+ accuracy improvement. Pairformer + diffusion. Nobel Prize 2024.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['alphafold', 'deepmind', 'protein-structure', 'biology', 'nobel-prize', 'seminal']
  },
  // ========== STANFORD HAI & ACADEMIC RESEARCH ==========
  {
    id: 'research-stanford-ai-index-2024',
    title: 'AI Index Report 2024',
    url: 'https://aiindex.stanford.edu/report/',
    source: 'Stanford HAI',
    category: 'industry-reports',
    summary: 'Stanford HAI (2024). Most comprehensive AI progress report. Industry produced 51 notable ML models vs 15 from academia. 149 foundation models released in 2023. US leads in notable models (40 vs China 15).',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-04T23:00:00.000Z',
    tags: ['stanford', 'hai', 'industry-report', 'trends', 'academia', '2024']
  },
  // ========== EFFICIENT TRAINING & FINE-TUNING ==========
  {
    id: 'research-flash-attention-2022',
    title: 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',
    url: 'https://arxiv.org/abs/2205.14135',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Dao et al. (2022). IO-aware attention using tiling to reduce GPU memory reads/writes. 3x speedup on GPT-2, enables 16K+ context. Linear memory instead of quadratic. Powers most modern LLMs.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['flash-attention', 'efficient', 'memory', 'gpu', 'tiling', 'seminal']
  },
  {
    id: 'research-lora-2021',
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    url: 'https://arxiv.org/abs/2106.09685',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Hu et al. (2021). Microsoft. Freeze pretrained weights, inject trainable low-rank matrices. 10,000x fewer params, 3x less GPU memory than full fine-tuning. No inference latency. Revolutionary for LLM adaptation.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['lora', 'fine-tuning', 'efficient', 'microsoft', 'adaptation', 'seminal']
  },
  {
    id: 'research-dpo-2023',
    title: 'Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
    url: 'https://arxiv.org/abs/2305.18290',
    source: 'arXiv',
    category: 'ai-safety',
    summary: 'Rafailov et al. (2023). Stanford. Simpler RLHF alternative - optimize preferences directly without reward model or RL loop. Stable, lightweight, matches/beats PPO. NeurIPS 2023 runner-up. Used in Llama, Claude.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['dpo', 'alignment', 'rlhf-alternative', 'stanford', 'preferences', 'seminal']
  },
  {
    id: 'research-vit-2020',
    title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
    url: 'https://arxiv.org/abs/2010.11929',
    source: 'arXiv',
    category: 'architectures',
    summary: 'Dosovitskiy et al. (2020). Google. Vision Transformer - pure transformer on image patches, no CNNs. Matches/beats CNNs with less compute when pretrained on large data. Foundation of multimodal AI.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['vit', 'vision-transformer', 'computer-vision', 'google', 'patches', 'seminal']
  },
  // ========== BERKELEY & CMU RESEARCH ==========
  {
    id: 'research-bair-compound-2024',
    title: 'The Shift from Models to Compound AI Systems',
    url: 'https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/',
    source: 'Berkeley BAIR',
    category: 'multi-agent',
    summary: 'BAIR (2024). State-of-the-art AI increasingly from compound systems (multiple components), not monolithic models. Retrieval, tools, multi-step reasoning. Key insight for building production AI.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['berkeley', 'bair', 'compound-systems', 'production-ai', '2024']
  },
  // ========== RLHF ORIGINS & FRONTIER MODELS ==========
  {
    id: 'research-rlhf-original-2017',
    title: 'Deep Reinforcement Learning from Human Preferences',
    url: 'https://arxiv.org/abs/1706.03741',
    source: 'arXiv',
    category: 'ai-safety',
    summary: 'Christiano et al. (2017). OpenAI/DeepMind. Original RLHF paper - learn from human preferences on trajectory pairs. Solved Atari & robotics with <1% human feedback. Foundation of modern LLM alignment.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['rlhf', 'human-preferences', 'alignment', 'openai', 'deepmind', 'seminal']
  },
  {
    id: 'research-gpt4-2023',
    title: 'GPT-4 Technical Report',
    url: 'https://arxiv.org/abs/2303.08774',
    source: 'arXiv',
    category: 'frontier-models',
    summary: 'OpenAI (2023). Multimodal model accepting images+text. Human-level on professional exams (top 10% bar exam). RLHF fine-tuned. Predicted performance from 1/1000th compute. Extensive safety card.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['gpt-4', 'openai', 'multimodal', 'frontier', 'rlhf', '2023']
  },
  {
    id: 'research-sora-2024',
    title: 'Video Generation Models as World Simulators',
    url: 'https://openai.com/index/video-generation-models-as-world-simulators/',
    source: 'OpenAI',
    category: 'frontier-models',
    summary: 'OpenAI (2024). Sora - diffusion transformer for video. Operates on spacetime patches, variable durations/resolutions. 1-minute HD video generation. Treats video as emergent world simulation.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:00:00.000Z',
    tags: ['sora', 'video-generation', 'diffusion-transformer', 'openai', '2024']
  },

  // ========================================================================
  // 2024 BREAKTHROUGH PAPERS
  // ========================================================================

  // Fine-tuning & Adaptation (2024)
  {
    id: 'research-lora-forgets-2024',
    title: 'LoRA Learns Less and Forgets Less',
    url: 'https://arxiv.org/abs/2405.09673',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Biderman et al. (2024). Key LoRA insight: full finetuning absorbs more new knowledge but causes more forgetting. LoRA changes fewer params, learns less but retains more. Crucial for domain adaptation vs. catastrophic forgetting tradeoff.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['lora', 'fine-tuning', 'forgetting', 'domain-adaptation', '2024']
  },
  {
    id: 'research-dora-2024',
    title: 'DoRA: Weight-Decomposed Low-Rank Adaptation',
    url: 'https://arxiv.org/abs/2402.09353',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Liu et al. (2024). Extends LoRA by decomposing weights into magnitude vector + directional matrix. Applies low-rank updates only to directional component, trains magnitude separately. Better performance than LoRA with same param count.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['dora', 'lora', 'fine-tuning', 'weight-decomposition', '2024']
  },
  {
    id: 'research-phi4-2024',
    title: 'Phi-4 Technical Report',
    url: 'https://arxiv.org/abs/2412.08905',
    source: 'arXiv',
    category: 'frontier-models',
    summary: 'Microsoft (2024). 14B parameter open-weight LLM trained primarily on synthetic data from GPT-4o. Outperforms similarly-sized models. Demonstrates power of high-quality synthetic data for pretraining.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['phi-4', 'microsoft', 'synthetic-data', 'small-model', '2024']
  },

  // Visual & Generative AI (2024)
  {
    id: 'research-var-2024',
    title: 'Visual AutoRegressive Modeling: Scalable Image Generation via Next-Scale Prediction',
    url: 'https://arxiv.org/abs/2404.02905',
    source: 'arXiv',
    category: 'architectures',
    summary: 'Tian et al. (2024). NeurIPS 2024 Award. New image generation paradigm: predicts images coarse-to-fine across scales instead of token-by-token. Outperforms diffusion transformers on visual tasks. Efficient in-painting and editing.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['var', 'image-generation', 'autoregressive', 'neurips-award', '2024']
  },
  {
    id: 'research-sam3-2024',
    title: 'Segment Anything Model 3 (SAM 3)',
    url: 'https://arxiv.org/abs/2408.00714',
    source: 'arXiv',
    category: 'architectures',
    summary: 'Meta (2024). SAM upgraded for video. Unified model for promptable segmentation and tracking. Decoupled recognition and localization. State-of-the-art on video object segmentation benchmarks.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['sam', 'segmentation', 'video', 'meta', '2024']
  },

  // Reasoning & O1 (2024)
  {
    id: 'research-o1-replication-2024',
    title: 'O1 Replication Journey: A Strategic Progress Report',
    url: 'https://arxiv.org/abs/2410.18982',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'GAIR (2024). Attempts to replicate OpenAI o1 reasoning. Uses distillation with careful prompting to extract thought processes. Achieves parity with o1-preview and o1-mini. Key insight: multi-step reasoning can emerge from training.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['o1', 'reasoning', 'distillation', 'replication', '2024']
  },

  // Efficiency & Infrastructure (2024)
  {
    id: 'research-kv-cache-compression-2024',
    title: 'Model Tells You What to Discard: Adaptive KV Cache Compression for LLMs',
    url: 'https://arxiv.org/abs/2310.01801',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Ge et al. (2024). ICLR 2024 Outstanding Paper. Reduces LLM memory during inference by profiling attention patterns and constructing KV cache adaptively. Major memory savings without quality loss.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['kv-cache', 'compression', 'inference', 'efficiency', 'iclr-award', '2024']
  },
  {
    id: 'research-lightrag-2024',
    title: 'LightRAG: Simple and Fast Retrieval-Augmented Generation',
    url: 'https://arxiv.org/abs/2410.05779',
    source: 'arXiv',
    category: 'retrieval-augmented',
    summary: 'Guo et al. (2024). Improves RAG by integrating graph structures. Entity extraction + relationship graphs for better contextual awareness. More efficient retrieval than dense vector approaches. Drop-in replacement for traditional RAG.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['rag', 'graph', 'retrieval', 'efficiency', '2024']
  },

  // Scaling Laws Update (2024)
  {
    id: 'research-scaling-precision-2024',
    title: 'Scaling Laws for Precision',
    url: 'https://arxiv.org/abs/2411.04330',
    source: 'arXiv',
    category: 'scaling-efficiency',
    summary: 'Dettmers et al. (2024). Updates Chinchilla scaling laws. Analyzes impact of numerical precision on compute-optimal training. Low precision can significantly alter optimal model size. Critical for efficient training planning.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['scaling-laws', 'precision', 'quantization', 'chinchilla', '2024']
  },

  // Claude & Anthropic (2024)
  {
    id: 'research-claude3-model-card-2024',
    title: 'The Claude 3 Model Family: A New Standard for Intelligence',
    url: 'https://www-cdn.anthropic.com/de8ba9b01c9ab7cbabf5c33b80b7bbc618857627/Model_Card_Claude_3.pdf',
    source: 'Anthropic',
    category: 'frontier-models',
    summary: 'Anthropic (2024). Claude 3 family: Haiku, Sonnet, Opus. First AI to surpass human-level performance across reasoning, math, and coding benchmarks. 200K context window, vision capabilities. Sets new intelligence standard.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['claude-3', 'anthropic', 'frontier', 'multimodal', '2024']
  },
  {
    id: 'research-claude-character-2024',
    title: 'Claude\'s Character',
    url: 'https://www.anthropic.com/research/claude-character',
    source: 'Anthropic',
    category: 'ai-safety',
    summary: 'Anthropic (2024). Detailed exploration of how Claude\'s values, personality and behavior emerge from training. Discusses honesty, helpfulness, harmlessness, and how character traits are instilled. Key AI alignment reading.',
    discoveredBy: 'jeeves',
    discoveredAt: '2025-12-05T00:20:00.000Z',
    tags: ['claude', 'anthropic', 'character', 'alignment', 'values', '2024']
  },

  // ========================================================================
  // AGENTS & TOOL USE (2022-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-toolformer-2023',
    title: 'Toolformer: Language Models Can Teach Themselves to Use Tools',
    url: 'https://arxiv.org/abs/2302.04761',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Schick et al. (2023). Meta AI. LLMs self-learn to use external tools (calculators, search, calendars) via API calls. Self-supervised - no human tool-use examples needed. Foundation of modern agent tool use.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['toolformer', 'tool-use', 'agents', 'meta', 'self-supervised', 'seminal']
  },
  {
    id: 'research-react-2022',
    title: 'ReAct: Synergizing Reasoning and Acting in Language Models',
    url: 'https://arxiv.org/abs/2210.03629',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Yao et al. (2022). Google/Princeton. Interleave reasoning traces with actions. "Think-Act-Observe" loop. Outperforms CoT alone on knowledge-intensive tasks. Foundation of LangChain/agent frameworks.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['react', 'reasoning', 'agents', 'tool-use', 'google', 'seminal']
  },
  {
    id: 'research-reflexion-2023',
    title: 'Reflexion: Language Agents with Verbal Reinforcement Learning',
    url: 'https://arxiv.org/abs/2303.11366',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Shinn et al. (2023). Agents learn from failures via verbal self-reflection. No weight updates - learns in context. 91% on HumanEval (vs 80% base). Key technique for agent self-improvement.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['reflexion', 'self-improvement', 'agents', 'verbal-rl', 'humaneval']
  },
  {
    id: 'research-voyager-2023',
    title: 'Voyager: An Open-Ended Embodied Agent with Large Language Models',
    url: 'https://arxiv.org/abs/2305.16291',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Wang et al. (2023). NVIDIA. LLM agent in Minecraft that writes code, builds skill library, explores autonomously. Learns 3x more skills than baselines. Key example of embodied agents + code generation.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['voyager', 'embodied-agents', 'minecraft', 'nvidia', 'skill-library']
  },
  {
    id: 'research-gorilla-2023',
    title: 'Gorilla: Large Language Model Connected with Massive APIs',
    url: 'https://arxiv.org/abs/2305.15334',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Patil et al. (2023). Berkeley. Fine-tuned LLaMA on 1,600+ APIs. Outperforms GPT-4 on API calling accuracy. Self-instruct on API docs. Key for reliable tool use.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['gorilla', 'api-calling', 'berkeley', 'tool-use', 'fine-tuning']
  },
  {
    id: 'research-taskweaver-2023',
    title: 'TaskWeaver: A Code-First Agent Framework',
    url: 'https://arxiv.org/abs/2311.17541',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Qiao et al. (2023). Microsoft. Converts user requests to executable Python code. Stateful execution with plugin system. Handles complex data analytics tasks. Production-grade agent framework.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['taskweaver', 'code-first', 'microsoft', 'agents', 'python']
  },
  {
    id: 'research-opendevin-2024',
    title: 'OpenDevin: An Open Platform for AI Software Developers',
    url: 'https://arxiv.org/abs/2407.16741',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Wang et al. (2024). Open-source software engineering agent. Sandboxed execution, multi-agent collaboration, benchmarking on SWE-bench. Community-driven Devin alternative.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['opendevin', 'software-engineering', 'swe-bench', 'open-source', '2024']
  },
  {
    id: 'research-swebench-2024',
    title: 'SWE-bench: Can Language Models Resolve Real-World GitHub Issues?',
    url: 'https://arxiv.org/abs/2310.06770',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Jimenez et al. (2024). Princeton. Benchmark for LLM software engineering - 2,294 real GitHub issues. Models must understand codebase and generate patches. Key benchmark for coding agents.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['swe-bench', 'benchmark', 'software-engineering', 'princeton', 'github']
  },

  // ========================================================================
  // CODE MODELS (2021-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-codex-2021',
    title: 'Evaluating Large Language Models Trained on Code',
    url: 'https://arxiv.org/abs/2107.03374',
    source: 'arXiv',
    category: 'code-models',
    summary: 'Chen et al. (2021). OpenAI Codex - GPT-3 fine-tuned on code. 28.8% on HumanEval. Powers GitHub Copilot. Introduced HumanEval benchmark. Started the AI coding assistant revolution.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['codex', 'humaneval', 'openai', 'copilot', 'code-generation', 'seminal']
  },
  {
    id: 'research-starcoder-2023',
    title: 'StarCoder: May the Source Be with You!',
    url: 'https://arxiv.org/abs/2305.06161',
    source: 'arXiv',
    category: 'code-models',
    summary: 'Li et al. (2023). BigCode/HuggingFace. 15B params, trained on The Stack (permissively licensed code only). Open-source, commercially viable. Strong on HumanEval. Ethical code model.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['starcoder', 'bigcode', 'huggingface', 'open-source', 'ethical-ai']
  },
  {
    id: 'research-codellama-2023',
    title: 'Code Llama: Open Foundation Models for Code',
    url: 'https://arxiv.org/abs/2308.12950',
    source: 'arXiv',
    category: 'code-models',
    summary: 'Rozière et al. (2023). Meta. Llama 2 fine-tuned for code. 7B/13B/34B sizes. Fill-in-the-middle, long context (100K). Instruct variants. Top open-source code model family.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['codellama', 'meta', 'llama', 'code-generation', 'open-source']
  },
  {
    id: 'research-deepseekcoder-2024',
    title: 'DeepSeek-Coder: When the Large Language Model Meets Programming',
    url: 'https://arxiv.org/abs/2401.14196',
    source: 'arXiv',
    category: 'code-models',
    summary: 'Guo et al. (2024). DeepSeek. 1.3B to 33B code models. Trained on 2T tokens of code. Beats CodeLlama on benchmarks. Fill-in-middle, repo-level completion. Strong open alternative.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['deepseek-coder', 'deepseek', 'code-generation', 'china', '2024']
  },

  // ========================================================================
  // LONG CONTEXT (2020-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-longformer-2020',
    title: 'Longformer: The Long-Document Transformer',
    url: 'https://arxiv.org/abs/2004.05150',
    source: 'arXiv',
    category: 'long-context',
    summary: 'Beltagy et al. (2020). Allen AI. Sliding window + global attention. O(n) instead of O(n²). Handles 4K+ tokens. Foundation for long-context research. Led to BigBird, LongT5.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['longformer', 'long-context', 'efficient-attention', 'allen-ai', 'seminal']
  },
  {
    id: 'research-rope-2021',
    title: 'RoFormer: Enhanced Transformer with Rotary Position Embedding',
    url: 'https://arxiv.org/abs/2104.09864',
    source: 'arXiv',
    category: 'long-context',
    summary: 'Su et al. (2021). Rotary Position Embeddings (RoPE). Relative positions via rotation matrices. Extrapolates to longer sequences. Used in Llama, Mistral, most modern LLMs.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['rope', 'rotary-embeddings', 'position-encoding', 'extrapolation', 'seminal']
  },
  {
    id: 'research-alibi-2022',
    title: 'Train Short, Test Long: Attention with Linear Biases Enables Input Length Generalization',
    url: 'https://arxiv.org/abs/2108.12409',
    source: 'arXiv',
    category: 'long-context',
    summary: 'Press et al. (2022). ALiBi - add linear bias to attention. No position embeddings needed. Train on short, extrapolate to long. Used in MPT, BLOOM. Key length generalization technique.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['alibi', 'position-encoding', 'length-generalization', 'efficient']
  },
  {
    id: 'research-yarn-2023',
    title: 'YaRN: Efficient Context Window Extension of Large Language Models',
    url: 'https://arxiv.org/abs/2309.00071',
    source: 'arXiv',
    category: 'long-context',
    summary: 'Peng et al. (2023). Yet another RoPE extensioN. Extends RoPE context 10x+ with minimal fine-tuning. NTK-aware interpolation + attention scaling. Key for 100K+ context windows.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['yarn', 'rope-extension', 'long-context', 'context-scaling', '2023']
  },
  {
    id: 'research-longlora-2023',
    title: 'LongLoRA: Efficient Fine-tuning of Long-Context Large Language Models',
    url: 'https://arxiv.org/abs/2309.12307',
    source: 'arXiv',
    category: 'long-context',
    summary: 'Chen et al. (2023). MIT/HKU. Extend context with shifted sparse attention during training. Combine with LoRA for efficiency. Extend Llama-2 to 100K context. Practical long-context fine-tuning.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:22:00.000Z',
    tags: ['longlora', 'lora', 'long-context', 'efficient-training', 'mit']
  },

  // ========================================================================
  // ADVANCED REASONING (2022-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-self-consistency-2022',
    title: 'Self-Consistency Improves Chain of Thought Reasoning in Language Models',
    url: 'https://arxiv.org/abs/2203.11171',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Wang et al. (2022). Google. Sample multiple CoT paths, take majority vote. Simple but powerful - improves CoT by 17.9% on GSM8K. No training needed. Key prompting technique.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['self-consistency', 'chain-of-thought', 'voting', 'google', 'seminal']
  },
  {
    id: 'research-tot-2023',
    title: 'Tree of Thoughts: Deliberate Problem Solving with Large Language Models',
    url: 'https://arxiv.org/abs/2305.10601',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Yao et al. (2023). Princeton/Google DeepMind. Extend CoT to tree search - generate, evaluate, backtrack. BFS/DFS over thought space. Solves Game of 24, creative writing. Foundation for o1-style reasoning.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['tree-of-thought', 'reasoning', 'search', 'planning', 'seminal']
  },
  {
    id: 'research-self-refine-2023',
    title: 'Self-Refine: Iterative Refinement with Self-Feedback',
    url: 'https://arxiv.org/abs/2303.17651',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Madaan et al. (2023). CMU. LLM generates → critiques → refines own output. No training or external feedback. 20% improvement on code, math, reviews. Key for agent self-improvement loops.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['self-refine', 'iterative', 'self-improvement', 'cmu', 'agents']
  },
  {
    id: 'research-least-to-most-2022',
    title: 'Least-to-Most Prompting Enables Complex Reasoning in Large Language Models',
    url: 'https://arxiv.org/abs/2205.10625',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Zhou et al. (2022). Google. Decompose complex problems into simpler subproblems, solve sequentially. Generalizes better than CoT. 99.7% on SCAN (vs 16% CoT). Key compositional reasoning technique.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['least-to-most', 'decomposition', 'compositional', 'google', 'prompting']
  },
  {
    id: 'research-scratchpad-2021',
    title: 'Show Your Work: Scratchpads for Intermediate Computation with Language Models',
    url: 'https://arxiv.org/abs/2112.00114',
    source: 'arXiv',
    category: 'prompting-reasoning',
    summary: 'Nye et al. (2021). Google. Train models to use "scratchpads" for intermediate steps. Predecessor to CoT. Shows step-by-step reasoning can be learned. Foundation for reasoning research.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['scratchpad', 'intermediate-steps', 'training', 'google', 'foundational']
  },

  // ========================================================================
  // MULTI-AGENT SYSTEMS (2023-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-autogen-2023',
    title: 'AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation',
    url: 'https://arxiv.org/abs/2308.08155',
    source: 'arXiv',
    category: 'multi-agent',
    summary: 'Wu et al. (2023). Microsoft. Framework for multi-agent conversations. Agents with different roles collaborate via chat. Human-in-the-loop optional. Powers complex workflows. Production-ready framework.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['autogen', 'multi-agent', 'microsoft', 'conversation', 'framework', 'seminal']
  },
  {
    id: 'research-camel-2023',
    title: 'CAMEL: Communicative Agents for "Mind" Exploration of Large Language Model Society',
    url: 'https://arxiv.org/abs/2303.17760',
    source: 'arXiv',
    category: 'multi-agent',
    summary: 'Li et al. (2023). KAUST. Role-playing framework where AI assistants collaborate. Inception prompting to maintain roles. Studies emergent behaviors in agent societies. Early multi-agent research.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['camel', 'role-playing', 'multi-agent', 'society', 'emergence']
  },
  {
    id: 'research-metagpt-2023',
    title: 'MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework',
    url: 'https://arxiv.org/abs/2308.00352',
    source: 'arXiv',
    category: 'multi-agent',
    summary: 'Hong et al. (2023). DeepWisdom. Agents take software engineering roles (PM, architect, engineer). SOPs encode human workflows. Produces deployable code from requirements. Practical multi-agent dev.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['metagpt', 'software-engineering', 'multi-agent', 'sop', 'framework']
  },
  {
    id: 'research-crewai-2024',
    title: 'CrewAI: Framework for Orchestrating Role-Playing Autonomous AI Agents',
    url: 'https://github.com/joaomdmoura/crewAI',
    source: 'GitHub',
    category: 'multi-agent',
    summary: 'Moura (2024). Production framework for AI agent crews. Role-based agents with goals and backstories. Sequential/hierarchical process flows. Tool integration. 20k+ GitHub stars.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['crewai', 'multi-agent', 'framework', 'roles', 'open-source']
  },
  {
    id: 'research-gpt-engineer-2023',
    title: 'GPT-Engineer: Specify what you want it to build, the AI asks for clarification, and then builds it',
    url: 'https://github.com/gpt-engineer-org/gpt-engineer',
    source: 'GitHub',
    category: 'agents-tools',
    summary: 'Osika (2023). Natural language to codebase. Clarifying questions before coding. Generates entire project structure. 50k+ GitHub stars. Showed LLMs can be full-stack developers.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['gpt-engineer', 'code-generation', 'natural-language', 'viral', 'open-source']
  },

  // ========================================================================
  // FUNCTION CALLING & MCP (2023-2024) - Added by phil
  // ========================================================================
  {
    id: 'research-function-calling-2023',
    title: 'Function Calling in Large Language Models',
    url: 'https://openai.com/blog/function-calling-and-other-api-updates',
    source: 'OpenAI Blog',
    category: 'agents-tools',
    summary: 'OpenAI (2023). Native function calling in GPT models. JSON schema for function definitions. Model decides when/how to call. Foundation for tool use in production. Changed how we build AI apps.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['function-calling', 'openai', 'tool-use', 'api', 'json-schema']
  },
  {
    id: 'research-mcp-2024',
    title: 'Model Context Protocol (MCP): Open Standard for AI Tool Integration',
    url: 'https://modelcontextprotocol.io/',
    source: 'Anthropic',
    category: 'agents-tools',
    summary: 'Anthropic (2024). Open protocol for connecting AI models to tools, data sources, and services. Standardized tool discovery, invocation, and context sharing. Used in Claude Code. Foundation of our coordination hub.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['mcp', 'anthropic', 'protocol', 'tool-integration', 'standard', 'seminal']
  },
  {
    id: 'research-toolllm-2023',
    title: 'ToolLLM: Facilitating Large Language Models to Master 16000+ Real-world APIs',
    url: 'https://arxiv.org/abs/2307.16789',
    source: 'arXiv',
    category: 'agents-tools',
    summary: 'Qin et al. (2023). Tsinghua. ToolBench dataset with 16k+ APIs. DFSDT for multi-step API planning. ToolLLaMA beats ChatGPT on API tasks. Key for scalable tool use.',
    discoveredBy: 'phil',
    discoveredAt: '2025-12-05T00:26:00.000Z',
    tags: ['toolllm', 'api-learning', 'toolbench', 'tsinghua', 'dataset']
  }
];

/**
 * Research Library API - Store and retrieve technical research articles
 *
 * GET /api/research-library - List all articles
 *   query: category (optional), tag (optional), limit (optional)
 *
 * POST /api/research-library - Add a new article
 *   body: { title, url, source, category, summary, discoveredBy, tags }
 *
 * DELETE /api/research-library?id=xxx - Remove an article
 *
 * POST /api/research-library?action=seed - Seed with initial articles
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List articles
    if (req.method === 'GET') {
      const { category, tag, limit = '50' } = req.query;

      let articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];

      // If no articles, auto-seed
      if (articles.length === 0) {
        for (const article of SEED_ARTICLES) {
          await redis.lpush(RESEARCH_KEY, article);
        }
        articles = SEED_ARTICLES;
      }

      // Filter by category
      if (category && typeof category === 'string') {
        articles = articles.filter(a => a.category === category);
      }

      // Filter by tag
      if (tag && typeof tag === 'string') {
        articles = articles.filter(a => a.tags.includes(tag));
      }

      // Get unique categories and tags for filtering UI
      const allArticles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const categories = [...new Set(allArticles.map(a => a.category))];
      const tags = [...new Set(allArticles.flatMap(a => a.tags))];

      return res.status(200).json({
        articles: articles.slice(0, parseInt(limit as string)),
        total: articles.length,
        categories,
        tags
      });
    }

    // POST - Add article or seed
    if (req.method === 'POST') {
      const { action } = req.query;

      // Seed action
      if (action === 'seed') {
        // Clear and reseed
        await redis.del(RESEARCH_KEY);
        for (const article of SEED_ARTICLES) {
          await redis.lpush(RESEARCH_KEY, article);
        }
        return res.status(200).json({
          success: true,
          message: `Seeded ${SEED_ARTICLES.length} articles`
        });
      }

      const { title, url, source, category, summary, discoveredBy, tags } = req.body;

      if (!title || !url) {
        return res.status(400).json({ error: 'title and url are required' });
      }

      const article: ResearchArticle = {
        id: `research-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title,
        url,
        source: source || 'Unknown',
        category: category || 'general',
        summary: summary || '',
        discoveredBy: discoveredBy || 'anonymous',
        discoveredAt: new Date().toISOString(),
        tags: tags || []
      };

      await redis.lpush(RESEARCH_KEY, article);

      return res.status(201).json({ success: true, article });
    }

    // DELETE - Remove article
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const filtered = articles.filter(a => a.id !== id);

      if (filtered.length === articles.length) {
        return res.status(404).json({ error: 'Article not found' });
      }

      await redis.del(RESEARCH_KEY);
      for (const article of filtered.reverse()) {
        await redis.lpush(RESEARCH_KEY, article);
      }

      return res.status(200).json({ success: true, message: 'Article deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Research library error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
