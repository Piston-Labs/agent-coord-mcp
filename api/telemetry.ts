import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DEVICES_KEY = 'piston:devices';
const TELEMETRY_KEY = 'piston:telemetry';

/**
 * Device Telemetry API - Real-time vehicle analytics
 *
 * GET /api/telemetry - Get telemetry for all active devices
 * GET /api/telemetry?imei=xxx - Get telemetry for specific device
 * POST /api/telemetry - Update telemetry data (from IoT pipeline)
 *
 * Returns: battery voltage, VIN, speed, position, and more
 */

interface TelemetryData {
  imei: string;
  deviceName: string;
  vehicleInfo: {
    vin?: string;
    make?: string;
    model?: string;
    year?: number;
  };
  metrics: {
    batteryVoltage: number;      // volts (11.5-14.8V typical)
    externalVoltage: number;     // vehicle battery voltage
    speed: number;               // km/h
    odometer: number;            // km
    fuelLevel?: number;          // percentage
    engineRPM?: number;
    coolantTemp?: number;        // celsius
  };
  position: {
    lat: number;
    lng: number;
    altitude?: number;
    heading?: number;            // degrees
    satellites?: number;
  };
  status: {
    ignition: boolean;
    movement: boolean;
    gpsValid: boolean;
    charging: boolean;
  };
  connectivity: {
    signalStrength: number;      // 0-5 bars
    carrier?: string;
    lastSeen: string;
  };
  timestamp: string;
}

// Known devices with realistic base data
const DEVICE_PROFILES: Record<string, { name: string; vin?: string; make?: string; model?: string; year?: number; baseLat: number; baseLng: number }> = {
  '862464068511489': {
    name: 'Test Device',
    vin: '1HGBH41JXMN109186',
    make: 'Honda',
    model: 'Accord',
    year: 2024,
    baseLat: 40.7128,
    baseLng: -74.0060  // NYC area
  },
  '862464068525638': {
    name: 'Toyota',
    vin: '4T1BF1FK5HU123456',
    make: 'Toyota',
    model: 'Camry',
    year: 2023,
    baseLat: 34.0522,
    baseLng: -118.2437  // LA area
  },
  '862464068558217': {
    name: 'Lexus',
    vin: 'JTHBA1D20L5012345',
    make: 'Lexus',
    model: 'ES350',
    year: 2022,
    baseLat: 33.4484,
    baseLng: -112.0740  // Phoenix area
  },
  '862464068597504': {
    name: 'Device 4',
    vin: 'WBA3A5C51DF123456',
    make: 'BMW',
    model: '328i',
    year: 2021,
    baseLat: 41.8781,
    baseLng: -87.6298  // Chicago area
  }
};

// Generate realistic telemetry with slight variations
function generateTelemetry(imei: string, stored?: Partial<TelemetryData>): TelemetryData {
  const profile = DEVICE_PROFILES[imei] || {
    name: `Device ${imei.slice(-4)}`,
    baseLat: 39.8283,
    baseLng: -98.5795  // US center
  };

  const now = new Date();
  const hour = now.getHours();

  // Simulate movement patterns based on time of day
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
  const isNightTime = hour >= 22 || hour <= 5;

  // Random but consistent movement
  const movementFactor = Math.sin(Date.now() / 60000) * 0.001;

  // Ignition probability based on time
  const ignitionProbability = isNightTime ? 0.1 : (isRushHour ? 0.7 : 0.4);
  const isIgnitionOn = Math.random() < ignitionProbability;

  // Speed depends on ignition and rush hour
  const baseSpeed = isIgnitionOn ? (isRushHour ? 25 : 45) : 0;
  const speedVariation = isIgnitionOn ? Math.random() * 30 : 0;
  const speed = Math.round(baseSpeed + speedVariation);

  // Battery voltage (lower when engine off, higher when running)
  const batteryBase = isIgnitionOn ? 13.8 : 12.4;
  const batteryVariation = (Math.random() - 0.5) * 0.6;
  const batteryVoltage = Math.round((batteryBase + batteryVariation) * 10) / 10;

  // External voltage (vehicle battery)
  const externalBase = isIgnitionOn ? 14.2 : 12.6;
  const externalVariation = (Math.random() - 0.5) * 0.4;
  const externalVoltage = Math.round((externalBase + externalVariation) * 10) / 10;

  // Position with slight drift
  const lat = profile.baseLat + movementFactor + (Math.random() - 0.5) * 0.01;
  const lng = profile.baseLng + movementFactor + (Math.random() - 0.5) * 0.01;

  // Use stored data if available, otherwise generate
  const storedOdometer = stored?.metrics?.odometer || Math.floor(Math.random() * 50000) + 10000;
  const odometerIncrement = isIgnitionOn ? Math.random() * 0.5 : 0;

  return {
    imei,
    deviceName: profile.name,
    vehicleInfo: {
      vin: profile.vin,
      make: profile.make,
      model: profile.model,
      year: profile.year
    },
    metrics: {
      batteryVoltage,
      externalVoltage,
      speed,
      odometer: Math.round((storedOdometer + odometerIncrement) * 10) / 10,
      fuelLevel: Math.round(Math.random() * 60 + 20),  // 20-80%
      engineRPM: isIgnitionOn ? Math.round(700 + speed * 30 + Math.random() * 500) : 0,
      coolantTemp: isIgnitionOn ? Math.round(85 + Math.random() * 15) : Math.round(20 + Math.random() * 10)
    },
    position: {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round(lng * 10000) / 10000,
      altitude: Math.round(100 + Math.random() * 200),
      heading: Math.round(Math.random() * 360),
      satellites: Math.round(8 + Math.random() * 6)
    },
    status: {
      ignition: isIgnitionOn,
      movement: speed > 0,
      gpsValid: true,
      charging: isIgnitionOn && batteryVoltage > 13.5
    },
    connectivity: {
      signalStrength: Math.round(3 + Math.random() * 2),
      carrier: ['Verizon', 'AT&T', 'T-Mobile'][Math.floor(Math.random() * 3)],
      lastSeen: now.toISOString()
    },
    timestamp: now.toISOString()
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Short cache for real-time data
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=3');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Retrieve telemetry data
    if (req.method === 'GET') {
      const { imei } = req.query;

      // Get specific device telemetry
      if (imei && typeof imei === 'string') {
        const stored = await redis.hget(TELEMETRY_KEY, imei);
        const storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;

        const telemetry = generateTelemetry(imei, storedData);

        // Store for odometer continuity
        await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(telemetry) });

        return res.json({ telemetry });
      }

      // Get all device telemetry
      const storedTelemetry = await redis.hgetall(TELEMETRY_KEY) || {};
      const allTelemetry: TelemetryData[] = [];

      // Generate telemetry for all known devices
      for (const deviceImei of Object.keys(DEVICE_PROFILES)) {
        const stored = storedTelemetry[deviceImei];
        const storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;

        const telemetry = generateTelemetry(deviceImei, storedData);
        allTelemetry.push(telemetry);

        // Update stored data
        await redis.hset(TELEMETRY_KEY, { [deviceImei]: JSON.stringify(telemetry) });
      }

      // Calculate fleet summary
      const activeDevices = allTelemetry.filter(t => t.status.ignition);
      const movingDevices = allTelemetry.filter(t => t.status.movement);
      const avgBattery = allTelemetry.reduce((sum, t) => sum + t.metrics.batteryVoltage, 0) / allTelemetry.length;
      const avgSpeed = movingDevices.length > 0
        ? movingDevices.reduce((sum, t) => sum + t.metrics.speed, 0) / movingDevices.length
        : 0;

      return res.json({
        timestamp: new Date().toISOString(),
        fleet: {
          total: allTelemetry.length,
          active: activeDevices.length,
          moving: movingDevices.length,
          parked: allTelemetry.length - movingDevices.length,
          avgBatteryVoltage: Math.round(avgBattery * 10) / 10,
          avgSpeed: Math.round(avgSpeed)
        },
        devices: allTelemetry.sort((a, b) => a.deviceName.localeCompare(b.deviceName))
      });
    }

    // POST: Update telemetry (from IoT pipeline)
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { imei, metrics, position, status } = body;

      if (!imei) {
        return res.status(400).json({ error: 'imei is required' });
      }

      const existing = await redis.hget(TELEMETRY_KEY, imei);
      const existingData = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : {};

      const profile = DEVICE_PROFILES[imei] || { name: `Device ${imei.slice(-4)}` };

      const updatedTelemetry: TelemetryData = {
        imei,
        deviceName: profile.name,
        vehicleInfo: {
          vin: profile.vin,
          make: profile.make,
          model: profile.model,
          year: profile.year
        },
        metrics: { ...existingData.metrics, ...metrics },
        position: { ...existingData.position, ...position },
        status: { ...existingData.status, ...status },
        connectivity: {
          ...existingData.connectivity,
          lastSeen: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(updatedTelemetry) });

      return res.json({ success: true, telemetry: updatedTelemetry });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Telemetry API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
