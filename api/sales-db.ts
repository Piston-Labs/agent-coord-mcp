import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * Sales Database API - Persistent storage for sales documents
 *
 * Uses Supabase REST API for persistent storage (survives Redis expiry)
 * Falls back to Redis-only if Supabase not configured
 *
 * Supabase Table Schema (sales_documents):
 *   id: uuid primary key
 *   name: text not null
 *   type: text not null (pitch-deck, proposal, one-pager, email, demo-script, case-study, other)
 *   folder: text not null
 *   content: text
 *   target: text (customer/company name)
 *   notes: text
 *   created_by: text not null
 *   created_at: timestamptz default now()
 *   updated_at: timestamptz default now()
 *
 * CREATE TABLE IF NOT EXISTS sales_documents (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   name text NOT NULL,
 *   type text NOT NULL,
 *   folder text NOT NULL,
 *   content text,
 *   target text,
 *   notes text,
 *   created_by text NOT NULL DEFAULT 'eli',
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now()
 * );
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const hasSupabase = SUPABASE_URL && SUPABASE_KEY;

const SALES_TABLE = 'sales_documents';
const REDIS_CACHE_KEY = 'piston:sales:documents';
const CACHE_TTL = 300; // 5 minutes

interface SalesDocument {
  id: string;
  name: string;
  type: string;
  folder: string;
  content: string;
  target?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Supabase REST API helper
async function supabaseRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  if (!hasSupabase) {
    throw new Error('Supabase not configured');
  }

  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY!,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
  };

  const options: RequestInit = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error ${response.status}: ${error}`);
  }

  // DELETE and some PATCH requests return empty body
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET - List documents or get single document
    if (req.method === 'GET') {
      const { id, folder, type, search } = req.query;

      // Check if Supabase is available
      if (!hasSupabase) {
        return res.json({
          documents: [],
          source: 'none',
          error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.',
          setup_sql: `CREATE TABLE IF NOT EXISTS sales_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  folder text NOT NULL,
  content text,
  target text,
  notes text,
  created_by text NOT NULL DEFAULT 'eli',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);`
        });
      }

      // Get single document
      if (id) {
        const docs = await supabaseRequest(`${SALES_TABLE}?id=eq.${id}`);
        if (!docs || docs.length === 0) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.json({ document: docs[0], source: 'supabase' });
      }

      // Build query
      let query = `${SALES_TABLE}?order=updated_at.desc`;
      if (folder) query += `&folder=eq.${folder}`;
      if (type) query += `&type=eq.${type}`;
      if (search) query += `&name=ilike.*${search}*`;

      const documents = await supabaseRequest(query);

      // Calculate folder counts
      const allDocs = await supabaseRequest(`${SALES_TABLE}?select=folder`);
      const folderCounts: Record<string, number> = {};
      (allDocs || []).forEach((d: any) => {
        folderCounts[d.folder] = (folderCounts[d.folder] || 0) + 1;
      });

      return res.json({
        documents: documents || [],
        count: documents?.length || 0,
        folderCounts,
        source: 'supabase'
      });
    }

    // POST - Create document
    if (req.method === 'POST') {
      const { name, type, folder, content, target, notes, created_by = 'eli' } = req.body;

      if (!name || !type) {
        return res.status(400).json({ error: 'name and type required' });
      }

      if (!hasSupabase) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const doc = {
        name,
        type,
        folder: folder || getFolderForType(type),
        content: content || '',
        target,
        notes,
        created_by
      };

      const result = await supabaseRequest(SALES_TABLE, 'POST', doc);

      // Invalidate Redis cache
      await redis.del(REDIS_CACHE_KEY);

      return res.json({
        success: true,
        document: result[0],
        source: 'supabase'
      });
    }

    // PATCH - Update document
    if (req.method === 'PATCH') {
      const { id, ...updates } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Document id required' });
      }

      if (!hasSupabase) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      // Add updated_at
      updates.updated_at = new Date().toISOString();

      await supabaseRequest(`${SALES_TABLE}?id=eq.${id}`, 'PATCH', updates);

      // Get updated document
      const docs = await supabaseRequest(`${SALES_TABLE}?id=eq.${id}`);

      // Invalidate Redis cache
      await redis.del(REDIS_CACHE_KEY);

      return res.json({
        success: true,
        document: docs[0],
        source: 'supabase'
      });
    }

    // DELETE - Delete document
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Document id required' });
      }

      if (!hasSupabase) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      await supabaseRequest(`${SALES_TABLE}?id=eq.${id}`, 'DELETE');

      // Invalidate Redis cache
      await redis.del(REDIS_CACHE_KEY);

      return res.json({ success: true, deleted: id, source: 'supabase' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Sales DB API error:', error);
    return res.status(500).json({
      error: 'Server error',
      details: String(error),
      hint: hasSupabase ? 'Check Supabase table exists' : 'Configure SUPABASE_URL and SUPABASE_KEY'
    });
  }
}

function getFolderForType(type: string): string {
  const folderMap: Record<string, string> = {
    'pitch-deck': 'pitch-decks',
    'proposal': 'proposals',
    'one-pager': 'one-pagers',
    'email': 'emails',
    'demo-script': 'demos',
    'case-study': 'proposals',
    'other': 'other',
    'blank': 'other'
  };
  return folderMap[type] || 'other';
}
