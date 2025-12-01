import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DEVICES_KEY = 'piston:devices';

/**
 * Piston Labs Device Fleet API
 * 
 * Manages Teltonika GPS device inventory for the telemetry platform.
 * 
 * GET /api/piston-devices - List all devices
 * GET /api/piston-devices?imei=862464068511489 - Get specific device
 * POST /api/piston-devices - Add/update device
 * DELETE /api/piston-devices?imei=xxx - Remove device
 */

interface TeltonikaDevice {
  imei: string;
  name: string;
  model: string;  // FMB920, FMM00A, etc.
  status: 'active' | 'inactive' | 'provisioning' | 'error';
  vehicle?: {
    vin?: string;
    make?: string;
    model?: string;
    year?: number;
    owner?: string;
  };
  connectivity: {
    lastSeen?: string;
    signalStrength?: number;
    carrier?: string;
  };
  telemetry?: {
    lastPosition?: { lat: number; lng: number };
    lastSpeed?: number;
    lastOdometer?: number;
    lastUpdate?: string;
  };
  provisioning: {
    certificatePath?: string;
    provisionedAt?: string;
    provisionedBy?: string;
  };
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

// Known devices from teltonika-context-system
const KNOWN_DEVICES: Record<string, Partial<TeltonikaDevice>> = {
  '862464068511489': {
    name: 'Test Device',
    model: 'FMB920',
    status: 'active',
    vehicle: { make: 'Test', model: 'Vehicle', year: 2024 },
    notes: 'Primary development/testing device'
  },
  '862464068525638': {
    name: 'Toyota',
    model: 'FMM00A',
    status: 'active',
    vehicle: { make: 'Toyota', model: 'Camry' },
    notes: 'Production device - customer vehicle'
  },
  '862464068558217': {
    name: 'Lexus',
    model: 'FMM00A',
    status: 'active',
    vehicle: { make: 'Lexus' },
    notes: 'Production device - customer vehicle'
  },
  '862464068597504': {
    name: 'Device 4',
    model: 'FMM00A',
    status: 'inactive',
    notes: 'Spare device - not deployed'
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: List devices or get specific device
    if (req.method === 'GET') {
      const { imei, status } = req.query;

      // Get specific device
      if (imei && typeof imei === 'string') {
        // Check Redis first
        const cached = await redis.hget(DEVICES_KEY, imei);
        if (cached) {
          const device = typeof cached === 'string' ? JSON.parse(cached) : cached;
          return res.json({ device });
        }

        // Fall back to known devices
        const known = KNOWN_DEVICES[imei];
        if (known) {
          const device: TeltonikaDevice = {
            imei,
            name: known.name || `Device ${imei.slice(-4)}`,
            model: known.model || 'Unknown',
            status: known.status || 'inactive',
            vehicle: known.vehicle,
            connectivity: {},
            provisioning: {
              certificatePath: `certificates/${imei}/`,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: known.notes
          };
          return res.json({ device, source: 'known_devices' });
        }

        return res.status(404).json({ error: 'Device not found' });
      }

      // List all devices
      const cachedDevices = await redis.hgetall(DEVICES_KEY) || {};
      const devices: TeltonikaDevice[] = [];

      // Add cached devices
      for (const [deviceImei, data] of Object.entries(cachedDevices)) {
        const device = typeof data === 'string' ? JSON.parse(data) : data;
        devices.push(device);
      }

      // Add known devices not in cache
      for (const [deviceImei, known] of Object.entries(KNOWN_DEVICES)) {
        if (!cachedDevices[deviceImei]) {
          devices.push({
            imei: deviceImei,
            name: known.name || `Device ${deviceImei.slice(-4)}`,
            model: known.model || 'Unknown',
            status: known.status || 'inactive',
            vehicle: known.vehicle,
            connectivity: {},
            provisioning: {
              certificatePath: `certificates/${deviceImei}/`,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            notes: known.notes
          });
        }
      }

      // Filter by status if requested
      let filteredDevices = devices;
      if (status && typeof status === 'string') {
        filteredDevices = devices.filter(d => d.status === status);
      }

      // Sort by name
      filteredDevices.sort((a, b) => a.name.localeCompare(b.name));

      return res.json({
        devices: filteredDevices,
        count: filteredDevices.length,
        active: filteredDevices.filter(d => d.status === 'active').length
      });
    }

    // POST: Add or update device
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { imei, name, model, status, vehicle, notes, connectivity, telemetry } = body;

      if (!imei) {
        return res.status(400).json({ error: 'imei is required' });
      }

      // Get existing or create new
      let device: TeltonikaDevice;
      const existing = await redis.hget(DEVICES_KEY, imei);
      
      if (existing) {
        device = typeof existing === 'string' ? JSON.parse(existing) : existing;
      } else {
        const known = KNOWN_DEVICES[imei];
        device = {
          imei,
          name: known?.name || name || `Device ${imei.slice(-4)}`,
          model: known?.model || model || 'Unknown',
          status: known?.status || status || 'inactive',
          vehicle: known?.vehicle || vehicle,
          connectivity: {},
          provisioning: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          notes: known?.notes || notes
        };
      }

      // Update fields
      if (name) device.name = name;
      if (model) device.model = model;
      if (status) device.status = status;
      if (vehicle) device.vehicle = { ...device.vehicle, ...vehicle };
      if (notes) device.notes = notes;
      if (connectivity) device.connectivity = { ...device.connectivity, ...connectivity };
      if (telemetry) device.telemetry = { ...device.telemetry, ...telemetry };
      device.updatedAt = new Date().toISOString();

      await redis.hset(DEVICES_KEY, { [imei]: JSON.stringify(device) });

      return res.json({ success: true, device });
    }

    // DELETE: Remove device
    if (req.method === 'DELETE') {
      const { imei } = req.query;

      if (!imei || typeof imei !== 'string') {
        return res.status(400).json({ error: 'imei query parameter required' });
      }

      await redis.hdel(DEVICES_KEY, imei);
      return res.json({ success: true, removed: imei });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Device API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
