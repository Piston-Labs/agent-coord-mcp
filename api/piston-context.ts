import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Piston Labs Context API
 * 
 * Provides hierarchical context loading for the telemetry platform.
 * Mirrors the teltonika-context-system structure.
 * 
 * GET /api/piston-context?cluster=technical&topic=devices&depth=summary
 */

// Context cluster definitions - maps to teltonika-context-system/docs/context/
const CONTEXT_CLUSTERS = {
  technical: {
    description: 'Technical infrastructure and architecture',
    topics: {
      devices: {
        summary: 'Teltonika OBD-II device fleet: 3 active (Test, Toyota, Lexus). FMB920/FMM00A models.',
        files: ['docs/context/technical/devices.md']
      },
      aws: {
        summary: 'AWS infrastructure: IoT Core, Lambda, S3, Timescale, Redshift. <100ms processing, 0% errors.',
        files: ['docs/context/technical/aws_infrastructure.md', 'docs/AWS_RESOURCES.md']
      },
      lambda: {
        summary: 'Lambda function parses Teltonika Codec 8E data, routes to multiple databases.',
        files: ['docs/context/technical/lambda.md', 'lambda/lambda_function_COMPREHENSIVE.py']
      },
      databases: {
        summary: 'Multi-database architecture: S3 (archive), Timescale (real-time), Redshift (analytics), Supabase (app).',
        files: ['docs/context/technical/databases.md']
      },
      dataflow: {
        summary: 'Device → MQTT → IoT Core → Lambda → S3/Timescale/Redshift. 41 AVL elements mapped.',
        files: ['docs/context/technical/data_flow.md']
      }
    }
  },
  product: {
    description: 'Product vision, roadmap, and features',
    topics: {
      vision: {
        summary: 'Connected vehicle ecosystem for independent auto shops. VIN-based data model links consumers, vehicles, shops.',
        files: ['docs/context/company/product_vision.md', 'docs/COMPANY_SUMMARY.md']
      },
      roadmap: {
        summary: 'Phase 1 (MVP) complete. Phase 2: Core Automation. Phase 3: Paid Tier. Phase 4: Promotion Engine.',
        files: ['docs/context/company/technical_roadmap.md']
      },
      dashboard: {
        summary: 'Gran-autismo: Shop, Consumer, and Internal dashboards. Next.js + Supabase + Tailwind.',
        files: ['dashboard-integration/README.md', 'docs/GRAN_AUTISMO_INTEGRATION.md']
      }
    }
  },
  sales: {
    description: 'Sales strategy, pitches, and customer materials',
    topics: {
      strategy: {
        summary: 'Phase 1: Local Beta (5-10 shops). Free tier drives device adoption. Paid tier: scheduling.',
        files: ['docs/context/company/sales_strategy.md']
      },
      pitch: {
        summary: '60% customer loss problem. Free dashboard + device = retention solution. VIN links everything.',
        files: ['docs/FOR_SHOPS.md', 'docs/EXECUTIVE_SUMMARY.md']
      },
      objections: {
        summary: 'Top objections: customer adoption, cost, time, tech complexity. All have rebuttals.',
        files: ['docs/OBJECTION_HANDLING_PLAYBOOK.md']
      }
    }
  },
  investor: {
    description: 'Investor materials and financial information',
    topics: {
      summary: {
        summary: '$130B automotive aftermarket. 250K+ independent shops. Zero connected vehicle solutions for them.',
        files: ['docs/FOR_INVESTORS.md', 'docs/EXECUTIVE_SUMMARY.md']
      },
      pitch: {
        summary: '17-slide deck: Problem, Solution, Market, Product, Team, Ask.',
        files: ['docs/PITCH_DECK_OUTLINE.md']
      },
      traction: {
        summary: '3 devices active, <100ms Lambda, 0% errors. Infrastructure proven. Seeking beta shops.',
        files: ['docs/COMPANY_SUMMARY.md']
      }
    }
  },
  team: {
    description: 'Team structure and onboarding',
    topics: {
      structure: {
        summary: 'Tyler (CEO), Ryan (Tech Co-Founder), Eli (Sales Eng), Tom (Hardware/IoT), Marisa (Content).',
        files: ['docs/COMPANY_SUMMARY.md']
      },
      onboarding: {
        summary: 'Sales engineer onboarding: 6 phases, 2-4 hours. Validated with Eli (A+ grade, 102 commits).',
        files: ['docs/ONBOARDING_GUIDE_SALES_ENGINEER.md', 'docs/SALES_ENGINEER_CHECKLIST.md']
      }
    }
  }
};

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

  const { cluster, topic, depth = 'summary' } = req.query;

  // List all clusters
  if (!cluster) {
    const clusters = Object.entries(CONTEXT_CLUSTERS).map(([name, data]) => ({
      name,
      description: data.description,
      topics: Object.keys(data.topics)
    }));
    return res.json({ 
      clusters,
      usage: 'GET /api/piston-context?cluster=technical&topic=devices&depth=summary|full'
    });
  }

  const clusterName = String(cluster).toLowerCase();
  const clusterData = CONTEXT_CLUSTERS[clusterName as keyof typeof CONTEXT_CLUSTERS];

  if (!clusterData) {
    return res.status(404).json({ 
      error: `Cluster '${cluster}' not found`,
      available: Object.keys(CONTEXT_CLUSTERS)
    });
  }

  // List topics in cluster
  if (!topic) {
    const topics = Object.entries(clusterData.topics).map(([name, data]) => ({
      name,
      summary: data.summary,
      files: data.files
    }));
    return res.json({
      cluster: clusterName,
      description: clusterData.description,
      topics
    });
  }

  const topicName = String(topic).toLowerCase();
  const topicData = clusterData.topics[topicName as keyof typeof clusterData.topics];

  if (!topicData) {
    return res.status(404).json({
      error: `Topic '${topic}' not found in cluster '${cluster}'`,
      available: Object.keys(clusterData.topics)
    });
  }

  // Return context
  const response: any = {
    cluster: clusterName,
    topic: topicName,
    depth,
    summary: topicData.summary,
    files: topicData.files
  };

  // If full depth requested, include file paths for the caller to load
  if (depth === 'full') {
    response.note = 'Full context requires loading files from teltonika-context-system repo';
    response.basePath = 'C:\\Users\\tyler\\Desktop\\teltonika-context-system';
    response.instructions = 'Use Desktop Commander to read these files for full context';
  }

  return res.json(response);
}
