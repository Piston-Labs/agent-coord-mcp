/**
 * Context Clusters - Modular context loading with token optimization
 *
 * Based on context-engine-mcp architecture:
 * - Cluster-based organization (technical, product, sales, etc.)
 * - Task-type mapping for smart context selection
 * - GitHub integration with caching
 * - Token estimation for efficiency
 */

// Types
export interface SelectionResult {
  clusters: string[];
  confidence: number;
  reasoning: string;
}

export interface LoadResult {
  content: string;
  clusters: string[];
  tokenEstimate: number;
  loadTimeMs: number;
  cached: boolean;
}

export interface GitHubFile {
  name: string;
  path: string;
  content?: string;
  size: number;
}

// In-memory cache with TTL
const cache = new Map<string, { data: any; expires: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/**
 * ClusterSelector - Map tasks to relevant context clusters
 */
export class ClusterSelector {
  private clusterKeywords: Map<string, Set<string>> = new Map();
  private taskMappings: Map<string, string[]> = new Map();

  constructor() {
    // Default task mappings for Piston Labs sales engineering
    this.taskMappings.set('feat', ['technical', 'development']);
    this.taskMappings.set('fix', ['technical']);
    this.taskMappings.set('refactor', ['technical', 'development']);
    this.taskMappings.set('plan', ['product', 'development']);
    this.taskMappings.set('docs', ['product', 'documentation']);
    this.taskMappings.set('sales', ['product', 'sales']);
    this.taskMappings.set('support', ['technical', 'support']);
    this.taskMappings.set('pitch', ['sales', 'product']);
    this.taskMappings.set('proposal', ['sales', 'product', 'technical']);
    this.taskMappings.set('onepager', ['sales', 'product']);
    this.taskMappings.set('research', ['technical', 'product', 'sales']);

    // Register cluster keywords
    this.registerCluster('technical', [
      'api', 'database', 'code', 'function', 'class', 'module',
      'deploy', 'server', 'client', 'backend', 'frontend',
      'bug', 'error', 'fix', 'debug', 'test', 'architecture',
      'teltonika', 'device', 'gps', 'iot', 'lambda', 'aws'
    ]);

    this.registerCluster('development', [
      'workflow', 'process', 'git', 'branch', 'merge', 'deploy',
      'ci', 'cd', 'pipeline', 'release', 'version', 'sprint'
    ]);

    this.registerCluster('product', [
      'roadmap', 'feature', 'requirement', 'spec', 'design',
      'user', 'customer', 'feedback', 'priority', 'milestone',
      'vision', 'pricing', 'model', 'dashboard'
    ]);

    this.registerCluster('sales', [
      'pricing', 'deal', 'proposal', 'competitor', 'objection',
      'demo', 'pitch', 'contract', 'revenue', 'pipeline',
      'shop', 'beta', 'fleet', 'automotive', 'repair'
    ]);
  }

  registerCluster(name: string, keywords: string[]): void {
    this.clusterKeywords.set(name, new Set(keywords.map(k => k.toLowerCase())));
  }

  setTaskMapping(taskType: string, clusters: string[]): void {
    this.taskMappings.set(taskType, clusters);
  }

  selectForTaskType(taskType: string): SelectionResult {
    const clusters = this.taskMappings.get(taskType.toLowerCase()) || [];
    return {
      clusters,
      confidence: clusters.length > 0 ? 1.0 : 0.0,
      reasoning: clusters.length > 0
        ? `Task '${taskType}' maps to: ${clusters.join(', ')}`
        : `No mapping for task '${taskType}'`
    };
  }

  selectForQuery(query: string, maxClusters: number = 3): SelectionResult {
    const queryWords = new Set(
      query.toLowerCase().split(/\W+/).filter(w => w.length > 2)
    );

    const scores: Map<string, number> = new Map();

    for (const [cluster, keywords] of this.clusterKeywords) {
      let matches = 0;
      for (const word of queryWords) {
        if (keywords.has(word)) matches++;
      }
      if (matches > 0) {
        scores.set(cluster, matches / keywords.size);
      }
    }

    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxClusters);

    const clusters = sorted.map(([name]) => name);
    const avgScore = sorted.length > 0
      ? sorted.reduce((sum, [, score]) => sum + score, 0) / sorted.length
      : 0;

    return {
      clusters,
      confidence: Math.min(avgScore * 5, 1.0),
      reasoning: `Query matched ${clusters.length} cluster(s): ${clusters.join(', ')}`
    };
  }
}

/**
 * GitHubContextLoader - Fetch context from GitHub repos with caching
 */
export class GitHubContextLoader {
  private owner: string;
  private repo: string;
  private branch: string;
  private token?: string;

  constructor(owner: string, repo: string, branch: string = 'main', token?: string) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token || process.env.GITHUB_TOKEN;
  }

  private async githubFetch<T>(endpoint: string): Promise<T> {
    const cacheKey = `github:${endpoint}`;
    const cached = getCached<T>(cacheKey);
    if (cached) return cached;

    const url = `https://api.github.com${endpoint}`;
    const headers: Record<string, string> = {
      'User-Agent': 'agent-coord-mcp',
      'Accept': 'application/vnd.github.v3+json'
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 403) throw new Error('GitHub rate limit exceeded');
      if (res.status === 404) throw new Error(`GitHub resource not found: ${endpoint}`);
      throw new Error(`GitHub API error: ${res.status}`);
    }

    const data = await res.json() as T;
    setCache(cacheKey, data, 5 * 60 * 1000); // 5 min cache
    return data;
  }

  async listDirectory(path: string): Promise<GitHubFile[]> {
    const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    const contents = await this.githubFetch<any[]>(endpoint);
    return contents.map(item => ({
      name: item.name,
      path: item.path,
      size: item.size
    }));
  }

  async getFileContent(path: string): Promise<string> {
    const cacheKey = `file:${this.owner}/${this.repo}/${path}`;
    const cached = getCached<string>(cacheKey);
    if (cached) return cached;

    const endpoint = `/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    const file = await this.githubFetch<{ content: string; encoding: string }>(endpoint);

    if (file.encoding === 'base64') {
      const content = Buffer.from(file.content, 'base64').toString('utf-8');
      setCache(cacheKey, content, 5 * 60 * 1000); // 5 min cache
      return content;
    }

    return file.content;
  }

  async loadCluster(clusterPath: string): Promise<LoadResult> {
    const startTime = Date.now();
    const cacheKey = `cluster:${this.owner}/${this.repo}/${clusterPath}`;
    const cached = getCached<LoadResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true, loadTimeMs: Date.now() - startTime };
    }

    try {
      const files = await this.listDirectory(clusterPath);
      const mdFiles = files.filter(f => f.name.endsWith('.md'));

      const contents: string[] = [];
      for (const file of mdFiles) {
        try {
          const content = await this.getFileContent(file.path);
          contents.push(`<!-- ${file.name} -->\n${content}`);
        } catch (e) {
          console.error(`Failed to load ${file.path}:`, e);
        }
      }

      const combinedContent = contents.join('\n\n---\n\n');
      const result: LoadResult = {
        content: combinedContent,
        clusters: [clusterPath],
        tokenEstimate: Math.ceil(combinedContent.length / 4),
        loadTimeMs: Date.now() - startTime,
        cached: false
      };

      setCache(cacheKey, result, 5 * 60 * 1000); // 5 min cache
      return result;
    } catch (error) {
      return {
        content: `Error loading cluster ${clusterPath}: ${error}`,
        clusters: [],
        tokenEstimate: 0,
        loadTimeMs: Date.now() - startTime,
        cached: false
      };
    }
  }

  async loadMultipleClusters(clusters: string[]): Promise<LoadResult> {
    const startTime = Date.now();
    const results = await Promise.all(clusters.map(c => this.loadCluster(c)));

    const combinedContent = results
      .filter(r => r.content && !r.content.startsWith('Error'))
      .map(r => r.content)
      .join('\n\n===\n\n');

    return {
      content: combinedContent,
      clusters: results.flatMap(r => r.clusters),
      tokenEstimate: Math.ceil(combinedContent.length / 4),
      loadTimeMs: Date.now() - startTime,
      cached: results.every(r => r.cached)
    };
  }
}

/**
 * Create pre-configured context loader for Piston Labs repos
 */
export function createPistonContextLoader(): GitHubContextLoader {
  return new GitHubContextLoader('Piston-Labs', 'telemetry');
}

/**
 * Create default cluster selector
 */
export function createDefaultSelector(): ClusterSelector {
  return new ClusterSelector();
}

/**
 * High-level function: Get relevant context for a task
 */
export async function getContextForTask(
  taskDescription: string,
  taskType?: string
): Promise<{ content: string; clusters: string[]; tokenEstimate: number }> {
  const selector = createDefaultSelector();
  const loader = createPistonContextLoader();

  // Determine clusters from task type or query
  let selection: SelectionResult;
  if (taskType) {
    selection = selector.selectForTaskType(taskType);
  } else {
    selection = selector.selectForQuery(taskDescription);
  }

  // Map cluster names to repo paths
  const clusterPaths = selection.clusters.map(c => {
    switch (c) {
      case 'sales': return 'context/sales';
      case 'product': return 'context/product';
      case 'technical': return 'context/technical';
      default: return `context/${c}`;
    }
  });

  // Load the clusters
  const result = await loader.loadMultipleClusters(clusterPaths);

  return {
    content: result.content,
    clusters: selection.clusters,
    tokenEstimate: result.tokenEstimate
  };
}
