import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const GENERATED_DOCS_KEY = 'agent-coord:generated-docs';

/**
 * Document Generation API for Piston Labs
 * 
 * POST /api/generate-doc - Generate a sales document
 * GET /api/generate-doc - List generated documents
 * 
 * Note: Actual Google Drive integration requires local execution.
 * This API creates document requests that can be fulfilled by claude-desktop.
 */

interface DocRequest {
  id: string;
  type: 'pitch_deck' | 'one_pager' | 'shop_brief' | 'investor_brief' | 'technical_brief';
  target: 'shop-owner' | 'investor' | 'partner' | 'internal';
  prompt: string;
  customization?: {
    shopName?: string;
    ownerName?: string;
    location?: string;
    painPoints?: string[];
    features?: string[];
  };
  status: 'pending' | 'generating' | 'completed' | 'failed';
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  result?: {
    docUrl?: string;
    docId?: string;
    title?: string;
    error?: string;
  };
}

// Document type templates (summaries for quick generation)
const DOC_TEMPLATES = {
  pitch_deck: {
    name: 'Pitch Deck',
    sections: ['Problem', 'Solution', 'Market', 'Product', 'Team', 'Traction', 'Ask'],
    targetLength: '10-15 slides'
  },
  one_pager: {
    name: 'Executive Summary',
    sections: ['Problem', 'Solution', 'Market Opportunity', 'Business Model', 'Team', 'Ask'],
    targetLength: '1 page'
  },
  shop_brief: {
    name: 'Shop Owner Brief',
    sections: ['Your Problem', 'Our Solution', 'How It Works', 'What You Get', 'Next Steps'],
    targetLength: '2 pages'
  },
  investor_brief: {
    name: 'Investor Brief',
    sections: ['Executive Summary', 'Market', 'Product', 'Traction', 'Team', 'Financials', 'Ask'],
    targetLength: '3-5 pages'
  },
  technical_brief: {
    name: 'Technical Brief',
    sections: ['Architecture', 'Infrastructure', 'Data Flow', 'Security', 'Scalability'],
    targetLength: '5-10 pages'
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List document requests or get templates
    if (req.method === 'GET') {
      const { action, status } = req.query;

      // Get available templates
      if (action === 'templates') {
        return res.json({ templates: DOC_TEMPLATES });
      }

      // List document requests
      const docsRaw = await redis.hgetall(GENERATED_DOCS_KEY) || {};
      let docs: DocRequest[] = Object.values(docsRaw).map((d: unknown) =>
        typeof d === 'string' ? JSON.parse(d) : d
      ) as DocRequest[];

      // Filter by status if provided
      if (status && typeof status === 'string') {
        docs = docs.filter(d => d.status === status);
      }

      // Sort by request time, newest first
      docs.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

      return res.json({
        docs,
        count: docs.length,
        pending: docs.filter(d => d.status === 'pending').length
      });
    }

    // POST: Create document request
    if (req.method === 'POST') {
      let body: any;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const {
        type = 'pitch_deck',
        target = 'shop-owner',
        prompt,
        customization,
        requestedBy = 'unknown'
      } = body;

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }

      // Validate type
      if (!DOC_TEMPLATES[type as keyof typeof DOC_TEMPLATES]) {
        return res.status(400).json({
          error: `Invalid type: ${type}`,
          valid: Object.keys(DOC_TEMPLATES)
        });
      }

      const docRequest: DocRequest = {
        id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        type,
        target,
        prompt,
        customization,
        status: 'pending',
        requestedBy,
        requestedAt: new Date().toISOString()
      };

      await redis.hset(GENERATED_DOCS_KEY, { [docRequest.id]: JSON.stringify(docRequest) });

      // Generate document content immediately (simplified version)
      const template = DOC_TEMPLATES[type as keyof typeof DOC_TEMPLATES];
      const content = generateDocumentContent(docRequest, template);

      // Update with generated content
      docRequest.status = 'completed';
      docRequest.completedAt = new Date().toISOString();
      docRequest.result = {
        title: `${template.name} - ${customization?.shopName || 'Piston Labs'}`,
        docId: docRequest.id
      };

      await redis.hset(GENERATED_DOCS_KEY, { [docRequest.id]: JSON.stringify(docRequest) });

      return res.json({
        success: true,
        docRequest,
        content,
        note: 'Document content generated. For Google Drive upload, use claude-desktop with local credentials.'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Generate doc error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

function generateDocumentContent(request: DocRequest, template: typeof DOC_TEMPLATES.pitch_deck): string {
  const { customization, target, prompt } = request;
  const shopName = customization?.shopName || 'Your Shop';
  const ownerName = customization?.ownerName || 'Shop Owner';
  const location = customization?.location || '';

  // Generate content based on type and target
  let content = `# ${template.name}\n\n`;
  content += `**Prepared for:** ${shopName}${location ? ` (${location})` : ''}\n`;
  content += `**Date:** ${new Date().toLocaleDateString()}\n\n`;
  content += `---\n\n`;

  if (request.type === 'shop_brief' || target === 'shop-owner') {
    content += generateShopContent(shopName, ownerName, customization?.painPoints || []);
  } else if (request.type === 'investor_brief' || target === 'investor') {
    content += generateInvestorContent();
  } else if (request.type === 'technical_brief') {
    content += generateTechnicalContent();
  } else {
    content += generatePitchContent(shopName, target);
  }

  return content;
}

function generateShopContent(shopName: string, ownerName: string, painPoints: string[]): string {
  return `## The Problem

**60% of customers never return** after their first visit to an independent repair shop. Not because of poor service—because there's no way to stay connected between appointments.

Dealers dominate with connected car data. They know when your customers need service before you do.

## Our Solution

**Piston Labs** gives you the same competitive advantage dealers have: real-time vehicle data and automated customer retention.

### How It Works

1. **Customer gets our OBD-II device** (you promote it, we fulfill)
2. **Device streams real-time data** (mileage, diagnostics, location)
3. **Smart notifications** reach your customer: "You've driven 4,800 miles since your last oil change. Schedule with ${shopName}?"
4. **One-tap scheduling** brings them back to you

### What You Get (FREE)

- **Dashboard** to view all your connected customers
- **Automated reminders** based on actual mileage (not arbitrary time intervals)
- **Customer retention** without manual outreach
- **Competitive advantage** against dealers

## Next Steps

1. Sign up for free beta access
2. We'll set you up in 15 minutes
3. Start promoting devices to your best customers
4. Watch retention improve

**Ready to stop losing customers to dealers?**

Contact: tyler@pistonlabs.com
`;
}

function generateInvestorContent(): string {
  return `## Executive Summary

Piston Labs is building the **connected vehicle ecosystem for independent automotive shops**.

### The Opportunity

- **$130B** automotive aftermarket industry
- **250,000+** independent repair shops in the U.S.
- **60%** customer loss rate (industry average)
- **Zero** existing solutions connect vehicle telemetry to independent shops

### Our Solution

Three components working together:
1. **OBD-II Telemetry Device** - Plugs into any vehicle, streams real-time data
2. **Cloud Platform** - AWS infrastructure processing data in real-time
3. **Shop Dashboard** - Free CRM where shops manage customer relationships

### Traction

- ✅ **3 devices** actively transmitting production data
- ✅ **<100ms** Lambda processing time
- ✅ **0%** error rate over 100+ events
- ✅ **Architecture** designed for 1,000+ devices

### The Team

- **Tyler Porras** - CEO, founded Era Automotive (80% retention rate)
- **Ryan Morris** - Technical Co-Founder, dashboard infrastructure
- **Eli** - Sales Engineering
- **Tom** - Hardware & IoT
- **Marisa** - Content & Communications

### The Ask

Seed funding to:
- Complete Phase 2 automation features
- Onboard 10 beta shops
- Launch paid tier (scheduling)

**This is Piston Labs. We're building the future of automotive service.**
`;
}

function generateTechnicalContent(): string {
  return `## Technical Architecture

### Infrastructure Stack

- **Devices:** Teltonika FMM00A OBD-II plug-in trackers
- **Connectivity:** Soracom LTE SIMs, Soracom Beam routing
- **Cloud:** AWS (IoT Core, Lambda, S3, TimescaleDB) + Supabase
- **Security:** X.509 certificates, IAM policies, encryption at rest/transit

### Data Flow

\`\`\`
Teltonika FMM00A → LTE → Soracom SIM → Soracom Beam → AWS IoT Core
                                                          ↓
                                                       Lambda (parse-teltonika-data)
                                                          ↓
                                    S3 (raw archive) ← → TimescaleDB (real-time) ← → Supabase (app)
\`\`\`

### Performance Metrics

- **Processing latency:** <100ms
- **Error rate:** 0%
- **Uptime:** 99.9%
- **Data elements:** 41 AVL parameters mapped

### Scalability

- **Current:** 3 devices, 0.05 messages/second
- **Tested:** 100 messages/second
- **Designed for:** 1,000+ devices, 1,000 messages/second
- **Cost per device:** ~$0.65/month (excluding cellular)

### Security

- X.509 certificate authentication per device
- TLS 1.2+ for all connections
- IAM policies with least privilege
- Encryption at rest (S3, databases)
- VPC isolation for sensitive resources
`;
}

function generatePitchContent(shopName: string, target: string): string {
  return `## The Problem

Independent auto shops lose **60% of customers** after their first visit.

Not because of poor service. Because they have no way to stay connected.

## The Solution

**Piston Labs** = Connected vehicle ecosystem for independent shops

### Three Components

1. **OBD-II Device** - Plugs into customer's vehicle
2. **Cloud Platform** - Processes real-time telemetry
3. **Shop Dashboard** - Free CRM for customer management

### The Magic: VIN-Based Linking

The Vehicle Identification Number connects:
- Consumer ↔ Vehicle ↔ Shop ↔ Service History

No complex integrations. It just works.

## Why Now

- Affordable professional-grade telemetry devices
- Cheap cellular connectivity (Soracom, etc.)
- Pennies-per-message cloud infrastructure
- Shops desperate for retention tools
- Dealers pushing connected car features

## Traction

- ✅ 3 devices transmitting production data
- ✅ <100ms processing, 0% errors
- ✅ Multi-database architecture operational
- ✅ Team assembled and executing

## The Ask

Partner with us to revolutionize automotive service.

**Contact:** tyler@pistonlabs.com
`;
}
