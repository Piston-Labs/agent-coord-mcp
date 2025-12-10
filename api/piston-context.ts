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
    description: 'Piston Labs technical architecture - automotive telemetry platform',
    topics: {
      devices: {
        summary: 'Otto - our OBD-II telemetry dongle sold to consumers for vehicle tracking',
        details: 'Piston Labs sells Otto, our branded OBD-II plug-in device (Teltonika FMM00A hardware), directly to consumers. Otto connects to vehicles and transmits real-time telemetry data including GPS location, speed, mileage, VIN, and battery voltage.',
        patterns: ['LTE connectivity via Soracom SIM', 'OBD-II port plug-and-play', 'Real-time telemetry streaming'],
        hardware: {
          productName: 'Otto',
          model: 'Teltonika FMM00A',
          connectivity: 'LTE via Soracom SIM',
          interface: 'OBD-II port',
          data: ['GPS location', 'Speed', 'Odometer/mileage', 'VIN', 'Battery voltage', 'Engine diagnostics']
        }
      },
      aws: {
        summary: 'AWS IoT pipeline: Soracom -> AWS IoT Core -> Lambda -> S3/TimescaleDB/Supabase',
        details: 'Serverless architecture on AWS. Soracom provides LTE SIM connectivity and routes data to AWS IoT Core. Lambda functions parse Teltonika protocol data and store in S3 (raw), TimescaleDB (time-series), and Supabase (app data).',
        patterns: ['Soracom Beam for IoT routing', 'AWS IoT Core for device connections', 'Lambda for data parsing', 'Multi-database architecture'],
        components: {
          soracom: 'LTE SIM infrastructure and IoT routing',
          iotCore: 'AWS IoT Core device connections',
          lambda: 'parse-teltonika-data function (Python 3.13)',
          s3: 'telemetry-raw-usw1 bucket for raw data archival',
          timescale: 'Time-series database for real-time telemetry queries',
          supabase: 'Application database for user accounts, vehicles, service history'
        }
      },
      lambda: {
        summary: 'Python Lambda function parses Otto device (Teltonika protocol) data',
        details: 'parse-teltonika-data Lambda function (Python 3.13) receives data from AWS IoT Core, parses Otto device data (Teltonika FMM00A protocol), extracts telemetry fields, and writes to S3/TimescaleDB/Supabase.',
        patterns: ['Teltonika codec parsing', 'Multi-destination writes', 'Error handling with DLQ'],
        function: {
          name: 'parse-teltonika-data',
          runtime: 'python3.13',
          triggers: ['AWS IoT Core rules engine'],
          outputs: ['S3', 'TimescaleDB', 'Supabase']
        }
      },
      databases: {
        summary: 'S3 for raw data, TimescaleDB for time-series, Supabase for app data',
        details: 'Three-tier storage: S3 archives all raw telemetry, TimescaleDB provides fast time-series queries for real-time dashboards, Supabase stores user accounts, vehicle profiles, and service history.',
        patterns: ['Raw archival in S3', 'Time-series in TimescaleDB', 'Relational in Supabase/PostgreSQL'],
        databases: {
          s3: 'Raw telemetry archival (telemetry-raw-usw1)',
          timescale: 'Real-time telemetry queries',
          supabase: 'User accounts, vehicles, service records',
          redis: 'Upstash Redis for caching and agent coordination'
        }
      },
      api: {
        summary: 'REST APIs for consumer web app and shop dashboard',
        details: 'Vercel serverless functions provide APIs for the consumer web app (vehicle tracking, service history) and B2B shop dashboard (customer management, marketing).',
        patterns: ['Serverless functions on Vercel', 'JWT authentication', 'Real-time WebSocket updates'],
        endpoints: ['Consumer web app API', 'Shop dashboard API', 'Agent coordination API']
      }
    }
  },
  product: {
    description: 'Piston Labs products - B2C telemetry devices and B2B shop dashboard',
    topics: {
      vision: {
        summary: 'Consumer vehicle telemetry + B2B shop dashboard for auto repair marketing',
        details: 'Piston Labs has two products: (1) Otto - our B2C telemetry dongle sold to consumers who plug it into their cars for vehicle tracking and service reminders, and (2) B2B dashboard sold to auto repair shops for customer marketing and light CRM.',
        products: {
          b2c: 'Otto device + consumer web app for vehicle tracking',
          b2b: 'Shop dashboard for customer management, marketing, and service coordination'
        }
      },
      consumerApp: {
        summary: 'Consumer web app for vehicle tracking, service history, and maintenance reminders',
        details: 'Consumers purchase Otto and use the companion web app to view real-time vehicle location, track mileage, receive oil change reminders, upload service documents, and request appointments.',
        features: ['Real-time GPS tracking', 'Mileage tracking', 'Service history', 'Oil change reminders', 'Document upload', 'Appointment requests']
      },
      shopDashboard: {
        summary: 'B2B dashboard for auto repair shops - marketing and light CRM',
        details: 'Auto repair shops subscribe to the dashboard to manage customer relationships, send marketing campaigns, view customer vehicle data, and coordinate service appointments.',
        features: ['Customer list/CRM', 'Vehicle service history', 'Marketing campaigns', 'Appointment management', 'PDF document handling'],
        repo: 'Gran Autismo (Ryan\'s repository - READ ONLY)'
      },
      roadmap: {
        summary: 'Beta sprint: IoT devices in cars (Tom) + Shop dashboards (Ryan)',
        priorities: ['Device connectivity and accuracy', 'Consumer app MVP', 'Shop dashboard beta', 'First beta shop onboarding']
      }
    }
  },
  sales: {
    description: 'Sales strategy for B2C device sales and B2B shop subscriptions',
    topics: {
      strategy: {
        summary: 'B2C: Sell Otto devices to consumers. B2B: Sell dashboard subscriptions to auto repair shops.',
        details: 'Two sales motions: (1) Sell Otto devices to consumers who want vehicle tracking and service reminders, (2) Sell dashboard subscriptions to auto repair shops who want to market to and manage customers.',
        icp: {
          b2c: 'Car owners who want vehicle tracking and maintenance reminders',
          b2b: 'Independent auto repair shops, tire shops, oil change franchises'
        }
      },
      pitch: {
        summary: 'B2C: Never miss an oil change. B2B: Turn one-time customers into regulars.',
        talkingPoints: {
          b2c: ['Real-time vehicle tracking', 'Automatic mileage-based reminders', 'Digital service history', 'Easy appointment booking'],
          b2b: ['See when customers need service', 'Automated marketing campaigns', 'Customer retention tools', 'Competitive advantage']
        }
      },
      objections: {
        summary: 'Common objections and responses',
        responses: {
          privacyConcerns: 'Data is encrypted and you control sharing. We never sell data.',
          dontNeedTracking: 'Even without tracking, the service reminders and digital records add value.',
          tooExpensive: 'One prevented breakdown pays for years of service.',
          alreadyHaveCRM: 'Our dashboard integrates vehicle telemetry - see when customers actually need service.'
        }
      },
      competitors: {
        summary: 'B2C: Bouncie, Automatic. B2B: ShopBoss, Mitchell, custom solutions.',
        positioning: 'Integrated B2C + B2B ecosystem - consumers get great tracking, shops get actionable customer insights.'
      }
    }
  },
  investor: {
    description: 'Investor relations and pitch materials',
    topics: {
      summary: {
        summary: 'Pre-seed automotive telemetry startup with B2C + B2B model',
        details: 'Piston Labs sells consumer telemetry devices and B2B shop dashboard. Early stage with beta customers.',
        highlights: ['Two-sided marketplace model', 'Hardware + software recurring revenue', 'Auto repair shop ICP']
      },
      pitch: {
        summary: 'Connecting car owners with their auto shops through vehicle telemetry',
        details: 'We sell devices to consumers who get vehicle tracking and service reminders. Shops pay for dashboard access to see when customers need service and market to them. Network effects as more consumers connect with shops.',
        model: ['B2C device sales', 'B2B SaaS subscriptions', 'Potential data/advertising revenue']
      },
      traction: {
        summary: 'Beta stage with test devices and pilot shops',
        metrics: {
          devices: '3 test devices deployed',
          shops: 'Beta shop onboarding in progress',
          stage: 'Pre-revenue, validating PMF'
        }
      }
    }
  },
  team: {
    description: 'Piston Labs team structure',
    topics: {
      structure: {
        summary: 'Small founding team: Tyler (CEO), Ryan (Technical Co-Founder), Tom (Hardware/IoT)',
        roles: {
          tyler: 'CEO - Strategy, sales, agent coordination infrastructure',
          ryan: 'Technical Co-Founder - Gran Autismo dashboard (React/Supabase)',
          tom: 'Hardware/IoT - Otto devices (Teltonika hardware), AWS IoT pipeline, telemetry accuracy'
        }
      },
      onboarding: {
        summary: 'New team member onboarding',
        week1: ['Accounts setup', 'Product demo', 'Architecture overview', 'Device hands-on'],
        week2: ['First contribution', 'Customer interview', 'Sales shadowing'],
        resources: ['Agent coordination hub', 'Context clusters', 'Teltonika documentation']
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
      },
      repositories: {
        summary: 'Connected repositories and access levels',
        repos: {
          'agent-coord-mcp': 'This repo - agent coordination infrastructure (read/write)',
          'teltonika-context-system': 'Context clusters and domain knowledge (read/write)',
          'gran-autismo': 'Ryan\'s shop dashboard - READ ONLY (do not write)'
        }
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
      // Cache built-in context for 5 minutes (reduces Redis calls)
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
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
