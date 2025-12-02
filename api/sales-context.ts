import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Sales Context API - Fetches and stores context in teltonika-context-system GitHub repo
 *
 * GET /api/sales-context - List all available context files
 * GET /api/sales-context?file=sales/COMPANY_SUMMARY.md - Get specific file content
 * GET /api/sales-context?category=sales - List files in category
 * POST /api/sales-context - Create/update a file in the repo
 *
 * Categories:
 * - sales: Sales materials (pitches, objection handling, etc.)
 * - product: Product info (vision, pricing, roadmap)
 * - technical: Technical specs and device info
 * - generated: AI-generated sales documents
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_REPO = 'tylerporras/teltonika-context-system';
const GITHUB_BRANCH = 'main';
const CONTEXT_BASE = 'context';

// Cache context for 5 minutes to reduce GitHub API calls
const contextCache: Map<string, { content: string; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Context cluster architecture - hierarchical knowledge organization
// MASTER.md is always loaded first (universal reference)
// Clusters are loaded based on task type for token efficiency

interface ContextCluster {
  name: string;
  description: string;
  files: string[];
  maxTokens: number;  // Target token limit for cluster
  taskTypes: string[]; // Task types that should load this cluster
}

const CONTEXT_CLUSTERS: Record<string, ContextCluster> = {
  master: {
    name: 'Master',
    description: 'Universal reference - always loaded first',
    files: ['MASTER.md'],
    maxTokens: 2000,
    taskTypes: ['*']  // All tasks
  },
  sales: {
    name: 'Sales',
    description: 'Sales materials, pitches, objection handling',
    files: [
      'sales/BETA_POSITIONING_SCRIPT.md',
      'sales/COMPANY_SUMMARY.md',
      'sales/EXECUTIVE_SUMMARY.md',
      'sales/FOR_INVESTORS.md',
      'sales/FOR_SHOPS.md',
      'sales/OBJECTION_HANDLING_PLAYBOOK.md',
      'sales/PITCH_DECK_OUTLINE.md',
      'sales/sales_strategy.md'
    ],
    maxTokens: 15000,
    taskTypes: ['sales', 'pitch', 'proposal', 'outreach']
  },
  product: {
    name: 'Product',
    description: 'Product vision, pricing, roadmap',
    files: [
      'product/BUSINESS_MODEL_PRICING.md',
      'product/product_vision.md',
      'product/technical_roadmap.md',
      'product/brand_identity.md',
      'product/financial_models.md'
    ],
    maxTokens: 12000,
    taskTypes: ['product', 'planning', 'roadmap', 'pricing', 'sales']
  },
  technical: {
    name: 'Technical',
    description: 'Device specs, installation, architecture',
    files: [
      'technical/devices.md',
      'technical/fmb003-io-mapping.md',
      'technical/installation_guide.md',
      'technical/iot_pipeline.md',
      'technical/teltonika_overview.md'
    ],
    maxTokens: 20000,
    taskTypes: ['fix', 'feat', 'refactor', 'debug', 'install']
  },
  prospects: {
    name: 'Prospects',
    description: 'Custom pitches for specific prospects',
    files: [
      'sales/ROD_GIORGIU_PITCH.md',
      'sales/ssf_autoparts_pitch.md',
      'sales/worldpac_pitch.md'
    ],
    maxTokens: 8000,
    taskTypes: ['pitch', 'outreach', 'demo']
  }
};

// Legacy format for backwards compatibility
const CONTEXT_FILES = {
  sales: [
    'BETA_POSITIONING_SCRIPT.md',
    'COMPANY_SUMMARY.md',
    'EXECUTIVE_SUMMARY.md',
    'FOR_INVESTORS.md',
    'FOR_SHOPS.md',
    'OBJECTION_HANDLING_PLAYBOOK.md',
    'PITCH_DECK_OUTLINE.md',
    'sales_strategy.md',
    'ROD_GIORGIU_PITCH.md',
    'ssf_autoparts_pitch.md',
    'worldpac_pitch.md'
  ],
  product: [
    'BUSINESS_MODEL_PRICING.md',
    'VISUALIZATION_SPEC.md',
    'brand_identity.md',
    'design_philosophy.md',
    'financial_models.md',
    'product_vision.md',
    'technical_roadmap.md'
  ],
  technical: [
    'devices.md',
    'fmb003-io-mapping.md',
    'installation_guide.md',
    'iot_pipeline.md',
    'teltonika_overview.md'
  ]
};

// Task type to cluster mapping - determines which clusters to load
function getClustersForTask(taskType: string): string[] {
  const taskTypeMap: Record<string, string[]> = {
    // Sales tasks
    'sales': ['master', 'sales', 'product'],
    'pitch': ['master', 'sales', 'product', 'prospects'],
    'proposal': ['master', 'sales', 'product'],
    'outreach': ['master', 'sales', 'prospects'],
    'demo': ['master', 'sales', 'product', 'technical'],

    // Product tasks
    'product': ['master', 'product'],
    'planning': ['master', 'product'],
    'roadmap': ['master', 'product', 'technical'],
    'pricing': ['master', 'product', 'sales'],

    // Technical tasks
    'fix': ['master', 'technical'],
    'feat': ['master', 'technical', 'product'],
    'refactor': ['master', 'technical'],
    'debug': ['master', 'technical'],
    'install': ['master', 'technical'],

    // Default
    'general': ['master']
  };

  return taskTypeMap[taskType.toLowerCase()] || ['master'];
}

// File descriptions for better agent understanding
const FILE_DESCRIPTIONS: Record<string, string> = {
  'COMPANY_SUMMARY.md': 'Company overview and background for sales materials',
  'EXECUTIVE_SUMMARY.md': 'High-level pitch for C-suite audiences',
  'FOR_INVESTORS.md': 'Investment thesis and financial opportunity',
  'FOR_SHOPS.md': 'Targeting materials for automotive repair shops',
  'OBJECTION_HANDLING_PLAYBOOK.md': 'Strategies for addressing common objections',
  'PITCH_DECK_OUTLINE.md': 'Structured presentation framework',
  'sales_strategy.md': 'Go-to-market and sales methodology',
  'BETA_POSITIONING_SCRIPT.md': 'Beta phase messaging framework',
  'BUSINESS_MODEL_PRICING.md': 'Pricing strategy and business model',
  'product_vision.md': 'Strategic direction and product goals',
  'technical_roadmap.md': 'Development timeline and features',
  'brand_identity.md': 'Brand guidelines and visual identity',
  'devices.md': 'Teltonika device specifications and capabilities'
};

async function fetchGitHubFile(path: string): Promise<string | null> {
  const cacheKey = path;
  const cached = contextCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.content;
  }

  try {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${path}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[sales-context] Failed to fetch ${path}: ${response.status}`);
      return null;
    }

    const content = await response.text();
    contextCache.set(cacheKey, { content, timestamp: Date.now() });
    return content;
  } catch (err) {
    console.error(`[sales-context] Error fetching ${path}:`, err);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle POST - Create/update file in GitHub repo
  if (req.method === 'POST' || req.method === 'PUT') {
    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: 'GitHub token not configured' });
    }

    const { path, content, message, company } = req.body;

    if (!path || !content) {
      return res.status(400).json({ error: 'path and content required' });
    }

    // Determine the full path - store generated docs in context/generated/
    const fullPath = path.startsWith('context/')
      ? path
      : `${CONTEXT_BASE}/generated/${company ? `${company}/` : ''}${path}`;

    try {
      // Check if file exists to get SHA
      let sha: string | undefined;
      try {
        const getUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fullPath}?ref=${GITHUB_BRANCH}`;
        const getRes = await fetch(getUrl, {
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'agent-coord-mcp'
          }
        });
        if (getRes.ok) {
          const existing = await getRes.json();
          sha = existing.sha;
        }
      } catch {
        // File doesn't exist, that's fine
      }

      // Create or update the file
      const putUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fullPath}`;
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'agent-coord-mcp'
        },
        body: JSON.stringify({
          message: message || `Add ${path} via Sales Engineering hub`,
          content: Buffer.from(content).toString('base64'),
          branch: GITHUB_BRANCH,
          sha
        })
      });

      if (!putRes.ok) {
        const error = await putRes.text();
        return res.status(putRes.status).json({ error: `GitHub API error: ${error}` });
      }

      const result = await putRes.json();

      // Clear cache for this path
      contextCache.delete(fullPath);

      return res.json({
        success: true,
        path: fullPath,
        url: result.content?.html_url,
        sha: result.content?.sha,
        action: sha ? 'updated' : 'created'
      });
    } catch (err) {
      console.error('[sales-context] GitHub write error:', err);
      return res.status(500).json({ error: 'Failed to write to GitHub', details: String(err) });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { file, category, search } = req.query;

    // Get specific file
    if (file && typeof file === 'string') {
      const path = file.startsWith('context/') ? file : `${CONTEXT_BASE}/${file}`;
      const content = await fetchGitHubFile(path);

      if (!content) {
        return res.status(404).json({ error: 'File not found', path });
      }

      return res.json({
        file: path,
        content,
        source: 'github',
        repo: GITHUB_REPO,
        branch: GITHUB_BRANCH
      });
    }

    // List files in category
    if (category && typeof category === 'string') {
      const files = CONTEXT_FILES[category as keyof typeof CONTEXT_FILES];
      if (!files) {
        return res.status(400).json({
          error: 'Invalid category',
          validCategories: Object.keys(CONTEXT_FILES)
        });
      }

      return res.json({
        category,
        files: files.map(f => ({
          name: f,
          path: `${CONTEXT_BASE}/${category}/${f}`,
          description: FILE_DESCRIPTIONS[f] || 'Context file'
        })),
        count: files.length
      });
    }

    // Search across all context
    if (search && typeof search === 'string') {
      const results: Array<{ file: string; category: string; match: string }> = [];
      const searchLower = search.toLowerCase();

      for (const [cat, files] of Object.entries(CONTEXT_FILES)) {
        for (const file of files) {
          if (file.toLowerCase().includes(searchLower)) {
            results.push({
              file,
              category: cat,
              match: 'filename'
            });
          } else if (FILE_DESCRIPTIONS[file]?.toLowerCase().includes(searchLower)) {
            results.push({
              file,
              category: cat,
              match: 'description'
            });
          }
        }
      }

      return res.json({
        search,
        results,
        count: results.length
      });
    }

    // List all available context
    const allContext = Object.entries(CONTEXT_FILES).map(([category, files]) => ({
      category,
      files: files.map(f => ({
        name: f,
        path: `${CONTEXT_BASE}/${category}/${f}`,
        description: FILE_DESCRIPTIONS[f] || 'Context file'
      })),
      count: files.length
    }));

    return res.json({
      categories: Object.keys(CONTEXT_FILES),
      context: allContext,
      totalFiles: Object.values(CONTEXT_FILES).flat().length,
      source: {
        repo: GITHUB_REPO,
        branch: GITHUB_BRANCH,
        base: CONTEXT_BASE
      },
      usage: {
        listCategory: '/api/sales-context?category=sales',
        getFile: '/api/sales-context?file=sales/COMPANY_SUMMARY.md',
        search: '/api/sales-context?search=pricing'
      }
    });

  } catch (error) {
    console.error('Sales context API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
