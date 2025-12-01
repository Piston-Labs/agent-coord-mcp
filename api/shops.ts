import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SHOPS_KEY = 'piston:crm:shops';
const ACTIVITIES_KEY = 'piston:crm:activities';

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
      const { stage, assignedTo, id, activities, shopId } = req.query;

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
        return res.json({ shop });
      }

      // Get all shops
      const shopsRaw = await redis.hgetall(SHOPS_KEY) || {};
      let shops: Shop[] = Object.values(shopsRaw).map((s: unknown) =>
        typeof s === 'string' ? JSON.parse(s) : s
      ) as Shop[];

      // Apply filters
      if (stage) {
        shops = shops.filter(s => s.stage === stage);
      }
      if (assignedTo) {
        shops = shops.filter(s => s.assignedTo === assignedTo);
      }

      // Sort by last contact descending
      shops.sort((a, b) => new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime());

      // Calculate pipeline stats
      const stats = {
        total: shops.length,
        byStage: {
          prospect: shops.filter(s => s.stage === 'prospect').length,
          qualified: shops.filter(s => s.stage === 'qualified').length,
          demo: shops.filter(s => s.stage === 'demo').length,
          proposal: shops.filter(s => s.stage === 'proposal').length,
          customer: shops.filter(s => s.stage === 'customer').length,
          churned: shops.filter(s => s.stage === 'churned').length
        },
        totalDevices: shops.reduce((sum, s) => sum + (s.devicesNeeded || 0), 0),
        totalMonthlyValue: shops.filter(s => s.stage === 'customer').reduce((sum, s) => sum + (s.estMonthlyValue || 0), 0)
      };

      return res.json({ shops, stats });
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
