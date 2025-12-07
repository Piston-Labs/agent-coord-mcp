import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const PERSISTENCE_DIR = join(process.cwd(), 'research', 'PERSISTENCE');

interface DocMetadata {
  cluster?: string[];
  complexity?: string;
  ai_summary?: string;
  dependencies?: string[];
  tags?: string[];
  last_updated?: string;
}

interface DocInfo {
  id: string;
  filename: string;
  title: string;
  metadata: DocMetadata;
  preview: string;
}

interface FullDoc extends DocInfo {
  content: string;
  htmlContent: string;
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { metadata: DocMetadata; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { metadata: {}, body: content };
  }

  const yamlContent = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Simple YAML parser for our structure
  const metadata: DocMetadata = {};
  const lines = yamlContent.split('\n');
  let currentKey = '';
  let currentArray: string[] = [];
  let inArray = false;

  for (const line of lines) {
    if (line.match(/^(\w+):\s*\[/)) {
      // Inline array: key: [val1, val2]
      const match = line.match(/^(\w+):\s*\[(.*)\]$/);
      if (match) {
        const key = match[1] as keyof DocMetadata;
        const values = match[2].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        (metadata as any)[key] = values;
      }
    } else if (line.match(/^(\w+):\s*$/)) {
      // Start of array block
      currentKey = line.match(/^(\w+):/)?.[1] || '';
      currentArray = [];
      inArray = true;
    } else if (inArray && line.match(/^\s+-\s+/)) {
      // Array item
      const value = line.replace(/^\s+-\s+/, '').trim();
      currentArray.push(value);
    } else if (line.match(/^(\w+):\s*"(.*)"/)) {
      // Quoted string
      const match = line.match(/^(\w+):\s*"(.*)"/);
      if (match) {
        (metadata as any)[match[1]] = match[2];
      }
      inArray = false;
      if (currentKey && currentArray.length > 0) {
        (metadata as any)[currentKey] = currentArray;
        currentKey = '';
        currentArray = [];
      }
    } else if (line.match(/^(\w+):\s*(.+)$/)) {
      // Simple key: value
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match && !inArray) {
        (metadata as any)[match[1]] = match[2];
      }
      if (currentKey && currentArray.length > 0) {
        (metadata as any)[currentKey] = currentArray;
        currentKey = '';
        currentArray = [];
        inArray = false;
      }
    }
  }

  // Handle any remaining array
  if (currentKey && currentArray.length > 0) {
    (metadata as any)[currentKey] = currentArray;
  }

  return { metadata, body };
}

/**
 * Convert markdown to basic HTML
 */
function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Tables (basic support)
  const tableRegex = /\|(.+)\|\n\|[-|]+\|\n((?:\|.+\|\n?)+)/g;
  html = html.replace(tableRegex, (match, header, body) => {
    const headerCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Paragraphs (wrap remaining text blocks)
  html = html.split('\n\n').map(block => {
    if (block.trim() && !block.startsWith('<')) {
      return `<p>${block.trim()}</p>`;
    }
    return block;
  }).join('\n');

  return html;
}

/**
 * Extract title from markdown content
 */
function extractTitle(content: string): string {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1] : 'Untitled';
}

/**
 * Get preview text (first paragraph after title)
 */
function extractPreview(content: string): string {
  // Remove frontmatter
  const body = content.replace(/^---[\s\S]*?---\n/, '');
  // Find first substantial paragraph
  const paragraphs = body.split('\n\n').filter(p =>
    p.trim() &&
    !p.startsWith('#') &&
    !p.startsWith('|') &&
    !p.startsWith('>')
  );
  if (paragraphs.length > 0) {
    return paragraphs[0].substring(0, 200).replace(/\n/g, ' ').trim() + '...';
  }
  return '';
}

/**
 * PERSISTENCE Documents API
 *
 * GET /api/persistence-docs - List all documents
 * GET /api/persistence-docs?id=filename - Get specific document
 * GET /api/persistence-docs?cluster=philosophy - Filter by cluster
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id, cluster } = req.query;

    // Check if directory exists
    if (!existsSync(PERSISTENCE_DIR)) {
      return res.status(404).json({ error: 'PERSISTENCE directory not found' });
    }

    // Get specific document
    if (id && typeof id === 'string') {
      const filename = id.endsWith('.md') ? id : `${id}.md`;
      const filepath = join(PERSISTENCE_DIR, filename);

      if (!existsSync(filepath)) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const content = readFileSync(filepath, 'utf-8');
      const { metadata, body } = parseFrontmatter(content);

      const doc: FullDoc = {
        id: filename.replace('.md', ''),
        filename,
        title: extractTitle(body),
        metadata,
        preview: extractPreview(content),
        content: body,
        htmlContent: markdownToHtml(body),
      };

      return res.json(doc);
    }

    // List all documents
    const files = readdirSync(PERSISTENCE_DIR).filter(f => f.endsWith('.md'));

    const docs: DocInfo[] = files.map(filename => {
      const filepath = join(PERSISTENCE_DIR, filename);
      const content = readFileSync(filepath, 'utf-8');
      const { metadata, body } = parseFrontmatter(content);

      return {
        id: filename.replace('.md', ''),
        filename,
        title: extractTitle(body),
        metadata,
        preview: metadata.ai_summary || extractPreview(content),
      };
    });

    // Filter by cluster if specified
    let filteredDocs = docs;
    if (cluster && typeof cluster === 'string') {
      filteredDocs = docs.filter(doc =>
        doc.metadata.cluster?.some(c =>
          c.toLowerCase().includes(cluster.toLowerCase())
        )
      );
    }

    // Sort by complexity (L1 first) then alphabetically
    filteredDocs.sort((a, b) => {
      const complexityOrder = { 'L1': 1, 'L2': 2, 'L3': 3 };
      const aOrder = complexityOrder[a.metadata.complexity as keyof typeof complexityOrder] || 4;
      const bOrder = complexityOrder[b.metadata.complexity as keyof typeof complexityOrder] || 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.title.localeCompare(b.title);
    });

    return res.json({
      count: filteredDocs.length,
      documents: filteredDocs,
      clusters: [...new Set(docs.flatMap(d => d.metadata.cluster || []))],
    });

  } catch (error) {
    console.error('Persistence docs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
