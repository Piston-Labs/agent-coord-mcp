/**
 * GitTree - Git Repository Tree Durable Object
 *
 * Provides browsing, caching, and change tracking for GitHub repositories.
 * One DO per repository for isolated storage and scaling.
 *
 * Features:
 * - Browse file/directory structure
 * - Cache tree snapshots for fast context loading
 * - Track commits and changes across branches
 * - Auto-update via GitHub webhook on push
 * - **WebSocket dashboard** for real-time activity visualization
 *
 * Pattern: One DO per repo (use "owner-repo" as DO name)
 *
 * WebSocket Events (broadcast to connected dashboards):
 * - tree:cached    - Tree snapshot stored
 * - tree:hit       - Cache hit (fast lookup)
 * - tree:miss      - Cache miss (GitHub fetch needed)
 * - tree:expired   - Cache entry expired
 * - commit:tracked - New commits recorded
 * - webhook:push   - GitHub webhook received
 * - search:query   - File search performed
 * - file:access    - File info requested
 * - viewer:join    - Dashboard connected
 * - viewer:leave   - Dashboard disconnected
 */

import type { DurableObject, DurableObjectState } from '@cloudflare/workers-types';

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

interface GitTreeEvent {
  type: 'tree:cached' | 'tree:hit' | 'tree:miss' | 'tree:expired' |
        'commit:tracked' | 'webhook:push' | 'search:query' | 'file:access' |
        'viewer:join' | 'viewer:leave' | 'stats:update';
  timestamp: string;
  repoId: string;
  data: Record<string, unknown>;
}

interface WebSocketMeta {
  viewerId: string;
  connectedAt: string;
  userAgent?: string;
}

interface GitTreeEnv {
  GITHUB_TOKEN?: string;
  ENVIRONMENT?: string;
}

// SQLite row types
interface RepoRow {
  repo_id: string;
  owner: string;
  name: string;
  default_branch: string;
  last_synced_at: string | null;
  last_commit_sha: string | null;
  total_files: number;
  created_at: string;
  updated_at: string;
}

interface TreeRow {
  tree_id: string;
  tree_sha: string;
  branch: string | null;
  commit_sha: string;
  truncated: number;
  file_count: number;
  cached_at: string;
  expires_at: string;
}

interface FileRow {
  id: string;
  tree_id: string;
  path: string;
  type: string;
  sha: string;
  size: number | null;
  mode: string | null;
}

interface CommitRow {
  sha: string;
  message: string;
  author: string;
  author_email: string | null;
  timestamp: string;
  parent_sha: string | null;
  branch: string | null;
  tracked_at: string;
}

interface BranchRow {
  name: string;
  commit_sha: string;
  protected: number;
  last_updated: string;
}

interface FileChangeRow {
  id: string;
  commit_sha: string;
  path: string;
  change_type: string;
  old_path: string | null;
  additions: number;
  deletions: number;
  tracked_at: string;
}

// API response types
interface GitFile {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  mode?: string;
}

interface GitCommit {
  sha: string;
  message: string;
  author: string;
  authorEmail?: string;
  timestamp: string;
  parentSha?: string;
  branch?: string;
}

interface GitBranch {
  name: string;
  commitSha: string;
  protected: boolean;
  lastUpdated: string;
}

// Cache TTL constants (in milliseconds)
const CACHE_TTL = {
  ACTIVE_BRANCH: 15 * 60 * 1000,      // 15 minutes for main/develop
  FEATURE_BRANCH: 60 * 60 * 1000,     // 1 hour for feature branches
  TAG: 7 * 24 * 60 * 60 * 1000,       // 7 days for tags (immutable)
};

export class GitTree implements DurableObject {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private env: GitTreeEnv;
  private repoId: string = '';
  private owner: string = '';
  private name: string = '';

  constructor(state: DurableObjectState, env: GitTreeEnv) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Repository metadata
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        repo_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        last_synced_at TEXT,
        last_commit_sha TEXT,
        total_files INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Tree snapshots (one per branch/commit)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS trees (
        tree_id TEXT PRIMARY KEY,
        tree_sha TEXT NOT NULL,
        branch TEXT,
        commit_sha TEXT NOT NULL,
        truncated INTEGER DEFAULT 0,
        file_count INTEGER DEFAULT 0,
        cached_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

    // File entries
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        tree_id TEXT NOT NULL,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        sha TEXT NOT NULL,
        size INTEGER,
        mode TEXT,
        UNIQUE(tree_id, path)
      )
    `);

    // Commits tracking
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS commits (
        sha TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        author TEXT NOT NULL,
        author_email TEXT,
        timestamp TEXT NOT NULL,
        parent_sha TEXT,
        branch TEXT,
        tracked_at TEXT NOT NULL
      )
    `);

    // Branches
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS branches (
        name TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        protected INTEGER DEFAULT 0,
        last_updated TEXT NOT NULL
      )
    `);

    // File change tracking (for diff analysis)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS file_changes (
        id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        old_path TEXT,
        additions INTEGER DEFAULT 0,
        deletions INTEGER DEFAULT 0,
        tracked_at TEXT NOT NULL
      )
    `);

    // Create indexes
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_files_tree ON files(tree_id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_files_type ON files(type)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_commits_branch ON commits(branch)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp DESC)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_file_changes_commit ON file_changes(commit_sha)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(path)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_trees_branch ON trees(branch)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_trees_expires ON trees(expires_at)`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Extract repo info from query params
    this.repoId = url.searchParams.get('repoId') || '';
    if (this.repoId.includes('-')) {
      const parts = this.repoId.split('-');
      this.owner = parts[0];
      this.name = parts.slice(1).join('-');
    }

    try {
      switch (path) {
        case '/':
        case '/status':
          return this.handleStatus();

        case '/tree':
          if (request.method === 'GET') return this.handleListTree(request);
          if (request.method === 'POST') return this.handleCacheTree(request);
          break;

        case '/file':
          if (request.method === 'GET') return this.handleGetFile(request);
          break;

        case '/commits':
          if (request.method === 'GET') return this.handleListCommits(request);
          if (request.method === 'POST') return this.handleTrackCommits(request);
          break;

        case '/branches':
          if (request.method === 'GET') return this.handleListBranches(request);
          break;

        case '/compare':
          if (request.method === 'GET') return this.handleCompareBranches(request);
          break;

        case '/search':
          if (request.method === 'GET') return this.handleSearchFiles(request);
          break;

        case '/webhook':
          if (request.method === 'POST') return this.handleWebhookUpdate(request);
          break;

        case '/health':
          return Response.json({
            status: 'ok',
            type: 'git-tree',
            repoId: this.repoId
          });
      }

      return Response.json({ error: 'Not found', path }, { status: 404 });
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  // ============================================================================
  // STATUS
  // ============================================================================

  private handleStatus(): Response {
    const repo = this.getRepoInfo();
    const treeCount = this.sql.exec('SELECT COUNT(*) as count FROM trees').toArray()[0];
    const fileCount = this.sql.exec('SELECT COUNT(*) as count FROM files').toArray()[0];
    const commitCount = this.sql.exec('SELECT COUNT(*) as count FROM commits').toArray()[0];
    const branchCount = this.sql.exec('SELECT COUNT(*) as count FROM branches').toArray()[0];

    return Response.json({
      repoId: this.repoId,
      owner: this.owner,
      name: this.name,
      repo,
      stats: {
        cachedTrees: (treeCount as { count: number }).count,
        cachedFiles: (fileCount as { count: number }).count,
        trackedCommits: (commitCount as { count: number }).count,
        trackedBranches: (branchCount as { count: number }).count
      }
    });
  }

  private getRepoInfo(): RepoRow | null {
    const rows = this.sql.exec('SELECT * FROM repos WHERE repo_id = ?', this.repoId).toArray();
    return rows.length > 0 ? rows[0] as unknown as RepoRow : null;
  }

  // ============================================================================
  // TREE OPERATIONS
  // ============================================================================

  private async handleListTree(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const branch = url.searchParams.get('branch') || 'main';
    const path = url.searchParams.get('path') || '';
    const depth = parseInt(url.searchParams.get('depth') || '1');
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    // Check cache first
    const cacheKey = `branch-${branch}`;
    const cached = this.getCachedTree(cacheKey);

    if (cached && !forceRefresh && !this.isCacheExpired(cached)) {
      // Return from cache, filtered by path
      const files = this.getFilesAtPath(cacheKey, path, depth);
      return Response.json({
        source: 'cache',
        branch,
        path: path || '/',
        tree: files,
        count: files.length,
        cachedAt: cached.cached_at,
        expiresAt: cached.expires_at
      });
    }

    // Fetch from GitHub API
    const result = await this.fetchTreeFromGitHub(branch);
    if (!result.success) {
      return Response.json({ error: result.error }, { status: result.status || 500 });
    }

    // Cache the tree
    await this.cacheTree(cacheKey, result.data, branch, result.commitSha);

    // Return filtered results
    const files = this.getFilesAtPath(cacheKey, path, depth);
    return Response.json({
      source: 'fresh',
      branch,
      path: path || '/',
      tree: files,
      count: files.length,
      totalInRepo: result.data.tree.length,
      truncated: result.data.truncated
    });
  }

  private async handleCacheTree(request: Request): Promise<Response> {
    const body = await request.json() as {
      branch?: string;
      commitSha?: string;
      paths?: string[];
    };

    const branch = body.branch || 'main';

    // Fetch full tree from GitHub
    const result = await this.fetchTreeFromGitHub(branch, body.paths);

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 500 });
    }

    // Store in SQLite
    const cacheKey = body.commitSha ? `sha-${body.commitSha}` : `branch-${branch}`;
    await this.cacheTree(cacheKey, result.data, branch, result.commitSha);

    return Response.json({
      success: true,
      cacheKey,
      fileCount: result.data.tree.length,
      truncated: result.data.truncated,
      expiresAt: this.calculateExpiry(branch)
    });
  }

  private getCachedTree(treeId: string): TreeRow | null {
    const rows = this.sql.exec('SELECT * FROM trees WHERE tree_id = ?', treeId).toArray();
    return rows.length > 0 ? rows[0] as unknown as TreeRow : null;
  }

  private isCacheExpired(tree: TreeRow): boolean {
    return new Date(tree.expires_at) < new Date();
  }

  private getFilesAtPath(treeId: string, basePath: string, depth: number): GitFile[] {
    let query = `SELECT * FROM files WHERE tree_id = ?`;
    const params: (string | number)[] = [treeId];

    if (basePath) {
      // Filter to files within this path
      query += ` AND (path = ? OR path LIKE ?)`;
      params.push(basePath, `${basePath}/%`);
    }

    query += ` ORDER BY type DESC, path ASC`;

    const rows = this.sql.exec(query, ...params).toArray() as unknown as FileRow[];

    // Apply depth filtering
    return rows
      .filter(row => {
        if (depth === -1) return true; // No depth limit
        const relativePath = basePath ? row.path.slice(basePath.length + 1) : row.path;
        const pathDepth = relativePath.split('/').filter(Boolean).length;
        return pathDepth <= depth;
      })
      .map(row => ({
        path: row.path,
        type: row.type as 'blob' | 'tree',
        sha: row.sha,
        size: row.size || undefined,
        mode: row.mode || undefined
      }));
  }

  private async cacheTree(
    treeId: string,
    data: { tree: Array<{ path: string; type: string; sha: string; size?: number; mode?: string }>; truncated?: boolean },
    branch: string,
    commitSha: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const expiresAt = this.calculateExpiry(branch);

    // Ensure repo exists
    this.ensureRepoInfo();

    // Delete old tree data for this cache key
    this.sql.exec('DELETE FROM files WHERE tree_id = ?', treeId);
    this.sql.exec('DELETE FROM trees WHERE tree_id = ?', treeId);

    // Insert tree metadata
    this.sql.exec(`
      INSERT INTO trees (tree_id, tree_sha, branch, commit_sha, truncated, file_count, cached_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, treeId, commitSha, branch, commitSha, data.truncated ? 1 : 0, data.tree.length, now, expiresAt);

    // Insert files (batch for performance)
    for (const file of data.tree) {
      const fileId = `${treeId}:${file.path}`;
      this.sql.exec(`
        INSERT OR REPLACE INTO files (id, tree_id, path, type, sha, size, mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, fileId, treeId, file.path, file.type, file.sha, file.size || null, file.mode || null);
    }

    // Update repo stats
    this.sql.exec(`
      UPDATE repos SET
        last_synced_at = ?,
        last_commit_sha = ?,
        total_files = ?,
        updated_at = ?
      WHERE repo_id = ?
    `, now, commitSha, data.tree.length, now, this.repoId);
  }

  private calculateExpiry(branch: string): string {
    const now = Date.now();
    let ttl = CACHE_TTL.FEATURE_BRANCH;

    // Active branches get shorter TTL
    if (['main', 'master', 'develop', 'development'].includes(branch)) {
      ttl = CACHE_TTL.ACTIVE_BRANCH;
    }

    return new Date(now + ttl).toISOString();
  }

  private ensureRepoInfo(): void {
    const existing = this.getRepoInfo();
    if (!existing) {
      const now = new Date().toISOString();
      this.sql.exec(`
        INSERT INTO repos (repo_id, owner, name, default_branch, created_at, updated_at)
        VALUES (?, ?, ?, 'main', ?, ?)
      `, this.repoId, this.owner, this.name, now, now);
    }
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  private handleGetFile(request: Request): Response {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    const branch = url.searchParams.get('branch') || 'main';

    if (!path) {
      return Response.json({ error: 'path parameter required' }, { status: 400 });
    }

    // Try to find in cache
    const cacheKey = `branch-${branch}`;
    const rows = this.sql.exec(
      'SELECT * FROM files WHERE tree_id = ? AND path = ?',
      cacheKey, path
    ).toArray() as unknown as FileRow[];

    if (rows.length === 0) {
      return Response.json({
        error: 'File not found in cache. Try /tree?refresh=true first.',
        path,
        branch
      }, { status: 404 });
    }

    const file = rows[0];
    return Response.json({
      path: file.path,
      type: file.type,
      sha: file.sha,
      size: file.size,
      mode: file.mode,
      rawUrl: `https://raw.githubusercontent.com/${this.owner}/${this.name}/${branch}/${path}`
    });
  }

  // ============================================================================
  // COMMIT OPERATIONS
  // ============================================================================

  private handleListCommits(request: Request): Response {
    const url = new URL(request.url);
    const branch = url.searchParams.get('branch');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const since = url.searchParams.get('since');
    const path = url.searchParams.get('path');

    let query = 'SELECT * FROM commits WHERE 1=1';
    const params: (string | number)[] = [];

    if (branch) {
      query += ' AND branch = ?';
      params.push(branch);
    }

    if (since) {
      query += ' AND timestamp > ?';
      params.push(since);
    }

    if (path) {
      query += ' AND sha IN (SELECT commit_sha FROM file_changes WHERE path = ?)';
      params.push(path);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.sql.exec(query, ...params).toArray() as unknown as CommitRow[];

    return Response.json({
      branch: branch || 'all',
      commits: rows.map(row => this.rowToCommit(row)),
      count: rows.length
    });
  }

  private async handleTrackCommits(request: Request): Promise<Response> {
    const body = await request.json() as {
      commits: Array<{
        sha: string;
        message: string;
        author: string;
        authorEmail?: string;
        timestamp: string;
        parentSha?: string;
      }>;
      branch?: string;
    };

    const branch = body.branch || 'main';
    let tracked = 0;

    for (const commit of body.commits) {
      this.trackCommit({
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        authorEmail: commit.authorEmail,
        timestamp: commit.timestamp,
        parentSha: commit.parentSha,
        branch
      });
      tracked++;
    }

    return Response.json({ success: true, tracked });
  }

  private trackCommit(commit: GitCommit): void {
    const now = new Date().toISOString();
    this.sql.exec(`
      INSERT OR REPLACE INTO commits (sha, message, author, author_email, timestamp, parent_sha, branch, tracked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, commit.sha, commit.message, commit.author, commit.authorEmail || null,
       commit.timestamp, commit.parentSha || null, commit.branch || null, now);
  }

  private rowToCommit(row: CommitRow): GitCommit {
    return {
      sha: row.sha,
      message: row.message,
      author: row.author,
      authorEmail: row.author_email || undefined,
      timestamp: row.timestamp,
      parentSha: row.parent_sha || undefined,
      branch: row.branch || undefined
    };
  }

  // ============================================================================
  // BRANCH OPERATIONS
  // ============================================================================

  private handleListBranches(request: Request): Response {
    const rows = this.sql.exec('SELECT * FROM branches ORDER BY last_updated DESC').toArray() as unknown as BranchRow[];

    return Response.json({
      branches: rows.map(row => ({
        name: row.name,
        commitSha: row.commit_sha,
        protected: Boolean(row.protected),
        lastUpdated: row.last_updated
      })),
      count: rows.length
    });
  }

  private updateBranch(name: string, commitSha: string): void {
    const now = new Date().toISOString();
    this.sql.exec(`
      INSERT OR REPLACE INTO branches (name, commit_sha, last_updated)
      VALUES (?, ?, ?)
    `, name, commitSha, now);
  }

  // ============================================================================
  // COMPARE BRANCHES
  // ============================================================================

  private handleCompareBranches(request: Request): Response {
    const url = new URL(request.url);
    const base = url.searchParams.get('base') || 'main';
    const head = url.searchParams.get('head');

    if (!head) {
      return Response.json({ error: 'head parameter required' }, { status: 400 });
    }

    // Get latest commits for both branches
    const baseCommit = this.getLatestCommit(base);
    const headCommit = this.getLatestCommit(head);

    if (!baseCommit || !headCommit) {
      return Response.json({
        error: 'Branches not cached. Use /commits to track them first.',
        missing: { base: !baseCommit, head: !headCommit }
      }, { status: 404 });
    }

    // Get file changes for head branch commits since base
    const changes = this.sql.exec(`
      SELECT * FROM file_changes
      WHERE commit_sha IN (
        SELECT sha FROM commits
        WHERE branch = ? AND timestamp > (
          SELECT timestamp FROM commits WHERE sha = ?
        )
      )
      ORDER BY tracked_at DESC
    `, head, baseCommit.sha).toArray() as unknown as FileChangeRow[];

    const added = changes.filter(c => c.change_type === 'added');
    const modified = changes.filter(c => c.change_type === 'modified');
    const deleted = changes.filter(c => c.change_type === 'deleted');
    const renamed = changes.filter(c => c.change_type === 'renamed');

    return Response.json({
      base: { branch: base, commit: baseCommit.sha },
      head: { branch: head, commit: headCommit.sha },
      changes: {
        added: added.map(c => c.path),
        modified: modified.map(c => c.path),
        deleted: deleted.map(c => c.path),
        renamed: renamed.map(c => ({ from: c.old_path, to: c.path }))
      },
      summary: {
        filesChanged: changes.length,
        additions: changes.reduce((s, c) => s + c.additions, 0),
        deletions: changes.reduce((s, c) => s + c.deletions, 0)
      }
    });
  }

  private getLatestCommit(branch: string): CommitRow | null {
    const rows = this.sql.exec(
      'SELECT * FROM commits WHERE branch = ? ORDER BY timestamp DESC LIMIT 1',
      branch
    ).toArray() as unknown as CommitRow[];
    return rows.length > 0 ? rows[0] : null;
  }

  // ============================================================================
  // SEARCH FILES
  // ============================================================================

  private handleSearchFiles(request: Request): Response {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const branch = url.searchParams.get('branch') || 'main';
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (!query) {
      return Response.json({ error: 'q (query) parameter required' }, { status: 400 });
    }

    const cacheKey = `branch-${branch}`;

    // Convert glob pattern to SQL LIKE pattern
    const sqlPattern = query
      .replace(/\*\*/g, '%')
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');

    const rows = this.sql.exec(`
      SELECT * FROM files
      WHERE tree_id = ? AND path LIKE ?
      ORDER BY path ASC
      LIMIT ?
    `, cacheKey, sqlPattern, limit).toArray() as unknown as FileRow[];

    return Response.json({
      query,
      branch,
      matches: rows.map(row => ({
        path: row.path,
        type: row.type,
        sha: row.sha,
        size: row.size
      })),
      count: rows.length
    });
  }

  // ============================================================================
  // WEBHOOK HANDLER
  // ============================================================================

  private async handleWebhookUpdate(request: Request): Promise<Response> {
    const body = await request.json() as {
      event: 'push';
      branch: string;
      commits: Array<{
        sha: string;
        message: string;
        author: string;
        timestamp: string;
      }>;
      repository?: { owner: string; name: string };
    };

    // Store repo info if provided
    if (body.repository) {
      this.owner = body.repository.owner;
      this.name = body.repository.name;
      this.ensureRepoInfo();
    }

    // Track new commits
    for (const commit of body.commits) {
      this.trackCommit({
        sha: commit.sha,
        message: commit.message,
        author: commit.author,
        timestamp: commit.timestamp,
        branch: body.branch
      });
    }

    // Invalidate cache for affected branch
    const cacheKey = `branch-${body.branch}`;
    this.invalidateCache(cacheKey);

    // Update branch pointer
    if (body.commits.length > 0) {
      const latestCommit = body.commits[body.commits.length - 1];
      this.updateBranch(body.branch, latestCommit.sha);
    }

    return Response.json({
      success: true,
      tracked: body.commits.length,
      cacheInvalidated: cacheKey
    });
  }

  private invalidateCache(treeId: string): void {
    // Mark cache as expired instead of deleting (allows stale-while-revalidate)
    const expired = new Date(0).toISOString();
    this.sql.exec('UPDATE trees SET expires_at = ? WHERE tree_id = ?', expired, treeId);
  }

  // ============================================================================
  // GITHUB API
  // ============================================================================

  private async fetchTreeFromGitHub(
    branch: string,
    paths?: string[]
  ): Promise<{ success: true; data: { tree: any[]; truncated?: boolean }; commitSha: string } | { success: false; error: string; status?: number }> {
    const token = this.env.GITHUB_TOKEN;
    if (!token) {
      return { success: false, error: 'GITHUB_TOKEN not configured', status: 500 };
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agent-coord-do'
    };

    try {
      // First, get the branch's latest commit
      const refRes = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.name}/git/ref/heads/${branch}`,
        { headers }
      );

      if (!refRes.ok) {
        const error = await refRes.text();
        return { success: false, error: `Branch not found: ${error}`, status: refRes.status };
      }

      const refData = await refRes.json() as { object: { sha: string } };
      const commitSha = refData.object.sha;

      // Get the tree with recursive flag
      const treeRes = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.name}/git/trees/${commitSha}?recursive=1`,
        { headers }
      );

      if (!treeRes.ok) {
        const error = await treeRes.text();
        return { success: false, error: `Failed to fetch tree: ${error}`, status: treeRes.status };
      }

      const treeData = await treeRes.json() as { tree: any[]; truncated?: boolean };

      // If paths filter specified, only keep matching entries
      if (paths && paths.length > 0) {
        treeData.tree = treeData.tree.filter((item: { path: string }) =>
          paths.some(p => item.path.startsWith(p))
        );
      }

      return { success: true, data: treeData, commitSha };
    } catch (error) {
      return { success: false, error: String(error), status: 500 };
    }
  }

  // ============================================================================
  // ALARM HANDLER (Cache Cleanup)
  // ============================================================================

  async alarm(): Promise<void> {
    const now = new Date().toISOString();

    // Delete expired trees and their files
    this.sql.exec(`
      DELETE FROM files WHERE tree_id IN (
        SELECT tree_id FROM trees WHERE expires_at < ?
      )
    `, now);

    this.sql.exec('DELETE FROM trees WHERE expires_at < ?', now);

    // Clean up old commits (keep last 1000)
    this.sql.exec(`
      DELETE FROM commits WHERE sha NOT IN (
        SELECT sha FROM commits ORDER BY timestamp DESC LIMIT 1000
      )
    `);

    // Clean up orphaned file changes
    this.sql.exec(`
      DELETE FROM file_changes WHERE commit_sha NOT IN (
        SELECT sha FROM commits
      )
    `);

    // Schedule next cleanup (1 hour)
    await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }
}
