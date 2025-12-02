import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SALES_FILES_KEY = 'piston:sales:files';
const SALES_FOLDERS_KEY = 'piston:sales:folders';

interface SalesFile {
  id: string;
  name: string;
  type: 'pitch-deck' | 'proposal' | 'one-pager' | 'email' | 'demo-script' | 'case-study';
  folder: string;
  content: string;
  target?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SalesFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
}

/**
 * Sales Files API - Document management for Sales Engineering
 *
 * GET /api/sales-files - List all files (optional: ?folder=X, ?type=X)
 * GET /api/sales-files?id=X - Get single file
 * POST /api/sales-files - Create new file
 * PATCH /api/sales-files - Update file
 * DELETE /api/sales-files?id=X - Delete file
 *
 * GET /api/sales-files?folders=true - List all folders
 * POST /api/sales-files?action=create-folder - Create folder
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List files or get single file
    if (req.method === 'GET') {
      const { id, folder, type, folders } = req.query;

      // List folders
      if (folders === 'true') {
        const foldersData = await redis.hgetall(SALES_FOLDERS_KEY);
        const folderList = foldersData
          ? Object.values(foldersData).map(f => typeof f === 'string' ? JSON.parse(f) : f)
          : getDefaultFolders();
        return res.json({ folders: folderList });
      }

      // Get single file
      if (id) {
        const file = await redis.hget(SALES_FILES_KEY, id as string);
        if (!file) {
          return res.status(404).json({ error: 'File not found' });
        }
        return res.json({ file: typeof file === 'string' ? JSON.parse(file) : file });
      }

      // List all files with optional filters
      const filesData = await redis.hgetall(SALES_FILES_KEY);
      let files: SalesFile[] = filesData
        ? Object.values(filesData).map(f => typeof f === 'string' ? JSON.parse(f) : f)
        : [];

      // Apply filters
      if (folder) {
        files = files.filter(f => f.folder === folder);
      }
      if (type) {
        files = files.filter(f => f.type === type);
      }

      // Sort by createdAt descending
      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Get folder counts
      const folderCounts: Record<string, number> = {};
      const allFiles = filesData
        ? Object.values(filesData).map(f => typeof f === 'string' ? JSON.parse(f) : f)
        : [];
      allFiles.forEach((f: SalesFile) => {
        folderCounts[f.folder] = (folderCounts[f.folder] || 0) + 1;
      });

      return res.json({
        files,
        count: files.length,
        folderCounts
      });
    }

    // POST - Create file or folder
    if (req.method === 'POST') {
      const { action } = req.query;

      // Create folder
      if (action === 'create-folder') {
        const { name, parentId } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'Folder name required' });
        }

        const folder: SalesFolder = {
          id: `folder-${Date.now().toString(36)}`,
          name,
          parentId: parentId || undefined,
          createdAt: new Date().toISOString()
        };

        await redis.hset(SALES_FOLDERS_KEY, { [folder.id]: JSON.stringify(folder) });
        return res.json({ success: true, folder });
      }

      // Create file
      const { name, type, folder, content, target, notes, createdBy } = req.body;

      if (!name || !type) {
        return res.status(400).json({ error: 'name and type required' });
      }

      const file: SalesFile = {
        id: `file-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`,
        name,
        type,
        folder: folder || getFolderForType(type),
        content: content || '',
        target,
        notes,
        createdBy: createdBy || 'eli',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await redis.hset(SALES_FILES_KEY, { [file.id]: JSON.stringify(file) });

      return res.json({ success: true, file });
    }

    // PATCH - Update file
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'File id required' });
      }

      const existing = await redis.hget(SALES_FILES_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'File not found' });
      }

      const file = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const updated: SalesFile = {
        ...file,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      await redis.hset(SALES_FILES_KEY, { [id]: JSON.stringify(updated) });

      return res.json({ success: true, file: updated });
    }

    // DELETE - Delete file
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'File id required' });
      }

      await redis.hdel(SALES_FILES_KEY, id as string);

      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Sales files API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

function getFolderForType(type: string): string {
  const folderMap: Record<string, string> = {
    'pitch-deck': 'pitch-decks',
    'proposal': 'proposals',
    'one-pager': 'one-pagers',
    'email': 'emails',
    'demo-script': 'demos',
    'case-study': 'proposals'
  };
  return folderMap[type] || 'proposals';
}

function getDefaultFolders(): SalesFolder[] {
  return [
    { id: 'proposals', name: 'Proposals', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'pitch-decks', name: 'Pitch Decks', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'emails', name: 'Email Templates', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'one-pagers', name: 'One-Pagers', createdAt: '2024-01-01T00:00:00Z' },
    { id: 'demos', name: 'Demo Scripts', createdAt: '2024-01-01T00:00:00Z' }
  ];
}
