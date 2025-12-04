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
