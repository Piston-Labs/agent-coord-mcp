import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// S3 Configuration
const S3_BUCKET = process.env.RESEARCH_PDF_BUCKET || 'piston-labs-research-papers';
const S3_REGION = process.env.AWS_REGION || 'us-west-1';

const s3Client = new S3Client({
  region: S3_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  } : undefined,
});

const RESEARCH_KEY = 'agent-coord:research-library';
const PDF_STATUS_KEY = 'agent-coord:research-pdf-status';

/**
 * Ensure S3 bucket exists, create if not
 */
async function ensureBucketExists(): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    return true;
  } catch (error: unknown) {
    // Bucket doesn't exist, create it
    if ((error as { name?: string })?.name === 'NotFound' || (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) {
      try {
        await s3Client.send(new CreateBucketCommand({
          Bucket: S3_BUCKET,
          CreateBucketConfiguration: {
            LocationConstraint: S3_REGION === 'us-east-1' ? undefined : S3_REGION as any,
          },
        }));
        console.log(`Created S3 bucket: ${S3_BUCKET}`);
        return true;
      } catch (createError) {
        console.error('Failed to create bucket:', createError);
        return false;
      }
    }
    throw error;
  }
}

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
  // New PDF fields
  pdfUrl?: string;
  pdfS3Key?: string;
  pdfSize?: number;
  pdfExtractedAt?: string;
}

interface CrawlStatus {
  status: 'idle' | 'running' | 'completed' | 'error';
  startedAt?: string;
  completedAt?: string;
  totalPapers: number;
  processedPapers: number;
  successfulDownloads: number;
  failedDownloads: number;
  errors: string[];
  lastPaper?: string;
}

/**
 * Convert arXiv abstract URL to PDF URL
 * https://arxiv.org/abs/1706.03762 -> https://arxiv.org/pdf/1706.03762.pdf
 */
function getArxivPdfUrl(abstractUrl: string): string | null {
  const match = abstractUrl.match(/arxiv\.org\/abs\/([0-9.]+)/);
  if (match) {
    return `https://arxiv.org/pdf/${match[1]}.pdf`;
  }
  return null;
}

/**
 * Extract arXiv paper ID from URL
 */
function getArxivPaperId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)/);
  return match ? match[1] : null;
}

/**
 * Download PDF from arXiv and upload to S3
 */
async function downloadAndStorePdf(
  article: ResearchArticle
): Promise<{ s3Key: string; size: number } | null> {
  const pdfUrl = getArxivPdfUrl(article.url);
  if (!pdfUrl) {
    console.log(`Not an arXiv paper: ${article.url}`);
    return null;
  }

  const paperId = getArxivPaperId(article.url);
  if (!paperId) return null;

  const s3Key = `papers/${paperId}.pdf`;

  try {
    // Check if already exists in S3
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }));
      console.log(`PDF already exists in S3: ${s3Key}`);
      // Get existing file size
      const head = await s3Client.send(new HeadObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      }));
      return { s3Key, size: head.ContentLength || 0 };
    } catch {
      // File doesn't exist, proceed with download
    }

    // Download PDF from arXiv
    console.log(`Downloading PDF: ${pdfUrl}`);
    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'PistonLabs-ResearchBot/1.0 (research@pistonlabs.com)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    const pdfSize = pdfBuffer.byteLength;

    // Upload to S3
    console.log(`Uploading to S3: ${s3Key} (${(pdfSize / 1024 / 1024).toFixed(2)} MB)`);
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: Buffer.from(pdfBuffer),
      ContentType: 'application/pdf',
      Metadata: {
        'paper-id': paperId,
        'title': article.title.substring(0, 255),
        'source-url': article.url,
        'extracted-at': new Date().toISOString(),
      },
    }));

    return { s3Key, size: pdfSize };
  } catch (error) {
    console.error(`Error processing ${article.title}:`, error);
    throw error;
  }
}

/**
 * Research PDF API
 *
 * GET /api/research-pdf?action=status - Get crawl status
 * GET /api/research-pdf?action=list-arxiv - List all arXiv papers
 * GET /api/research-pdf?id=xxx - Stream PDF from S3
 *
 * POST /api/research-pdf?action=crawl - Start PDF extraction
 * POST /api/research-pdf?action=crawl-one&id=xxx - Extract single paper
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, id } = req.query;

    // GET: Stream PDF from S3
    if (req.method === 'GET' && id && !action) {
      // Find article
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const article = articles.find(a => a.id === id);

      if (!article || !article.pdfS3Key) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      try {
        const response = await s3Client.send(new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: article.pdfS3Key,
        }));

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${getArxivPaperId(article.url)}.pdf"`);

        if (response.ContentLength) {
          res.setHeader('Content-Length', response.ContentLength);
        }

        // Stream the PDF
        const stream = response.Body as NodeJS.ReadableStream;
        stream.pipe(res);
        return;
      } catch (error) {
        console.error('S3 fetch error:', error);
        return res.status(500).json({ error: 'Failed to fetch PDF from S3' });
      }
    }

    // POST: Reset crawl status (if stuck)
    if (req.method === 'POST' && action === 'reset') {
      await redis.del(PDF_STATUS_KEY);
      return res.json({ success: true, message: 'Crawl status reset to idle' });
    }

    // GET: Status
    if (req.method === 'GET' && action === 'status') {
      const status: CrawlStatus = await redis.get(PDF_STATUS_KEY) || {
        status: 'idle',
        totalPapers: 0,
        processedPapers: 0,
        successfulDownloads: 0,
        failedDownloads: 0,
        errors: [],
      };

      // Count papers with PDFs
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const withPdf = articles.filter(a => a.pdfS3Key).length;
      const arxivPapers = articles.filter(a => a.url.includes('arxiv.org')).length;

      return res.json({
        ...status,
        summary: {
          totalArticles: articles.length,
          arxivPapers,
          withPdf,
          pendingExtraction: arxivPapers - withPdf,
        },
      });
    }

    // GET: List arXiv papers
    if (req.method === 'GET' && action === 'list-arxiv') {
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const arxivPapers = articles
        .filter(a => a.url.includes('arxiv.org'))
        .map(a => ({
          id: a.id,
          title: a.title,
          arxivId: getArxivPaperId(a.url),
          url: a.url,
          pdfUrl: getArxivPdfUrl(a.url),
          hasPdf: !!a.pdfS3Key,
          pdfS3Key: a.pdfS3Key,
          pdfSize: a.pdfSize,
        }));

      return res.json({
        count: arxivPapers.length,
        papers: arxivPapers,
      });
    }

    // POST: Crawl single paper
    if (req.method === 'POST' && action === 'crawl-one' && id) {
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const articleIndex = articles.findIndex(a => a.id === id);

      if (articleIndex === -1) {
        return res.status(404).json({ error: 'Article not found' });
      }

      const article = articles[articleIndex];

      if (!article.url.includes('arxiv.org')) {
        return res.status(400).json({ error: 'Not an arXiv paper' });
      }

      try {
        const result = await downloadAndStorePdf(article);

        if (result) {
          // Update article with PDF info
          article.pdfS3Key = result.s3Key;
          article.pdfSize = result.size;
          article.pdfUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${result.s3Key}`;
          article.pdfExtractedAt = new Date().toISOString();

          // Save back to Redis
          await redis.del(RESEARCH_KEY);
          for (const a of articles.reverse()) {
            await redis.lpush(RESEARCH_KEY, a);
          }

          return res.json({
            success: true,
            article: {
              id: article.id,
              title: article.title,
              pdfS3Key: article.pdfS3Key,
              pdfSize: article.pdfSize,
              pdfUrl: article.pdfUrl,
            },
          });
        }

        return res.status(400).json({ error: 'Could not extract PDF URL' });
      } catch (error) {
        return res.status(500).json({ error: String(error) });
      }
    }

    // POST: Start full crawl
    if (req.method === 'POST' && action === 'crawl') {
      // Check AWS credentials
      if (!process.env.AWS_ACCESS_KEY_ID) {
        return res.status(400).json({
          error: 'AWS credentials not configured',
          hint: 'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Vercel environment variables',
        });
      }

      // Ensure bucket exists
      const bucketReady = await ensureBucketExists();
      if (!bucketReady) {
        return res.status(500).json({
          error: 'Failed to access or create S3 bucket',
          bucket: S3_BUCKET,
        });
      }

      // Check if already running
      const currentStatus: CrawlStatus | null = await redis.get(PDF_STATUS_KEY);
      if (currentStatus?.status === 'running') {
        return res.status(409).json({
          error: 'Crawl already in progress',
          status: currentStatus,
        });
      }

      // Get all arXiv papers
      const articles: ResearchArticle[] = await redis.lrange(RESEARCH_KEY, 0, -1) as ResearchArticle[] || [];
      const arxivPapers = articles.filter(a =>
        a.url.includes('arxiv.org') && !a.pdfS3Key
      );

      if (arxivPapers.length === 0) {
        return res.json({
          message: 'No papers need extraction',
          totalArxiv: articles.filter(a => a.url.includes('arxiv.org')).length,
          alreadyExtracted: articles.filter(a => a.pdfS3Key).length,
        });
      }

      // Initialize status
      const status: CrawlStatus = {
        status: 'running',
        startedAt: new Date().toISOString(),
        totalPapers: arxivPapers.length,
        processedPapers: 0,
        successfulDownloads: 0,
        failedDownloads: 0,
        errors: [],
      };
      await redis.set(PDF_STATUS_KEY, status);

      // Process papers (in batches to avoid timeout)
      const batchSize = 5; // Process 5 at a time to stay under Vercel timeout
      const batch = arxivPapers.slice(0, batchSize);

      for (const article of batch) {
        try {
          status.lastPaper = article.title;
          await redis.set(PDF_STATUS_KEY, status);

          const result = await downloadAndStorePdf(article);

          if (result) {
            // Update article
            const idx = articles.findIndex(a => a.id === article.id);
            if (idx !== -1) {
              articles[idx].pdfS3Key = result.s3Key;
              articles[idx].pdfSize = result.size;
              articles[idx].pdfUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${result.s3Key}`;
              articles[idx].pdfExtractedAt = new Date().toISOString();
            }
            status.successfulDownloads++;
          }
        } catch (error) {
          status.failedDownloads++;
          status.errors.push(`${article.title}: ${String(error)}`);
        }
        status.processedPapers++;
      }

      // Save updated articles
      await redis.del(RESEARCH_KEY);
      for (const a of articles.reverse()) {
        await redis.lpush(RESEARCH_KEY, a);
      }

      // Update status
      const remaining = arxivPapers.length - batchSize;
      status.status = remaining > 0 ? 'running' : 'completed';
      status.completedAt = remaining <= 0 ? new Date().toISOString() : undefined;
      await redis.set(PDF_STATUS_KEY, status);

      return res.json({
        message: remaining > 0
          ? `Processed ${batchSize} papers. ${remaining} remaining. Call again to continue.`
          : 'All papers processed',
        status,
        nextBatch: remaining > 0 ? arxivPapers.slice(batchSize, batchSize + 5).map(a => a.title) : [],
      });
    }

    // Default: show usage
    return res.json({
      usage: {
        'GET /api/research-pdf?action=status': 'Get crawl status and PDF counts',
        'GET /api/research-pdf?action=list-arxiv': 'List all arXiv papers and their PDF status',
        'GET /api/research-pdf?id=xxx': 'Stream PDF for article ID',
        'POST /api/research-pdf?action=crawl': 'Start batch PDF extraction (5 papers per call)',
        'POST /api/research-pdf?action=crawl-one&id=xxx': 'Extract PDF for single article',
      },
      config: {
        bucket: S3_BUCKET,
        region: S3_REGION,
        hasAwsCredentials: !!process.env.AWS_ACCESS_KEY_ID,
      },
    });

  } catch (error) {
    console.error('Research PDF API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
