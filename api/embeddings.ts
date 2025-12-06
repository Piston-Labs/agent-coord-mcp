import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Swappable Embeddings API - Provider-agnostic vector embedding generation
 *
 * Supports multiple providers with automatic fallback:
 * 1. Jina AI (10M free tokens, 1024 dimensions)
 * 2. Cloudflare AI (pay-per-use, 768 dimensions)
 * 3. Word overlap fallback (no API needed, returns sparse vectors)
 *
 * Usage:
 *   POST /api/embeddings
 *   Body: { "input": ["text1", "text2", ...] }
 *   Optional: { "provider": "jina" | "cloudflare" | "fallback" }
 *
 * Returns:
 *   { "embeddings": [[...], [...]], "provider": "jina", "dimensions": 1024 }
 *
 * Based on Titans/MIRAS Phase 1.5 requirements for semantic similarity.
 *
 * @see https://jina.ai/embeddings/
 */

interface EmbeddingRequest {
  input: string | string[];
  provider?: 'jina' | 'cloudflare' | 'fallback' | 'auto';
}

interface EmbeddingResponse {
  embeddings: number[][];
  provider: string;
  dimensions: number;
  cached?: boolean;
  tokenCount?: number;
  error?: string;
}

// Jina AI embeddings - 10M free tokens, 1024 dimensions
async function getJinaEmbeddings(texts: string[]): Promise<{ embeddings: number[][]; tokens?: number }> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) throw new Error('JINA_API_KEY not configured');

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: texts,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    embeddings: data.data.map((d: { embedding: number[] }) => d.embedding),
    tokens: data.usage?.total_tokens,
  };
}

// Cloudflare AI embeddings - pay-per-use, 768 dimensions
async function getCloudflareEmbeddings(texts: string[]): Promise<{ embeddings: number[][] }> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CF_ACCOUNT_ID or CF_API_TOKEN not configured');

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-base-en-v1.5`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cloudflare API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    embeddings: data.result.data,
  };
}

/**
 * Fallback: Generate sparse word-overlap vectors
 * Not true embeddings but allows basic similarity without API
 *
 * Creates a consistent 256-dimension vector from word frequencies.
 * Uses hash-based bucketing for deterministic dimension assignment.
 */
function generateFallbackEmbeddings(texts: string[]): { embeddings: number[][] } {
  const DIMENSIONS = 256;

  const embeddings = texts.map((text) => {
    const vector = new Array(DIMENSIONS).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 2);

    // Count word frequencies
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Hash each word to a dimension and accumulate
    for (const [word, count] of wordCounts) {
      // Simple hash function
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
      }
      const dim = Math.abs(hash) % DIMENSIONS;
      vector[dim] += count;
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < DIMENSIONS; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  });

  return { embeddings };
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}

/**
 * Determine best available provider
 */
function getAvailableProvider(): 'jina' | 'cloudflare' | 'fallback' {
  if (process.env.JINA_API_KEY) return 'jina';
  if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) return 'cloudflare';
  return 'fallback';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Return available providers and status
  if (req.method === 'GET') {
    const { action } = req.query;

    if (action === 'similarity') {
      // GET /api/embeddings?action=similarity&text1=hello&text2=hi
      const { text1, text2 } = req.query;
      if (!text1 || !text2) {
        return res.status(400).json({ error: 'text1 and text2 required' });
      }

      const provider = getAvailableProvider();
      let embeddings: number[][];
      let dimensions: number;

      try {
        if (provider === 'jina') {
          const result = await getJinaEmbeddings([text1 as string, text2 as string]);
          embeddings = result.embeddings;
          dimensions = 1024;
        } else if (provider === 'cloudflare') {
          const result = await getCloudflareEmbeddings([text1 as string, text2 as string]);
          embeddings = result.embeddings;
          dimensions = 768;
        } else {
          const result = generateFallbackEmbeddings([text1 as string, text2 as string]);
          embeddings = result.embeddings;
          dimensions = 256;
        }

        const similarity = cosineSimilarity(embeddings[0], embeddings[1]);

        return res.json({
          similarity,
          provider,
          dimensions,
          text1: (text1 as string).substring(0, 50),
          text2: (text2 as string).substring(0, 50),
        });
      } catch (error) {
        // Fallback on error
        const result = generateFallbackEmbeddings([text1 as string, text2 as string]);
        const similarity = cosineSimilarity(result.embeddings[0], result.embeddings[1]);

        return res.json({
          similarity,
          provider: 'fallback',
          dimensions: 256,
          warning: `Primary provider failed: ${String(error)}`,
        });
      }
    }

    // Default GET: Provider status
    return res.json({
      providers: {
        jina: {
          available: !!process.env.JINA_API_KEY,
          dimensions: 1024,
          freeTokens: '10M',
          model: 'jina-embeddings-v3',
        },
        cloudflare: {
          available: !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN),
          dimensions: 768,
          model: 'bge-base-en-v1.5',
        },
        fallback: {
          available: true,
          dimensions: 256,
          note: 'Word-hash vectors, no API required',
        },
      },
      recommended: getAvailableProvider(),
      endpoints: {
        generate: 'POST /api/embeddings',
        similarity: 'GET /api/embeddings?action=similarity&text1=X&text2=Y',
        status: 'GET /api/embeddings',
      },
    });
  }

  // POST: Generate embeddings
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body as EmbeddingRequest;
    const input = Array.isArray(body.input) ? body.input : [body.input];

    if (!input || input.length === 0) {
      return res.status(400).json({ error: 'input required (string or array of strings)' });
    }

    // Limit batch size
    if (input.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 texts per request' });
    }

    let provider = body.provider || 'auto';
    if (provider === 'auto') {
      provider = getAvailableProvider();
    }

    const result: EmbeddingResponse = {
      embeddings: [],
      provider,
      dimensions: 0,
    };

    try {
      if (provider === 'jina') {
        const jinaResult = await getJinaEmbeddings(input);
        result.embeddings = jinaResult.embeddings;
        result.dimensions = 1024;
        result.tokenCount = jinaResult.tokens;
      } else if (provider === 'cloudflare') {
        const cfResult = await getCloudflareEmbeddings(input);
        result.embeddings = cfResult.embeddings;
        result.dimensions = 768;
      } else {
        const fallbackResult = generateFallbackEmbeddings(input);
        result.embeddings = fallbackResult.embeddings;
        result.dimensions = 256;
      }
    } catch (providerError) {
      // Auto-fallback on provider failure
      console.warn(`Provider ${provider} failed, falling back:`, providerError);

      const fallbackResult = generateFallbackEmbeddings(input);
      result.embeddings = fallbackResult.embeddings;
      result.dimensions = 256;
      result.provider = 'fallback';
      result.error = `Primary provider (${provider}) failed: ${String(providerError)}`;
    }

    return res.json(result);
  } catch (error) {
    console.error('Embeddings API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
