import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DEVICES_KEY = 'piston:devices';
const DEVICE_TELEMETRY_KEY = 'piston:device-telemetry';

/**
 * Piston Labs Device Fleet API
 * 
 * Manages Teltonika OBD-II device fleet for the telemetry platform.
 * 
 * GET /api/piston-devices - List all devices
 * GET /api/piston-devices?imei=xxx - Get device status
 * POST /api/piston-devices - Register new device
 * POST /api/piston-devices?action=telemetry - Record telemetry
 */

interface Device {
  imei: string;
  name: string;
  model: 'FMB920' | 'FMM00A' | 'FMC130' | 'unknown';
  backend?: 'aws' | 'cloudflare';  // AWS IoT Core (legacy) vs Cloudflare Workers (new)
  status: 'active' | 'idle' | 'offline' | 'provisioning';
  vehicle?: {
    make?: string;
    model?: string;
    year?: number;
    vin?: string;
  };
  simIccid?: string;
  firmwareVersion?: string;
  lastSeen?: string;
  lastLocation?: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
  };
  registeredAt: string;
  provisionedBy?: string;
  notes?: string;
  // Telemetry stats
  totalMessages?: number;
  messagesLast24h?: number;
  lastOdometer?: number;
  lastFuelLevel?: number;
}

/**
 * BACKEND ARCHITECTURE:
 * - Devices 1-5 (862464068511489 through 862464068525406) -> AWS IoT Core (legacy)
 * - Device 6+ (862464068693907+) -> Cloudflare Workers + D1 (new architecture)
 * 
 * Migration from AWS to Cloudflare in progress as of Dec 2025.
 * Updated Dec 8 2025 from VIN decode (AVL ID 256) via NHTSA API
 */
const KNOWN_DEVICES: Record<string, Partial<Device>> = {
  '862464068511489': {
    name: 'Toyota Tacoma',
    model: 'FMM00A',
    backend: 'aws',
    vehicle: { make: 'Toyota', model: 'Tacoma', year: 2008 },
    notes: 'Production device - awaiting VIN confirmation'
  },
  '862464068525638': {
    name: 'Lexus RX 350',
    model: 'FMM00A',
    backend: 'aws',
    vehicle: {
      make: 'Lexus',
      model: 'RX 350',
      year: 2015,
      vin: '2T2BK1BA5FC336915'  // Verified via AVL ID 256
    },
    notes: 'Production device - VIN verified Dec 8 2025. 3.5L V6 AWD 270hp'
  },
  '862464068558217': {
    name: 'Pug Subaru Legacy',
    model: 'FMM00A',
    backend: 'aws',
    vehicle: { make: 'Subaru', model: 'Legacy', year: 1997 },
    notes: 'Beta tester device - Pug. 1997 may have limited OBD-II support'
  },
  '862464068597504': {
    name: 'Tom OBD2 Emulator',
    model: 'FMM00A',
    backend: 'aws',
    vehicle: { make: 'Emulator', model: 'OBD2', year: 2024 },
    notes: 'Spare device - OBD2 emulator for testing'
  },
  '862464068525406': {
    name: 'Workbench Device',
    model: 'FMM00A',
    backend: 'aws',
    vehicle: { make: 'Test', model: 'Workbench', year: 2024 },
    notes: 'Development/testing device'
  },
  '862464068693907': {
    name: 'Tyler Test Device',
    model: 'FMM00A',
    backend: 'cloudflare',
    vehicle: { make: 'Test', model: 'Config Validation', year: 2025 },
    notes: 'Active test device - Dec 2025 config validation. IMEI auth every ~2 min.'
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { imei, action } = req.query;

    // GET: List devices or get specific device
    if (req.method === 'GET') {
      // Get specific device
      if (imei && typeof imei === 'string') {
        const deviceRaw = await redis.hget(DEVICES_KEY, imei);
        
        if (!deviceRaw) {
          // Check if it's a known device not yet in Redis
          if (KNOWN_DEVICES[imei]) {
            const knownDevice: Device = {
              imei,
              ...KNOWN_DEVICES[imei],
              name: KNOWN_DEVICES[imei].name || `Device ${imei}`,
              model: KNOWN_DEVICES[imei].model || 'unknown',
              status: 'active',
              registeredAt: new Date().toISOString()
            };
            // Save to Redis
            await redis.hset(DEVICES_KEY, { [imei]: JSON.stringify(knownDevice) });
            return res.json({ device: knownDevice, source: 'known_devices' });
          }
          return res.status(404).json({ error: 'Device not found', imei });
        }

        const device: Device = typeof deviceRaw === 'string' ? JSON.parse(deviceRaw) : deviceRaw;
        
        // Get recent telemetry
        const telemetryRaw = await redis.lrange(`${DEVICE_TELEMETRY_KEY}:${imei}`, 0, 9);
        const recentTelemetry = telemetryRaw.map((t: unknown) => 
          typeof t === 'string' ? JSON.parse(t) : t
        );

        return res.json({ 
          device, 
          recentTelemetry,
          health: calculateDeviceHealth(device)
        });
      }

      // List all devices
      const devicesRaw = await redis.hgetall(DEVICES_KEY) || {};
      let devices: Device[] = Object.values(devicesRaw).map((d: unknown) =>
        typeof d === 'string' ? JSON.parse(d) : d
      ) as Device[];

      // Add known devices if not in Redis
      for (const [knownImei, knownData] of Object.entries(KNOWN_DEVICES)) {
        if (!devices.find(d => d.imei === knownImei)) {
          const device: Device = {
            imei: knownImei,
            ...knownData,
            name: knownData.name || `Device ${knownImei}`,
            model: knownData.model || 'unknown',
            status: 'active',
            registeredAt: new Date().toISOString()
          };
          devices.push(device);
          // Save to Redis
          await redis.hset(DEVICES_KEY, { [knownImei]: JSON.stringify(device) });
        }
      }

      // Calculate fleet stats
      const stats = {
        total: devices.length,
        active: devices.filter(d => d.status === 'active').length,
        idle: devices.filter(d => d.status === 'idle').length,
        offline: devices.filter(d => d.status === 'offline').length
      };

      return res.json({ devices, stats });
    }

    // POST: Register device or record telemetry
    if (req.method === 'POST') {
      let body: any;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      // Record telemetry
      if (action === 'telemetry') {
        const { imei: telemetryImei, data } = body;
        if (!telemetryImei || !data) {
          return res.status(400).json({ error: 'imei and data required' });
        }

        // Store telemetry (keep last 100 entries)
        const telemetryEntry = {
          ...data,
          receivedAt: new Date().toISOString()
        };
        await redis.lpush(`${DEVICE_TELEMETRY_KEY}:${telemetryImei}`, JSON.stringify(telemetryEntry));
        await redis.ltrim(`${DEVICE_TELEMETRY_KEY}:${telemetryImei}`, 0, 99);

        // Update device last seen
        const deviceRaw = await redis.hget(DEVICES_KEY, telemetryImei);
        if (deviceRaw) {
          const device: Device = typeof deviceRaw === 'string' ? JSON.parse(deviceRaw) : deviceRaw;
          device.lastSeen = new Date().toISOString();
          device.status = 'active';
          if (data.location) device.lastLocation = data.location;
          if (data.odometer) device.lastOdometer = data.odometer;
          if (data.fuelLevel) device.lastFuelLevel = data.fuelLevel;
          device.totalMessages = (device.totalMessages || 0) + 1;
          await redis.hset(DEVICES_KEY, { [telemetryImei]: JSON.stringify(device) });
        }

        return res.json({ success: true, message: 'Telemetry recorded' });
      }

      // Register new device
      const {
        imei: newImei,
        name,
        model = 'FMM00A',
        vehicle,
        simIccid,
        provisionedBy
      } = body;

      if (!newImei) {
        return res.status(400).json({ error: 'imei is required' });
      }

      // Check if already exists
      const existing = await redis.hget(DEVICES_KEY, newImei);
      if (existing) {
        return res.status(409).json({ error: 'Device already registered', imei: newImei });
      }

      const device: Device = {
        imei: newImei,
        name: name || `Device ${newImei}`,
        model: model as Device['model'],
        status: 'provisioning',
        vehicle,
        simIccid,
        provisionedBy,
        registeredAt: new Date().toISOString()
      };

      await redis.hset(DEVICES_KEY, { [newImei]: JSON.stringify(device) });

      return res.json({
        success: true,
        device,
        nextSteps: [
          '1. Generate AWS IoT certificate',
          '2. Configure device with certificate',
          '3. Insert SIM card',
          '4. Install in vehicle OBD-II port',
          '5. Device will auto-connect and start transmitting'
        ],
        provisioningScript: `powershell -File scripts/deployment/provision_new_device.ps1 -IMEI ${newImei}`
      });
    }

    // PUT: Update device
    if (req.method === 'PUT') {
      const updateImei = imei as string;
      if (!updateImei) {
        return res.status(400).json({ error: 'imei query parameter required' });
      }

      let body: any;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const deviceRaw = await redis.hget(DEVICES_KEY, updateImei);
      if (!deviceRaw) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const device: Device = typeof deviceRaw === 'string' ? JSON.parse(deviceRaw) : deviceRaw;
      
      // Update allowed fields
      if (body.name) device.name = body.name;
      if (body.status) device.status = body.status;
      if (body.vehicle) device.vehicle = { ...device.vehicle, ...body.vehicle };
      if (body.notes) device.notes = body.notes;

      await redis.hset(DEVICES_KEY, { [updateImei]: JSON.stringify(device) });

      return res.json({ success: true, device });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Device API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

function calculateDeviceHealth(device: Device): { score: number; status: string; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  // Check last seen
  if (device.lastSeen) {
    const lastSeenMs = Date.now() - new Date(device.lastSeen).getTime();
    const hoursSinceLastSeen = lastSeenMs / (1000 * 60 * 60);
    
    if (hoursSinceLastSeen > 24) {
      score -= 40;
      issues.push(`No data in ${Math.floor(hoursSinceLastSeen)} hours`);
    } else if (hoursSinceLastSeen > 1) {
      score -= 10;
      issues.push(`Last data ${Math.floor(hoursSinceLastSeen)} hours ago`);
    }
  } else {
    score -= 20;
    issues.push('No telemetry data received yet');
  }

  // Check status
  if (device.status === 'offline') {
    score -= 30;
    issues.push('Device offline');
  } else if (device.status === 'provisioning') {
    score -= 10;
    issues.push('Device still provisioning');
  }

  const status = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical';

  return { score, status, issues };
}
