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
  source: string;
  category: string;
  summary: string;
  discoveredBy: string;
  discoveredAt: string;
  tags: string[];
  pdfUrl?: string;
  pdfS3Key?: string;
  pdfSize?: number;
  pdfExtractedAt?: string;
}

/**
 * Research Context Clusters
 *
 * Organized by domain to help agents quickly load relevant research context.
 * Each cluster maps to specific paper IDs from the research library.
 */
const RESEARCH_CLUSTERS: Record<string, {
  name: string;
  description: string;
  paperPatterns: string[];  // Patterns to match paper IDs/categories
  topics: string[];
}> = {
  // Agent & Tool Use
  'agents': {
    name: 'Agents & Tool Use',
    description: 'Papers on AI agents, tool calling, function invocation, and autonomous systems',
    paperPatterns: ['toolformer', 'react-', 'reflexion', 'voyager', 'gorilla', 'taskweaver', 'opendevin', 'swebench', 'autogen', 'camel', 'metagpt', 'crewai', 'gpt-engineer', 'mcp', 'function-calling', 'toolllm'],
    topics: ['tool-calling', 'function-invocation', 'autonomous-agents', 'multi-agent', 'coordination']
  },

  // Reasoning & Prompting
  'reasoning': {
    name: 'Reasoning & Prompting',
    description: 'Chain-of-thought, self-consistency, and advanced prompting techniques',
    paperPatterns: ['chain-of-thought', 'self-consistency', 'tree-of-thoughts', 'self-refine', 'least-to-most', 'scratchpads', 'cot-'],
    topics: ['reasoning', 'prompting', 'chain-of-thought', 'step-by-step', 'problem-solving']
  },

  // Retrieval & RAG
  'retrieval': {
    name: 'Retrieval & RAG',
    description: 'Retrieval-augmented generation, dense retrieval, and knowledge integration',
    paperPatterns: ['dpr-', 'colbert', 'realm', 'retro-', 'self-rag', 'hyde', 'rag-', 'retrieval'],
    topics: ['rag', 'retrieval', 'knowledge-base', 'dense-retrieval', 'semantic-search']
  },

  // Code Generation
  'code': {
    name: 'Code Generation',
    description: 'Code models, program synthesis, and software engineering benchmarks',
    paperPatterns: ['codex', 'starcoder', 'code-llama', 'deepseek-coder', 'humaneval', 'mbpp'],
    topics: ['code-generation', 'programming', 'synthesis', 'debugging', 'software-engineering']
  },

  // Safety & Alignment
  'safety': {
    name: 'Safety & Alignment',
    description: 'Constitutional AI, RLHF, preference learning, and alignment techniques',
    paperPatterns: ['constitutional', 'rlhf', 'dpo-', 'preference', 'alignment', 'harmless', 'red-team'],
    topics: ['safety', 'alignment', 'rlhf', 'constitutional-ai', 'preference-learning']
  },

  // Interpretability
  'interpretability': {
    name: 'Interpretability',
    description: 'Mechanistic interpretability, circuits, and understanding neural networks',
    paperPatterns: ['circuits', 'induction-heads', 'superposition', 'monosemanticity', 'probing', 'attention-'],
    topics: ['interpretability', 'mechanistic', 'circuits', 'probing', 'explainability']
  },

  // Scaling & Efficiency
  'scaling': {
    name: 'Scaling & Efficiency',
    description: 'Scaling laws, efficient architectures, and training optimization',
    paperPatterns: ['scaling-laws', 'chinchilla', 'flash-attention', 'lora', 'rope', 'alibi', 'longformer', 'yarn', 'longlora'],
    topics: ['scaling', 'efficiency', 'optimization', 'long-context', 'training']
  },

  // Embeddings & Representations
  'embeddings': {
    name: 'Embeddings & Representations',
    description: 'Text embeddings, sentence representations, and semantic similarity',
    paperPatterns: ['sentence-bert', 'contriever', 'e5-', 'instructor', 'embedding'],
    topics: ['embeddings', 'representations', 'similarity', 'retrieval', 'vectors']
  },

  // Benchmarks & Evaluation
  'benchmarks': {
    name: 'Benchmarks & Evaluation',
    description: 'Evaluation datasets, metrics, and benchmark suites',
    paperPatterns: ['mmlu', 'hellaswag', 'big-bench', 'gpqa', 'arc-', 'humaneval', 'mbpp', 'mteb', 'chatbot-arena'],
    topics: ['evaluation', 'benchmarks', 'metrics', 'testing', 'leaderboards']
  },

  // Data & Training
  'data': {
    name: 'Data & Training',
    description: 'Training data, synthetic data generation, and data curation',
    paperPatterns: ['self-instruct', 'alpaca', 'textbooks', 'wizardlm', 'orca-', 'dolma', 'fineweb', 'distil'],
    topics: ['data', 'synthetic', 'training', 'curation', 'instruction-tuning']
  },

  // Foundation Models
  'foundations': {
    name: 'Foundation Models',
    description: 'Seminal transformer and language model architectures',
    paperPatterns: ['attention-is-all', 'gpt-', 'bert-', 'llama', 'mistral', 'transformer'],
    topics: ['transformers', 'language-models', 'architecture', 'pretraining', 'foundations']
  },

  // Multimodal
  'multimodal': {
    name: 'Multimodal Models',
    description: 'Vision-language models, image understanding, and cross-modal learning',
    paperPatterns: ['clip', 'llava', 'gpt-4v', 'gemini', 'cogvlm', 'flamingo', 'blip'],
    topics: ['multimodal', 'vision', 'image', 'cross-modal', 'visual-understanding']
  }
};

/**
 * Match papers against cluster patterns
 */
function matchPapersToCluster(articles: ResearchArticle[], cluster: typeof RESEARCH_CLUSTERS[string]): ResearchArticle[] {
  return articles.filter(article => {
    // Check if article ID matches any pattern
    const idMatch = cluster.paperPatterns.some(pattern =>
      article.id.toLowerCase().includes(pattern.toLowerCase())
    );

    // Check if article category matches any pattern
    const categoryMatch = cluster.paperPatterns.some(pattern =>
      article.category.toLowerCase().includes(pattern.toLowerCase())
    );

    // Check if any tags match topics
    const tagMatch = article.tags.some(tag =>
      cluster.topics.some(topic => tag.toLowerCase().includes(topic.toLowerCase()))
    );

    return idMatch || categoryMatch || tagMatch;
  });
}

/**
 * Format papers for context loading
 */
function formatPapersForContext(papers: ResearchArticle[], depth: 'summary' | 'full'): string {
  if (depth === 'summary') {
    return papers.map(p =>
      `## ${p.title}\n**Source:** ${p.source} | **Category:** ${p.category}\n**URL:** ${p.url}\n\n${p.summary}\n\n**Tags:** ${p.tags.join(', ')}`
    ).join('\n\n---\n\n');
  } else {
    // Full depth includes everything we have
    return papers.map(p => {
      let content = `# ${p.title}\n\n`;
      content += `**Source:** ${p.source}\n`;
      content += `**Category:** ${p.category}\n`;
      content += `**URL:** ${p.url}\n`;
      if (p.pdfUrl) content += `**PDF:** ${p.pdfUrl}\n`;
      content += `**Discovered by:** ${p.discoveredBy} on ${p.discoveredAt}\n\n`;
      content += `## Summary\n${p.summary}\n\n`;
      content += `## Tags\n${p.tags.join(', ')}\n`;
      if (p.pdfS3Key) {
        content += `\n## PDF Available\nThis paper has been extracted and stored. Use \`/api/research-pdf?id=${p.id}\` to stream the full PDF.`;
      }
      return content;
    }).join('\n\n===\n\n');
  }
}

/**
 * Research Context API
 *
 * GET /api/research-context - List available clusters
 * GET /api/research-context?cluster=agents - Get papers in cluster
 * GET /api/research-context?cluster=agents&depth=full - Get full paper details
 * GET /api/research-context?search=tool+calling - Search across all papers
 * GET /api/research-context?clusters=agents,reasoning - Load multiple clusters
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    const { cluster, clusters, depth, search, format } = req.query;
    const outputFormat = format === 'markdown' ? 'markdown' : 'json';
    const contextDepth = (depth as string) === 'full' ? 'full' : 'summary';

    // Load all articles from Redis
    const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];

    // List all clusters
    if (!cluster && !clusters && !search) {
      const clusterList = Object.entries(RESEARCH_CLUSTERS).map(([id, c]) => {
        const matchedPapers = matchPapersToCluster(articles, c);
        return {
          id,
          name: c.name,
          description: c.description,
          topics: c.topics,
          paperCount: matchedPapers.length,
          hasExtractedPdfs: matchedPapers.filter(p => p.pdfS3Key).length
        };
      });

      return res.json({
        clusters: clusterList,
        totalPapers: articles.length,
        totalWithPdf: articles.filter(a => a.pdfS3Key).length,
        usage: {
          'GET ?cluster=agents': 'Load agents cluster context',
          'GET ?cluster=agents&depth=full': 'Load full paper details',
          'GET ?clusters=agents,reasoning': 'Load multiple clusters',
          'GET ?search=keyword': 'Search papers by keyword',
          'GET ?format=markdown': 'Return as markdown instead of JSON'
        }
      });
    }

    // Search across all papers
    if (search) {
      const searchTerm = (search as string).toLowerCase();
      const matchedPapers = articles.filter(a =>
        a.title.toLowerCase().includes(searchTerm) ||
        a.summary.toLowerCase().includes(searchTerm) ||
        a.tags.some(t => t.toLowerCase().includes(searchTerm)) ||
        a.category.toLowerCase().includes(searchTerm)
      );

      if (outputFormat === 'markdown') {
        const markdown = `# Research Search: "${search}"\n\nFound ${matchedPapers.length} papers.\n\n${formatPapersForContext(matchedPapers, contextDepth)}`;
        res.setHeader('Content-Type', 'text/markdown');
        return res.send(markdown);
      }

      return res.json({
        query: search,
        count: matchedPapers.length,
        papers: matchedPapers.map(p => ({
          id: p.id,
          title: p.title,
          source: p.source,
          category: p.category,
          summary: contextDepth === 'full' ? p.summary : p.summary.substring(0, 200) + '...',
          url: p.url,
          hasPdf: !!p.pdfS3Key,
          tags: p.tags
        }))
      });
    }

    // Load multiple clusters
    if (clusters) {
      const clusterIds = (clusters as string).split(',').map(c => c.trim());
      const results: Record<string, any> = {};
      let allPapers: ResearchArticle[] = [];

      for (const cid of clusterIds) {
        const clusterDef = RESEARCH_CLUSTERS[cid];
        if (clusterDef) {
          const matched = matchPapersToCluster(articles, clusterDef);
          results[cid] = {
            name: clusterDef.name,
            description: clusterDef.description,
            paperCount: matched.length,
            papers: matched.map(p => p.id)
          };
          allPapers = [...allPapers, ...matched];
        }
      }

      // Dedupe papers
      const uniquePapers = Array.from(new Map(allPapers.map(p => [p.id, p])).values());

      if (outputFormat === 'markdown') {
        const markdown = `# Research Context: ${clusterIds.join(', ')}\n\nLoading ${uniquePapers.length} papers across ${clusterIds.length} clusters.\n\n${formatPapersForContext(uniquePapers, contextDepth)}`;
        res.setHeader('Content-Type', 'text/markdown');
        return res.send(markdown);
      }

      return res.json({
        clusters: results,
        totalPapers: uniquePapers.length,
        context: contextDepth === 'full' ? uniquePapers : undefined
      });
    }

    // Load single cluster
    if (cluster) {
      const clusterDef = RESEARCH_CLUSTERS[cluster as string];
      if (!clusterDef) {
        return res.status(404).json({
          error: `Cluster '${cluster}' not found`,
          available: Object.keys(RESEARCH_CLUSTERS)
        });
      }

      const matchedPapers = matchPapersToCluster(articles, clusterDef);

      if (outputFormat === 'markdown') {
        const markdown = `# ${clusterDef.name}\n\n${clusterDef.description}\n\n**Topics:** ${clusterDef.topics.join(', ')}\n\n---\n\n${formatPapersForContext(matchedPapers, contextDepth)}`;
        res.setHeader('Content-Type', 'text/markdown');
        return res.send(markdown);
      }

      return res.json({
        cluster: cluster,
        name: clusterDef.name,
        description: clusterDef.description,
        topics: clusterDef.topics,
        paperCount: matchedPapers.length,
        papers: matchedPapers.map(p => ({
          id: p.id,
          title: p.title,
          source: p.source,
          category: p.category,
          summary: contextDepth === 'full' ? p.summary : p.summary.substring(0, 200) + '...',
          url: p.url,
          hasPdf: !!p.pdfS3Key,
          pdfUrl: p.pdfS3Key ? `/api/research-pdf?id=${p.id}` : undefined,
          tags: p.tags
        }))
      });
    }

    return res.json({ error: 'No valid query provided' });

  } catch (error) {
    console.error('Research Context API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
