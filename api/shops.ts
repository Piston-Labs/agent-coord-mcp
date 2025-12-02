import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SHOPS_KEY = 'piston:crm:shops';
const ACTIVITIES_KEY = 'piston:crm:activities';

// ============================================================================
// HEALTH SCORE CALCULATION (Industry best practice)
// ============================================================================

interface ShopWithHealth extends Shop {
  healthScore?: number;
  healthLabel?: 'hot' | 'warm' | 'cold' | 'at-risk';
  daysSinceContact?: number;
  isOverdue?: boolean;
}

function calculateHealthScore(shop: Shop, activityCount: number): ShopWithHealth {
  const now = new Date();
  const lastContact = new Date(shop.lastContact);
  const daysSinceContact = Math.floor((now.getTime() - lastContact.getTime()) / (1000 * 60 * 60 * 24));

  let score = 100;

  // Recency penalty (up to -40 points)
  if (daysSinceContact > 30) score -= 40;
  else if (daysSinceContact > 14) score -= 25;
  else if (daysSinceContact > 7) score -= 10;

  // Activity bonus (up to +20 points)
  if (activityCount >= 5) score += 20;
  else if (activityCount >= 3) score += 10;
  else if (activityCount >= 1) score += 5;

  // Stage velocity bonus
  if (shop.stage === 'demo' || shop.stage === 'proposal') score += 10;
  if (shop.stage === 'customer') score += 20;
  if (shop.stage === 'churned') score -= 50;

  // Next action penalty
  const isOverdue = shop.nextActionDue ? new Date(shop.nextActionDue) < now : false;
  if (isOverdue) score -= 15;
  if (!shop.nextAction && shop.stage !== 'customer' && shop.stage !== 'churned') score -= 10;

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine label
  let healthLabel: 'hot' | 'warm' | 'cold' | 'at-risk';
  if (score >= 80) healthLabel = 'hot';
  else if (score >= 60) healthLabel = 'warm';
  else if (score >= 40) healthLabel = 'cold';
  else healthLabel = 'at-risk';

  return {
    ...shop,
    healthScore: score,
    healthLabel,
    daysSinceContact,
    isOverdue
  };
}

/**
 * CRM Shop/Prospect Tracking API for Piston Labs Sales
 *
 * Track shops through the sales pipeline
 *
 * GET /api/shops - List all shops
 * GET /api/shops?stage=prospect - Filter by stage
 * GET /api/shops?id=xxx - Get single shop
 * POST /api/shops - Add or update shop
 * DELETE /api/shops?id=xxx - Remove shop
 *
 * Activities:
 * GET /api/shops?activities=true&shopId=xxx - Get activities for a shop
 * POST /api/shops with activity=true - Add activity
 */

interface Shop {
  id: string;
  name: string;
  // Location
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  // Shop details
  bays?: number;
  technicians?: number;
  specialty?: string;
  monthlyVolume?: number;
  dealerCompetition?: string;
  // Primary contact
  contactName?: string;
  contactRole?: string;
  contactEmail?: string;
  contactPhone?: string;
  // Sales & pipeline
  leadSource?: string;
  assignedTo?: string;
  stage: 'prospect' | 'qualified' | 'demo' | 'proposal' | 'customer' | 'churned';
  // Next action tracking (NEW - industry best practice)
  nextAction?: string;
  nextActionDue?: string;
  lostReason?: string;
  // Subscription & devices
  subscriptionStatus?: 'trial' | 'active' | 'paused' | 'cancelled' | '';
  monthlyRate?: number;
  devicesNeeded?: number;
  devicesDeployed?: number;
  contractStart?: string;
  contractEnd?: string;
  // Financials
  estMonthlyValue?: number;
  lifetimeValue?: number;
  // Other
  notes?: string;
  createdAt: string;
  lastContact: string;
}

interface Activity {
  id: string;
  shopId: string;
  type: 'call' | 'email' | 'meeting' | 'demo' | 'note' | 'proposal';
  author: string;
  content: string;
  timestamp: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List shops or activities
    if (req.method === 'GET') {
      const { stage, assignedTo, id, activities, shopId, analytics } = req.query;

      // Conversion funnel analytics (NEW - industry best practice)
      if (analytics === 'funnel') {
        const shopsRaw = await redis.hgetall(SHOPS_KEY) || {};
        const shops: Shop[] = Object.values(shopsRaw).map((s: unknown) =>
          typeof s === 'string' ? JSON.parse(s) : s
        ) as Shop[];

        const stageOrder = ['prospect', 'qualified', 'demo', 'proposal', 'customer'];
        const funnel = stageOrder.map(stageName => {
          const inStage = shops.filter(s => s.stage === stageName);
          const churned = shops.filter(s => s.stage === 'churned' && s.lostReason);
          return {
            stage: stageName,
            count: inStage.length,
            value: inStage.reduce((sum, s) => sum + (s.estMonthlyValue || 0), 0)
          };
        });

        // Calculate conversion rates between stages
        const conversions = [];
        for (let i = 0; i < stageOrder.length - 1; i++) {
          const from = funnel[i];
          const to = funnel[i + 1];
          const totalAfter = funnel.slice(i + 1).reduce((sum, f) => sum + f.count, 0);
          conversions.push({
            from: from.stage,
            to: to.stage,
            rate: from.count > 0 ? Math.round((totalAfter / from.count) * 100) : 0
          });
        }

        // Win/loss analysis
        const customers = shops.filter(s => s.stage === 'customer');
        const churned = shops.filter(s => s.stage === 'churned');
        const winRate = shops.length > 0 ? Math.round((customers.length / shops.length) * 100) : 0;

        // Average deal cycle (from createdAt to becoming customer)
        const dealCycles = customers.map(s => {
          const created = new Date(s.createdAt);
          const lastContact = new Date(s.lastContact);
          return Math.floor((lastContact.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        });
        const avgDealCycle = dealCycles.length > 0 ? Math.round(dealCycles.reduce((a, b) => a + b, 0) / dealCycles.length) : 0;

        // Lost reasons breakdown
        const lostReasons: Record<string, number> = {};
        churned.forEach(s => {
          const reason = s.lostReason || 'Not specified';
          lostReasons[reason] = (lostReasons[reason] || 0) + 1;
        });

        return res.json({
          funnel,
          conversions,
          summary: {
            totalProspects: shops.length,
            totalCustomers: customers.length,
            totalChurned: churned.length,
            winRate,
            avgDealCycle,
            pipelineValue: shops.filter(s => s.stage !== 'customer' && s.stage !== 'churned').reduce((sum, s) => sum + (s.estMonthlyValue || 0), 0),
            customerValue: customers.reduce((sum, s) => sum + (s.estMonthlyValue || 0), 0)
          },
          lostReasons
        });
      }

      // Get activities for a shop
      if (activities === 'true') {
        const activitiesRaw = await redis.hgetall(ACTIVITIES_KEY) || {};
        let allActivities: Activity[] = Object.values(activitiesRaw).map((a: unknown) =>
          typeof a === 'string' ? JSON.parse(a) : a
        ) as Activity[];

        // Filter by shopId if provided
        if (shopId) {
          allActivities = allActivities.filter(a => a.shopId === shopId);
        }

        // Sort by timestamp descending
        allActivities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        return res.json({ activities: allActivities });
      }

      // Get single shop by ID
      if (id) {
        const shopRaw = await redis.hget(SHOPS_KEY, String(id));
        if (!shopRaw) {
          return res.status(404).json({ error: 'Shop not found' });
        }
        const shop = typeof shopRaw === 'string' ? JSON.parse(shopRaw) : shopRaw;

        // Get activity count for health score
        const activitiesRaw = await redis.hgetall(ACTIVITIES_KEY) || {};
        const allActivities: Activity[] = Object.values(activitiesRaw).map((a: unknown) =>
          typeof a === 'string' ? JSON.parse(a) : a
        ) as Activity[];
        const activityCount = allActivities.filter(a => a.shopId === shop.id).length;

        const shopWithHealth = calculateHealthScore(shop, activityCount);
        return res.json({ shop: shopWithHealth });
      }

      // Get all shops
      const shopsRaw = await redis.hgetall(SHOPS_KEY) || {};
      let shops: Shop[] = Object.values(shopsRaw).map((s: unknown) =>
        typeof s === 'string' ? JSON.parse(s) : s
      ) as Shop[];

      // Get all activities for health calculation
      const activitiesRaw = await redis.hgetall(ACTIVITIES_KEY) || {};
      const allActivities: Activity[] = Object.values(activitiesRaw).map((a: unknown) =>
        typeof a === 'string' ? JSON.parse(a) : a
      ) as Activity[];

      // Calculate health scores
      const shopsWithHealth: ShopWithHealth[] = shops.map(shop => {
        const activityCount = allActivities.filter(a => a.shopId === shop.id).length;
        return calculateHealthScore(shop, activityCount);
      });

      // Apply filters
      let filteredShops = shopsWithHealth;
      if (stage) {
        filteredShops = filteredShops.filter(s => s.stage === stage);
      }
      if (assignedTo) {
        filteredShops = filteredShops.filter(s => s.assignedTo === assignedTo);
      }

      // Sort by last contact descending (or by health score if requested)
      const { sortBy } = req.query;
      if (sortBy === 'health') {
        filteredShops.sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
      } else if (sortBy === 'overdue') {
        filteredShops.sort((a, b) => {
          if (a.isOverdue && !b.isOverdue) return -1;
          if (!a.isOverdue && b.isOverdue) return 1;
          return (b.daysSinceContact || 0) - (a.daysSinceContact || 0);
        });
      } else {
        filteredShops.sort((a, b) => new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime());
      }

      // Enhanced pipeline stats with health breakdown
      const stats = {
        total: shopsWithHealth.length,
        byStage: {
          prospect: shopsWithHealth.filter(s => s.stage === 'prospect').length,
          qualified: shopsWithHealth.filter(s => s.stage === 'qualified').length,
          demo: shopsWithHealth.filter(s => s.stage === 'demo').length,
          proposal: shopsWithHealth.filter(s => s.stage === 'proposal').length,
          customer: shopsWithHealth.filter(s => s.stage === 'customer').length,
          churned: shopsWithHealth.filter(s => s.stage === 'churned').length
        },
        byHealth: {
          hot: shopsWithHealth.filter(s => s.healthLabel === 'hot').length,
          warm: shopsWithHealth.filter(s => s.healthLabel === 'warm').length,
          cold: shopsWithHealth.filter(s => s.healthLabel === 'cold').length,
          atRisk: shopsWithHealth.filter(s => s.healthLabel === 'at-risk').length
        },
        overdueActions: shopsWithHealth.filter(s => s.isOverdue).length,
        needsAttention: shopsWithHealth.filter(s => (s.daysSinceContact || 0) > 7 && s.stage !== 'customer' && s.stage !== 'churned').length,
        totalDevices: shopsWithHealth.reduce((sum, s) => sum + (s.devicesNeeded || 0), 0),
        totalMonthlyValue: shopsWithHealth.filter(s => s.stage === 'customer').reduce((sum, s) => sum + (s.estMonthlyValue || 0), 0),
        avgHealthScore: Math.round(shopsWithHealth.reduce((sum, s) => sum + (s.healthScore || 0), 0) / (shopsWithHealth.length || 1))
      };

      return res.json({ shops: filteredShops, stats });
    }

    // POST: Add or update shop, or add activity, or seed data
    if (req.method === 'POST') {
      const body = req.body || {};

      // Seed ERA Automotive as first customer
      if (body.seed === 'era-automotive') {
        const eraShop: Shop = {
          id: 'shop-era-automotive',
          name: 'ERA Automotive',
          address: '3537 2nd Avenue',
          city: 'Sacramento',
          state: 'CA',
          zip: '95817',
          bays: 4,
          technicians: 2,
          specialty: 'european',
          monthlyVolume: 80,
          dealerCompetition: 'medium',
          contactName: 'Tyler',
          contactRole: 'Owner',
          contactEmail: 'tyler@eraautosac.com',
          contactPhone: '(916) 234-5330',
          leadSource: 'founder',
          assignedTo: 'tyler',
          estMonthlyValue: 299,
          devicesNeeded: 4,
          stage: 'customer',
          notes: 'Founder\'s shop. Opened October 2024. Specializes in BMW and European vehicles but services all makes. Located in Oak Park, Sacramento. 5-star rating on CARFAX with excellent customer reviews.',
          createdAt: '2024-10-01T10:00:00Z',
          lastContact: new Date().toISOString()
        };

        await redis.hset(SHOPS_KEY, { [eraShop.id]: JSON.stringify(eraShop) });

        // Add initial activities
        const activities: Activity[] = [
          {
            id: 'act-era-001',
            shopId: 'shop-era-automotive',
            type: 'note',
            author: 'tyler',
            content: 'ERA Automotive launched as Piston Labs\' first customer and pilot location. Full integration with Piston device ecosystem.',
            timestamp: '2024-10-01T10:00:00Z'
          },
          {
            id: 'act-era-002',
            shopId: 'shop-era-automotive',
            type: 'note',
            author: 'tyler',
            content: 'Shop fully operational. Collecting real-world usage data for product development.',
            timestamp: '2024-11-15T14:00:00Z'
          }
        ];

        for (const act of activities) {
          await redis.hset(ACTIVITIES_KEY, { [act.id]: JSON.stringify(act) });
        }

        return res.json({ success: true, message: 'ERA Automotive seeded', shop: eraShop, activities });
      }

      // Add activity
      if (body.activity === true) {
        const { shopId, type, author, content } = body;
        if (!shopId || !type || !content) {
          return res.status(400).json({ error: 'shopId, type, and content required for activity' });
        }

        const activity: Activity = {
          id: `act-${Date.now()}`,
          shopId,
          type,
          author: author || 'system',
          content,
          timestamp: new Date().toISOString()
        };

        await redis.hset(ACTIVITIES_KEY, { [activity.id]: JSON.stringify(activity) });

        // Update shop's lastContact
        const shopRaw = await redis.hget(SHOPS_KEY, shopId);
        if (shopRaw) {
          const shop = typeof shopRaw === 'string' ? JSON.parse(shopRaw) : shopRaw;
          shop.lastContact = new Date().toISOString();
          await redis.hset(SHOPS_KEY, { [shopId]: JSON.stringify(shop) });
        }

        return res.json({ success: true, activity });
      }

      // Add or update shop
      const {
        id,
        name,
        address,
        city,
        state,
        zip,
        bays,
        technicians,
        specialty,
        monthlyVolume,
        dealerCompetition,
        contactName,
        contactRole,
        contactEmail,
        contactPhone,
        leadSource,
        assignedTo,
        stage = 'prospect',
        // Next action tracking
        nextAction,
        nextActionDue,
        lostReason,
        // New subscription fields
        subscriptionStatus,
        monthlyRate,
        devicesNeeded,
        devicesDeployed,
        contractStart,
        contractEnd,
        // Financials
        estMonthlyValue,
        lifetimeValue,
        notes
      } = body;

      if (!name && !id) {
        return res.status(400).json({ error: 'name or id required' });
      }

      // Generate ID from name if not provided
      const shopId = id || `shop-${Date.now()}`;

      // Check if shop exists
      const existingRaw = await redis.hget(SHOPS_KEY, shopId);
      let shop: Shop;
      const now = new Date().toISOString();

      if (existingRaw) {
        // Update existing shop
        shop = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
        if (name !== undefined) shop.name = name;
        if (address !== undefined) shop.address = address;
        if (city !== undefined) shop.city = city;
        if (state !== undefined) shop.state = state;
        if (zip !== undefined) shop.zip = zip;
        if (bays !== undefined) shop.bays = bays;
        if (technicians !== undefined) shop.technicians = technicians;
        if (specialty !== undefined) shop.specialty = specialty;
        if (monthlyVolume !== undefined) shop.monthlyVolume = monthlyVolume;
        if (dealerCompetition !== undefined) shop.dealerCompetition = dealerCompetition;
        if (contactName !== undefined) shop.contactName = contactName;
        if (contactRole !== undefined) shop.contactRole = contactRole;
        if (contactEmail !== undefined) shop.contactEmail = contactEmail;
        if (contactPhone !== undefined) shop.contactPhone = contactPhone;
        if (leadSource !== undefined) shop.leadSource = leadSource;
        if (assignedTo !== undefined) shop.assignedTo = assignedTo;
        if (stage !== undefined) shop.stage = stage as Shop['stage'];
        // Next action tracking
        if (nextAction !== undefined) shop.nextAction = nextAction;
        if (nextActionDue !== undefined) shop.nextActionDue = nextActionDue;
        if (lostReason !== undefined) shop.lostReason = lostReason;
        // Subscription fields
        if (subscriptionStatus !== undefined) shop.subscriptionStatus = subscriptionStatus;
        if (monthlyRate !== undefined) shop.monthlyRate = monthlyRate;
        if (devicesNeeded !== undefined) shop.devicesNeeded = devicesNeeded;
        if (devicesDeployed !== undefined) shop.devicesDeployed = devicesDeployed;
        if (contractStart !== undefined) shop.contractStart = contractStart;
        if (contractEnd !== undefined) shop.contractEnd = contractEnd;
        // Financials
        if (estMonthlyValue !== undefined) shop.estMonthlyValue = estMonthlyValue;
        if (lifetimeValue !== undefined) shop.lifetimeValue = lifetimeValue;
        if (notes !== undefined) shop.notes = notes;
        shop.lastContact = now;
      } else {
        // Create new shop
        shop = {
          id: shopId,
          name,
          address,
          city,
          state,
          zip,
          bays,
          technicians,
          specialty: specialty || 'general',
          monthlyVolume,
          dealerCompetition,
          contactName,
          contactRole,
          contactEmail,
          contactPhone,
          leadSource,
          assignedTo,
          stage: (stage as Shop['stage']) || 'prospect',
          // Next action tracking
          nextAction,
          nextActionDue,
          lostReason,
          // Subscription fields
          subscriptionStatus: subscriptionStatus || '',
          monthlyRate: monthlyRate || 0,
          devicesNeeded: devicesNeeded || 0,
          devicesDeployed: devicesDeployed || 0,
          contractStart,
          contractEnd,
          // Financials
          estMonthlyValue: estMonthlyValue || 0,
          lifetimeValue: lifetimeValue || 0,
          notes,
          createdAt: now,
          lastContact: now
        };
      }

      await redis.hset(SHOPS_KEY, { [shopId]: JSON.stringify(shop) });

      return res.json({
        success: true,
        shop,
        action: existingRaw ? 'updated' : 'created'
      });
    }

    // DELETE: Remove shop or activity
    if (req.method === 'DELETE') {
      const { id, activityId } = req.query;

      if (activityId) {
        await redis.hdel(ACTIVITIES_KEY, String(activityId));
        return res.json({ success: true, removed: activityId, type: 'activity' });
      }

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      // Delete shop and its activities
      await redis.hdel(SHOPS_KEY, String(id));

      // Also delete all activities for this shop
      const activitiesRaw = await redis.hgetall(ACTIVITIES_KEY) || {};
      const activities: Activity[] = Object.values(activitiesRaw).map((a: unknown) =>
        typeof a === 'string' ? JSON.parse(a) : a
      ) as Activity[];
      const shopActivities = activities.filter(a => a.shopId === id);
      for (const act of shopActivities) {
        await redis.hdel(ACTIVITIES_KEY, act.id);
      }

      return res.json({ success: true, removed: id, activitiesRemoved: shopActivities.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Shops API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
