import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const PISTON_CONTEXT_KEY = 'agent-coord:piston-context';

/**
 * Piston Labs Context API
 *
 * Serves domain-specific knowledge for Piston Labs agents.
 * Clusters: technical, product, sales, investor, team, coordination
 *
 * GET /api/piston-context - List all clusters
 * GET /api/piston-context?cluster=technical - Get cluster overview
 * GET /api/piston-context?cluster=technical&topic=devices - Get specific topic
 * GET /api/piston-context?cluster=technical&depth=full - Get with file paths
 * POST /api/piston-context - Update context (admin)
 */

// Built-in Piston Labs context (can be overridden via Redis)
const PISTON_CONTEXT: Record<string, any> = {
  technical: {
    description: 'Piston Labs technical architecture and systems',
    topics: {
      devices: {
        summary: 'IoT device fleet management - ESP32/Arduino sensors, Raspberry Pi gateways',
        details: 'Piston manages fleets of IoT devices for industrial monitoring. Devices include temperature sensors, vibration monitors, and environmental sensors.',
        patterns: ['MQTT for device communication', 'OTA updates via S3', 'Device shadows for state sync'],
        files: ['src/devices/', 'firmware/', 'docs/device-specs.md']
      },
      aws: {
        summary: 'AWS infrastructure - Lambda, DynamoDB, IoT Core, S3, CloudWatch',
        details: 'Serverless architecture on AWS. IoT Core for device connections, Lambda for processing, DynamoDB for time-series data.',
        patterns: ['Event-driven Lambda functions', 'DynamoDB single-table design', 'IoT rules engine for routing'],
        files: ['infrastructure/', 'cdk/', 'docs/aws-architecture.md']
      },
      lambda: {
        summary: 'Serverless functions for data processing and API endpoints',
        details: 'Node.js Lambda functions handle device data ingestion, alerts, and API requests. Cold starts optimized with provisioned concurrency for critical paths.',
        patterns: ['Middleware pattern for auth', 'Batch processing for high-volume data', 'Dead letter queues for failures'],
        files: ['lambdas/', 'src/handlers/']
      },
      databases: {
        summary: 'DynamoDB for device data, PostgreSQL for business data, Redis for caching',
        details: 'Time-series device data in DynamoDB with TTL. Business entities in PostgreSQL. Redis for real-time dashboards and session state.',
        patterns: ['Single-table DynamoDB design', 'Connection pooling for RDS', 'Cache-aside pattern'],
        files: ['src/db/', 'migrations/', 'docs/data-model.md']
      },
      api: {
        summary: 'REST APIs for dashboard, mobile app, and third-party integrations',
        details: 'API Gateway + Lambda for REST endpoints. GraphQL for dashboard queries. Webhook system for customer integrations.',
        patterns: ['JWT authentication', 'Rate limiting per tenant', 'Versioned API paths'],
        files: ['src/api/', 'docs/api-reference.md']
      }
    }
  },
  product: {
    description: 'Piston Labs product vision, roadmap, and features',
    topics: {
      vision: {
        summary: 'Industrial IoT platform making equipment monitoring accessible to SMBs',
        details: 'Piston democratizes industrial monitoring. Enterprise-grade capabilities at SMB prices. Predictive maintenance preventing costly downtime.',
        keyPoints: ['10x cheaper than enterprise solutions', 'Setup in hours not months', 'No-code alert configuration']
      },
      roadmap: {
        summary: 'Q1: Mobile app, Q2: Predictive ML, Q3: Marketplace, Q4: Enterprise tier',
        details: 'Current focus on mobile app for field technicians. Predictive maintenance ML models in development. Partner marketplace for sensors and integrations.',
        priorities: ['Mobile app MVP', 'Anomaly detection v1', 'Slack/Teams integrations']
      },
      dashboard: {
        summary: 'Real-time monitoring dashboard with customizable widgets and alerts',
        details: 'React dashboard with real-time WebSocket updates. Drag-drop widget configuration. Multi-tenant with role-based access.',
        features: ['Live sensor graphs', 'Alert management', 'Device fleet map', 'Report generation'],
        files: ['dashboard/', 'src/components/']
      },
      alerts: {
        summary: 'Configurable alerting via SMS, email, Slack, PagerDuty',
        details: 'Threshold-based and anomaly-based alerts. Escalation policies. Alert fatigue prevention with smart grouping.',
        patterns: ['Alert deduplication', 'Maintenance windows', 'On-call schedules']
      }
    }
  },
  sales: {
    description: 'Sales strategy, pitch materials, and objection handling',
    topics: {
      strategy: {
        summary: 'Land-and-expand with SMB manufacturers, target 50-500 employee companies',
        details: 'Initial sale: 5-10 sensors for critical equipment. Expand to full facility. Upsell predictive maintenance.',
        icp: ['Manufacturing plants', 'Food processing', 'HVAC contractors', 'Property managers'],
        dealSize: '$500-5000/month recurring'
      },
      pitch: {
        summary: 'Stop equipment failures before they stop your business',
        details: 'Lead with cost of downtime. Show ROI calculator. Demo real-time alerts. Emphasize quick setup.',
        talkingPoints: [
          'Average downtime costs $10K/hour',
          'Piston customers see 40% reduction in unplanned downtime',
          'Setup in 2 hours, not 2 months',
          'No IT department required'
        ]
      },
      objections: {
        summary: 'Common objections and responses',
        responses: {
          tooExpensive: 'Calculate their downtime costs. One prevented failure pays for a year.',
          haveMaintenanceStaff: 'Piston helps them prioritize and catch issues they would miss.',
          securityConcerns: 'SOC2 compliant, data encrypted, on-prem option available.',
          alreadyHaveSCADA: 'Piston complements SCADA with predictive capabilities and mobile access.'
        }
      },
      competitors: {
        summary: 'Main competitors: Samsara (enterprise), Uptake (ML focus), custom solutions',
        positioning: 'Faster setup than Samsara, more affordable than Uptake, more capable than DIY'
      }
    }
  },
  investor: {
    description: 'Investor relations, metrics, and pitch materials',
    topics: {
      summary: {
        summary: 'Series A IoT startup, $2M ARR, 150 customers, 40% MoM growth',
        details: 'Founded 2022, raised $5M seed. Product-market fit achieved. Expanding sales team.',
        highlights: ['Net revenue retention: 130%', 'CAC payback: 8 months', 'Gross margin: 75%']
      },
      pitch: {
        summary: '$50B industrial IoT market, we are the SMB-focused disruptor',
        details: 'Enterprise solutions too complex/expensive for SMBs. Piston is Datadog for industrial equipment.',
        asks: ['Series A: $15M', 'Use of funds: Sales team, ML capabilities, enterprise features']
      },
      traction: {
        summary: 'Key metrics and growth trajectory',
        metrics: {
          arr: '$2M',
          customers: 150,
          nrr: '130%',
          growth: '40% MoM',
          churn: 'less than 2% monthly'
        }
      }
    }
  },
  team: {
    description: 'Team structure, roles, and onboarding',
    topics: {
      structure: {
        summary: '15 person team: 8 eng, 3 sales, 2 customer success, 2 founders',
        roles: {
          founders: ['CEO - Sales/Strategy', 'CTO - Product/Engineering'],
          engineering: ['2 backend', '2 frontend', '2 firmware', '1 ML', '1 DevOps'],
          sales: ['2 AEs', '1 SDR'],
          customerSuccess: ['2 CSMs']
        }
      },
      onboarding: {
        summary: 'New hire onboarding checklist and resources',
        week1: ['Accounts setup', 'Product demo', 'Codebase overview', 'Shadow customer calls'],
        week2: ['First PR', 'Meet all teams', 'Customer interview', 'Present learning'],
        resources: ['Notion wiki', 'Loom recordings', 'Slack channels']
      },
      culture: {
        summary: 'Fast-moving, customer-obsessed, technically excellent',
        values: ['Ship fast, learn faster', 'Customer problems over our assumptions', 'Ownership mentality', 'Transparent by default']
      }
    }
  },
  coordination: {
    description: 'Multi-agent coordination patterns for Piston Labs',
    topics: {
      claims: {
        summary: 'Always claim files/resources before editing to prevent conflicts',
        pattern: 'agent-status claim before edit, release after commit',
        tools: ['agent-status claim/release', 'resource lock/unlock']
      },
      handoffs: {
        summary: 'Use formal handoffs when transferring work between agents',
        pattern: 'Include full context, code snippets, next steps',
        tools: ['handoff create/claim/complete']
      },
      context: {
        summary: 'Use context-load for domain knowledge, repo-context for codebase knowledge',
        pattern: 'Load relevant clusters on startup, save discoveries to memory',
        tools: ['context-load', 'repo-context', 'memory']
      },
      checkpoints: {
        summary: 'Save checkpoints every 15 minutes and before major operations',
        pattern: 'checkpoint save with current task, decisions, blockers',
        tools: ['checkpoint save/restore']
      }
    }
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
    // GET: Retrieve context
    if (req.method === 'GET') {
      const { cluster, topic, depth = 'summary' } = req.query;

      // List all clusters
      if (!cluster) {
        const clusters = Object.entries(PISTON_CONTEXT).map(([name, data]) => ({
          name,
          description: data.description,
          topics: Object.keys(data.topics)
        }));
        return res.json({ clusters, count: clusters.length });
      }

      const clusterName = cluster as string;
      const clusterData = PISTON_CONTEXT[clusterName];

      if (!clusterData) {
        return res.status(404).json({
          error: 'Cluster not found: ' + clusterName,
          available: Object.keys(PISTON_CONTEXT)
        });
      }

      // Check Redis for overrides
      const override = await redis.hget(PISTON_CONTEXT_KEY, clusterName);
      const finalData = override
        ? (typeof override === 'string' ? JSON.parse(override) : override)
        : clusterData;

      // Get specific topic
      if (topic) {
        const topicName = topic as string;
        const topicData = finalData.topics[topicName];

        if (!topicData) {
          return res.status(404).json({
            error: 'Topic not found: ' + topicName,
            available: Object.keys(finalData.topics)
          });
        }

        return res.json({
          cluster: clusterName,
          topic: topicName,
          data: topicData,
          depth
        });
      }

      // Return full cluster
      if (depth === 'full') {
        return res.json({
          cluster: clusterName,
          description: finalData.description,
          topics: finalData.topics
        });
      }

      // Summary: just topic names and summaries
      const summaries: Record<string, string> = {};
      for (const [topicName, topicData] of Object.entries(finalData.topics)) {
        summaries[topicName] = (topicData as any).summary || 'No summary';
      }

      return res.json({
        cluster: clusterName,
        description: finalData.description,
        topics: summaries
      });
    }

    // POST: Update context (admin)
    if (req.method === 'POST') {
      let body: any;
      try {
        body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const { cluster, topics, description, adminKey } = body;

      // Simple admin key check (in production, use proper auth)
      if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'piston-admin') {
        return res.status(403).json({ error: 'Admin key required' });
      }

      if (!cluster) {
        return res.status(400).json({ error: 'cluster required' });
      }

      const contextData = {
        description: description || PISTON_CONTEXT[cluster]?.description || '',
        topics: topics || {}
      };

      await redis.hset(PISTON_CONTEXT_KEY, { [cluster]: JSON.stringify(contextData) });

      return res.json({ success: true, cluster, message: 'Context updated' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Piston context error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
