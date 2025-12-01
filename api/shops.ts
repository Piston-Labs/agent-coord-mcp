import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SHOPS_KEY = 'piston:shops';

/**
 * Shop/Prospect Tracking API for Piston Labs Sales
 * 
 * Track beta shops, prospects, and sales pipeline
 * 
 * GET /api/shops - List all shops
 * GET /api/shops?status=prospect - Filter by status
 * POST /api/shops - Add or update shop
 * DELETE /api/shops?id=xxx - Remove shop
 */

interface Shop {
  id: string;
  name: string;
  status: 'prospect' | 'contacted' | 'demo-scheduled' | 'beta-active' | 'churned';
  owner?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes: string[];
  tags: string[];
  assignedTo?: string;  // Sales rep
  source?: string;      // How we found them
  lastContact?: string;
  nextFollowUp?: string;
  devicesDeployed?: number;
  createdAt: string;
  updatedAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List shops
    if (req.method === 'GET') {
      const { status, assignedTo, tag, id } = req.query;

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
      if (status) {
        shops = shops.filter(s => s.status === status);
      }
      if (assignedTo) {
        shops = shops.filter(s => s.assignedTo === assignedTo);
      }
      if (tag) {
        shops = shops.filter(s => s.tags.includes(String(tag)));
      }

      // Sort by status priority and last contact
      const statusOrder = { 
        'demo-scheduled': 0, 
        'contacted': 1, 
        'prospect': 2, 
        'beta-active': 3, 
        'churned': 4 
      };
      shops.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      // Calculate pipeline stats
      const stats = {
        total: shops.length,
        byStatus: {
          prospect: shops.filter(s => s.status === 'prospect').length,
          contacted: shops.filter(s => s.status === 'contacted').length,
          demoScheduled: shops.filter(s => s.status === 'demo-scheduled').length,
          betaActive: shops.filter(s => s.status === 'beta-active').length,
          churned: shops.filter(s => s.status === 'churned').length
        },
        devicesDeployed: shops.reduce((sum, s) => sum + (s.devicesDeployed || 0), 0),
        needsFollowUp: shops.filter(s => {
          if (!s.nextFollowUp) return false;
          return new Date(s.nextFollowUp) <= new Date();
        }).length
      };

      return res.json({ shops, stats });
    }

    // POST: Add or update shop
    if (req.method === 'POST') {
      const body = req.body || {};
      const { 
        id, 
        name, 
        status = 'prospect',
        owner,
        phone,
        email,
        address,
        note,  // Single note to add
        tags = [],
        assignedTo,
        source,
        nextFollowUp,
        devicesDeployed
      } = body;

      if (!name && !id) {
        return res.status(400).json({ error: 'name or id required' });
      }

      // Generate ID from name if not provided
      const shopId = id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      // Check if shop exists
      const existingRaw = await redis.hget(SHOPS_KEY, shopId);
      let shop: Shop;

      if (existingRaw) {
        // Update existing
        shop = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
        if (name) shop.name = name;
        if (status) shop.status = status as Shop['status'];
        if (owner) shop.owner = owner;
        if (phone) shop.phone = phone;
        if (email) shop.email = email;
        if (address) shop.address = address;
        if (note) shop.notes.push(`[${new Date().toISOString()}] ${note}`);
        if (tags.length) shop.tags = [...new Set([...shop.tags, ...tags])];
        if (assignedTo) shop.assignedTo = assignedTo;
        if (source) shop.source = source;
        if (nextFollowUp) shop.nextFollowUp = nextFollowUp;
        if (devicesDeployed !== undefined) shop.devicesDeployed = devicesDeployed;
        shop.lastContact = new Date().toISOString();
        shop.updatedAt = new Date().toISOString();
      } else {
        // Create new
        shop = {
          id: shopId,
          name,
          status: status as Shop['status'],
          owner,
          phone,
          email,
          address,
          notes: note ? [`[${new Date().toISOString()}] ${note}`] : [],
          tags: tags || [],
          assignedTo,
          source,
          nextFollowUp,
          devicesDeployed: devicesDeployed || 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      await redis.hset(SHOPS_KEY, { [shopId]: JSON.stringify(shop) });

      return res.json({ 
        success: true, 
        shop,
        action: existingRaw ? 'updated' : 'created'
      });
    }

    // DELETE: Remove shop
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      await redis.hdel(SHOPS_KEY, String(id));
      return res.json({ success: true, removed: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Shops API error:', error);
    return res.status(500).json({ error: String(error) });
  }
}
