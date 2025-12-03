import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const GEOFENCES_KEY = 'piston:geofences';
const GEOFENCE_BREACHES_KEY = 'piston:geofence-breaches';
const DEVICE_LOCATIONS_KEY = 'piston:device-locations';

/**
 * Geofence - A circular or polygon area that triggers alerts when devices enter/exit
 */
interface Geofence {
  id: string;
  name: string;
  description?: string;
  type: 'circle' | 'polygon';
  // For circle geofences
  center?: { lat: number; lng: number };
  radiusMeters?: number;
  // For polygon geofences
  vertices?: { lat: number; lng: number }[];
  // Configuration
  triggerOn: 'enter' | 'exit' | 'both';
  enabled: boolean;
  // Optional: restrict to specific devices
  deviceImeis?: string[];
  // Metadata
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/**
 * GeofenceBreach - Records when a device enters/exits a geofence
 */
interface GeofenceBreach {
  id: string;
  geofenceId: string;
  geofenceName: string;
  imei: string;
  deviceName: string;
  breachType: 'enter' | 'exit';
  location: { lat: number; lng: number };
  timestamp: string;
  acknowledged: boolean;
}

/**
 * Haversine formula to calculate distance between two points in meters
 */
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Point-in-polygon algorithm (ray casting)
 */
function pointInPolygon(
  lat: number, lng: number,
  vertices: { lat: number; lng: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng, yi = vertices[i].lat;
    const xj = vertices[j].lng, yj = vertices[j].lat;

    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Check if a device is inside a geofence
 */
function isInsideGeofence(
  lat: number, lng: number,
  geofence: Geofence
): boolean {
  if (geofence.type === 'circle' && geofence.center && geofence.radiusMeters) {
    const distance = haversineDistance(
      lat, lng,
      geofence.center.lat, geofence.center.lng
    );
    return distance <= geofence.radiusMeters;
  } else if (geofence.type === 'polygon' && geofence.vertices) {
    return pointInPolygon(lat, lng, geofence.vertices);
  }
  return false;
}

/**
 * Geofence API
 *
 * GET /api/geofence - List all geofences
 * GET /api/geofence?id=xxx - Get specific geofence
 * GET /api/geofence?breaches=true - Get recent breaches
 * POST /api/geofence - Create geofence
 * PATCH /api/geofence - Update geofence
 * DELETE /api/geofence?id=xxx - Delete geofence
 * POST /api/geofence?check=true - Check device against geofences (for telemetry pipeline)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // =========================================================================
    // GET: List geofences or get breaches
    // =========================================================================
    if (req.method === 'GET') {
      const { id, breaches, limit = '50' } = req.query;

      // Get recent breaches
      if (breaches === 'true') {
        const breachList = await redis.lrange(GEOFENCE_BREACHES_KEY, 0, parseInt(limit as string) - 1) || [];
        const parsed = breachList.map(b => typeof b === 'string' ? JSON.parse(b) : b);

        return res.json({
          breaches: parsed,
          count: parsed.length,
          unacknowledged: parsed.filter((b: GeofenceBreach) => !b.acknowledged).length
        });
      }

      // Get specific geofence
      if (id && typeof id === 'string') {
        const geofence = await redis.hget(GEOFENCES_KEY, id);
        if (!geofence) {
          return res.status(404).json({ error: 'Geofence not found' });
        }
        return res.json({ geofence: typeof geofence === 'string' ? JSON.parse(geofence) : geofence });
      }

      // List all geofences
      const all = await redis.hgetall(GEOFENCES_KEY) || {};
      const geofences: Geofence[] = Object.values(all).map(g =>
        typeof g === 'string' ? JSON.parse(g) : g
      );

      return res.json({
        geofences,
        count: geofences.length,
        enabled: geofences.filter(g => g.enabled).length
      });
    }

    // =========================================================================
    // POST: Create geofence or check device location
    // =========================================================================
    if (req.method === 'POST') {
      const { check } = req.query;

      // Check device location against all geofences
      if (check === 'true') {
        const { imei, deviceName, lat, lng } = req.body;

        if (!imei || lat === undefined || lng === undefined) {
          return res.status(400).json({ error: 'imei, lat, lng required' });
        }

        // Get previous location
        const prevLocationRaw = await redis.hget(DEVICE_LOCATIONS_KEY, imei);
        const prevLocation = prevLocationRaw
          ? (typeof prevLocationRaw === 'string' ? JSON.parse(prevLocationRaw) : prevLocationRaw)
          : null;

        // Store current location
        await redis.hset(DEVICE_LOCATIONS_KEY, {
          [imei]: JSON.stringify({ lat, lng, timestamp: new Date().toISOString() })
        });

        // Get all enabled geofences
        const all = await redis.hgetall(GEOFENCES_KEY) || {};
        const geofences: Geofence[] = Object.values(all)
          .map(g => typeof g === 'string' ? JSON.parse(g) : g)
          .filter(g => g.enabled);

        const breaches: GeofenceBreach[] = [];

        for (const geofence of geofences) {
          // Skip if geofence is restricted to specific devices and this isn't one
          if (geofence.deviceImeis && geofence.deviceImeis.length > 0 &&
              !geofence.deviceImeis.includes(imei)) {
            continue;
          }

          const wasInside = prevLocation
            ? isInsideGeofence(prevLocation.lat, prevLocation.lng, geofence)
            : false;
          const isInside = isInsideGeofence(lat, lng, geofence);

          // Check for breach
          if (wasInside !== isInside) {
            const breachType = isInside ? 'enter' : 'exit';

            // Only trigger if this type of breach is configured
            if (geofence.triggerOn === 'both' || geofence.triggerOn === breachType) {
              const breach: GeofenceBreach = {
                id: `breach-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                geofenceId: geofence.id,
                geofenceName: geofence.name,
                imei,
                deviceName: deviceName || `Device ${imei.slice(-4)}`,
                breachType,
                location: { lat, lng },
                timestamp: new Date().toISOString(),
                acknowledged: false
              };

              breaches.push(breach);

              // Store breach (prepend to list for recent-first ordering)
              await redis.lpush(GEOFENCE_BREACHES_KEY, JSON.stringify(breach));
              // Keep only last 1000 breaches
              await redis.ltrim(GEOFENCE_BREACHES_KEY, 0, 999);
            }
          }
        }

        return res.json({
          checked: geofences.length,
          breaches,
          breachCount: breaches.length
        });
      }

      // Create new geofence
      const { name, description, type, center, radiusMeters, vertices, triggerOn, deviceImeis, createdBy } = req.body;

      if (!name || !type || !triggerOn) {
        return res.status(400).json({ error: 'name, type, triggerOn required' });
      }

      if (type === 'circle' && (!center || !radiusMeters)) {
        return res.status(400).json({ error: 'Circle geofence requires center and radiusMeters' });
      }

      if (type === 'polygon' && (!vertices || vertices.length < 3)) {
        return res.status(400).json({ error: 'Polygon geofence requires at least 3 vertices' });
      }

      const geofence: Geofence = {
        id: `gf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        name,
        description,
        type,
        center: type === 'circle' ? center : undefined,
        radiusMeters: type === 'circle' ? radiusMeters : undefined,
        vertices: type === 'polygon' ? vertices : undefined,
        triggerOn,
        enabled: true,
        deviceImeis,
        createdAt: new Date().toISOString(),
        createdBy: createdBy || 'system',
        updatedAt: new Date().toISOString()
      };

      await redis.hset(GEOFENCES_KEY, { [geofence.id]: JSON.stringify(geofence) });

      return res.json({
        success: true,
        geofence,
        message: `Geofence "${name}" created`
      });
    }

    // =========================================================================
    // PATCH: Update geofence or acknowledge breach
    // =========================================================================
    if (req.method === 'PATCH') {
      const { id, acknowledgeBreach } = req.body;

      // Acknowledge a breach
      if (acknowledgeBreach && typeof acknowledgeBreach === 'string') {
        const breaches = await redis.lrange(GEOFENCE_BREACHES_KEY, 0, -1) || [];
        const updated: string[] = [];

        for (const b of breaches) {
          const breach: GeofenceBreach = typeof b === 'string' ? JSON.parse(b) : b;
          if (breach.id === acknowledgeBreach) {
            breach.acknowledged = true;
          }
          updated.push(JSON.stringify(breach));
        }

        // Replace the list
        await redis.del(GEOFENCE_BREACHES_KEY);
        if (updated.length > 0) {
          await redis.rpush(GEOFENCE_BREACHES_KEY, ...updated);
        }

        return res.json({ success: true, acknowledged: acknowledgeBreach });
      }

      // Update geofence
      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const existing = await redis.hget(GEOFENCES_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      const geofence: Geofence = typeof existing === 'string' ? JSON.parse(existing) : existing;
      const { name, description, center, radiusMeters, vertices, triggerOn, enabled, deviceImeis } = req.body;

      if (name !== undefined) geofence.name = name;
      if (description !== undefined) geofence.description = description;
      if (center !== undefined) geofence.center = center;
      if (radiusMeters !== undefined) geofence.radiusMeters = radiusMeters;
      if (vertices !== undefined) geofence.vertices = vertices;
      if (triggerOn !== undefined) geofence.triggerOn = triggerOn;
      if (enabled !== undefined) geofence.enabled = enabled;
      if (deviceImeis !== undefined) geofence.deviceImeis = deviceImeis;
      geofence.updatedAt = new Date().toISOString();

      await redis.hset(GEOFENCES_KEY, { [id]: JSON.stringify(geofence) });

      return res.json({
        success: true,
        geofence,
        message: `Geofence "${geofence.name}" updated`
      });
    }

    // =========================================================================
    // DELETE: Remove geofence
    // =========================================================================
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id required' });
      }

      const existing = await redis.hget(GEOFENCES_KEY, id);
      if (!existing) {
        return res.status(404).json({ error: 'Geofence not found' });
      }

      const geofence: Geofence = typeof existing === 'string' ? JSON.parse(existing) : existing;
      await redis.hdel(GEOFENCES_KEY, id);

      return res.json({
        success: true,
        deleted: id,
        message: `Geofence "${geofence.name}" deleted`
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Geofence error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
