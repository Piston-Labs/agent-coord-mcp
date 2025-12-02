import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Supabase connection for real-time telemetry queries via REST API
// Data pipeline: Teltonika GPS → AWS IoT Core → Lambda → Supabase
// REST API is ideal for serverless - no persistent connections needed
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const hasSupabase = SUPABASE_URL && SUPABASE_KEY;

// S3 for raw telemetry archives (optional, for historical lookups)
const hasAWSCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
const s3 = hasAWSCredentials ? new S3Client({
  region: process.env.AWS_REGION || 'us-west-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
}) : null;

const TELEMETRY_KEY = 'piston:telemetry';
const TELEMETRY_HISTORY_KEY = 'piston:telemetry-history';
const ALERTS_KEY = 'piston:telemetry-alerts';

// S3 bucket for raw telemetry archives
const S3_BUCKET = process.env.S3_TELEMETRY_BUCKET || 'telemetry-raw-usw1';

// Supabase table name (from teltonika-context-system Lambda)
const TELEMETRY_TABLE = process.env.SUPABASE_TELEMETRY_TABLE || 'telemetry';

/**
 * Device Telemetry API - Real-time vehicle analytics with health monitoring
 *
 * Data source: Teltonika GPS devices via AWS IoT Core pipeline (teltonika-context-system)
 * Pipeline: Teltonika GPS → AWS IoT Core → Lambda → [S3, Supabase, TimescaleDB, Redshift]
 *
 * Queries Supabase REST API for real-time data (ideal for serverless)
 * Falls back to Redis cache if Supabase unavailable
 *
 * GET /api/telemetry - Get telemetry for all devices with health scores
 * GET /api/telemetry?imei=xxx - Get telemetry for specific device
 * GET /api/telemetry?history=true - Include historical data (last 24 readings)
 * GET /api/telemetry?alerts=true - Include active alerts
 * POST /api/telemetry - Update telemetry data (from IoT pipeline)
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
    batteryVoltage: number;
    externalVoltage: number;
    speed: number;
    odometer: number;
    fuelLevel?: number;
    engineRPM?: number;
    coolantTemp?: number;
  };
  position: {
    lat: number;
    lng: number;
    altitude?: number;
    heading?: number;
    satellites?: number;
  };
  status: {
    ignition: boolean;
    movement: boolean;
    gpsValid: boolean;
    charging: boolean;
    offline?: boolean;
  };
  connectivity: {
    signalStrength: number;
    carrier?: string;
    lastSeen: string;
  };
  health: {
    score: number;           // 0-100
    status: 'excellent' | 'good' | 'warning' | 'critical';
    issues: string[];
  };
  timestamp: string;
}

interface TelemetryAlert {
  id: string;
  imei: string;
  deviceName: string;
  type: 'low_battery' | 'offline' | 'low_signal' | 'overheating' | 'speeding' | 'low_fuel';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value?: number;
  threshold?: number;
  createdAt: string;
  acknowledged: boolean;
}

// Alert thresholds
const THRESHOLDS = {
  BATTERY_LOW: 11.8,
  BATTERY_CRITICAL: 11.0,
  SIGNAL_LOW: 2,
  COOLANT_HIGH: 105,
  SPEED_HIGH: 120,
  FUEL_LOW: 15,
  OFFLINE_MINUTES: 30,
};

// REAL Piston Labs Fleet - Verified Active Teltonika Devices from AWS IoT Core
// Source: teltonika-context-system/context/technical/devices.md
// Last verified: December 1, 2025
//
// Device status based on actual AWS S3 telemetry data:
// - ACTIVE: Toyota, Lexus NX, Beta Tester (Pug) - transmitting live
// - OFFLINE: Test Device (since Nov 15), OBD2 Emulator (since Nov 26)
//
// NOTE: Only these 5 devices are verified active in production.
// Do NOT add fake test data from gran-autismo or other sources.

interface DeviceProfile {
  name: string;
  description?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  owner?: string;
  baseLat: number;
  baseLng: number;
  isActive: boolean;  // true = transmitting, false = offline
  lastKnownDate?: string;  // ISO date of last transmission (for offline devices)
}

const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  '862464068525406': {
    name: 'Test Device',
    description: 'Workbench/temporary vehicles - testing before production deployment',
    owner: 'Piston Labs',
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: false,
    lastKnownDate: '2025-11-15T00:00:00Z'  // Offline since Nov 15
  },
  '862464068511489': {
    name: 'Toyota',
    description: 'Production deployment vehicle',
    make: 'Toyota',
    year: 2008,
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: true  // Live - transmitting now
  },
  '862464068525638': {
    name: 'Lexus NX',
    description: 'Production deployment vehicle',
    make: 'Lexus',
    model: 'NX',
    year: 2015,
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: true  // Live - transmitting now
  },
  '862464068597504': {
    name: 'OBD2 Emulator',
    description: 'Feature development with OBD2 emulator - testing new telemetry parameters',
    owner: 'Tom (Hardware & IoT)',
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: false,
    lastKnownDate: '2025-11-26T00:00:00Z'  // Offline since Nov 26
  },
  '862464068558217': {
    name: 'Beta Tester (Pug)',
    description: 'Beta testing - real-world driving data collection',
    owner: 'Pug',
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: true  // Live - transmitting now
  }
};

// Calculate health score and issues
function calculateHealth(telemetry: Omit<TelemetryData, 'health'>): TelemetryData['health'] {
  const issues: string[] = [];
  let score = 100;

  // Battery checks
  if (telemetry.metrics.batteryVoltage < THRESHOLDS.BATTERY_CRITICAL) {
    issues.push('Critical: Battery voltage dangerously low');
    score -= 40;
  } else if (telemetry.metrics.batteryVoltage < THRESHOLDS.BATTERY_LOW) {
    issues.push('Warning: Low battery voltage');
    score -= 20;
  }

  // Signal strength
  if (telemetry.connectivity.signalStrength < THRESHOLDS.SIGNAL_LOW) {
    issues.push('Warning: Weak cellular signal');
    score -= 15;
  }

  // Coolant temperature
  if (telemetry.metrics.coolantTemp && telemetry.metrics.coolantTemp > THRESHOLDS.COOLANT_HIGH) {
    issues.push('Critical: Engine overheating');
    score -= 30;
  }

  // Speed check
  if (telemetry.metrics.speed > THRESHOLDS.SPEED_HIGH) {
    issues.push('Warning: Excessive speed');
    score -= 10;
  }

  // Fuel level
  if (telemetry.metrics.fuelLevel && telemetry.metrics.fuelLevel < THRESHOLDS.FUEL_LOW) {
    issues.push('Info: Low fuel level');
    score -= 5;
  }

  // GPS validity
  if (!telemetry.status.gpsValid) {
    issues.push('Warning: GPS signal lost');
    score -= 15;
  }

  // Determine status
  let status: TelemetryData['health']['status'];
  if (score >= 90) status = 'excellent';
  else if (score >= 70) status = 'good';
  else if (score >= 50) status = 'warning';
  else status = 'critical';

  return { score: Math.max(0, score), status, issues };
}

// Generate alerts based on telemetry
function generateAlerts(telemetry: TelemetryData): TelemetryAlert[] {
  const alerts: TelemetryAlert[] = [];
  const now = new Date().toISOString();

  if (telemetry.metrics.batteryVoltage < THRESHOLDS.BATTERY_CRITICAL) {
    alerts.push({
      id: `alert-${telemetry.imei}-battery-critical-${Date.now()}`,
      imei: telemetry.imei,
      deviceName: telemetry.deviceName,
      type: 'low_battery',
      severity: 'critical',
      message: `Critical battery voltage: ${telemetry.metrics.batteryVoltage}V`,
      value: telemetry.metrics.batteryVoltage,
      threshold: THRESHOLDS.BATTERY_CRITICAL,
      createdAt: now,
      acknowledged: false
    });
  } else if (telemetry.metrics.batteryVoltage < THRESHOLDS.BATTERY_LOW) {
    alerts.push({
      id: `alert-${telemetry.imei}-battery-low-${Date.now()}`,
      imei: telemetry.imei,
      deviceName: telemetry.deviceName,
      type: 'low_battery',
      severity: 'warning',
      message: `Low battery voltage: ${telemetry.metrics.batteryVoltage}V`,
      value: telemetry.metrics.batteryVoltage,
      threshold: THRESHOLDS.BATTERY_LOW,
      createdAt: now,
      acknowledged: false
    });
  }

  if (telemetry.connectivity.signalStrength < THRESHOLDS.SIGNAL_LOW) {
    alerts.push({
      id: `alert-${telemetry.imei}-signal-${Date.now()}`,
      imei: telemetry.imei,
      deviceName: telemetry.deviceName,
      type: 'low_signal',
      severity: 'warning',
      message: `Weak signal: ${telemetry.connectivity.signalStrength}/5 bars`,
      value: telemetry.connectivity.signalStrength,
      threshold: THRESHOLDS.SIGNAL_LOW,
      createdAt: now,
      acknowledged: false
    });
  }

  if (telemetry.metrics.coolantTemp && telemetry.metrics.coolantTemp > THRESHOLDS.COOLANT_HIGH) {
    alerts.push({
      id: `alert-${telemetry.imei}-overheat-${Date.now()}`,
      imei: telemetry.imei,
      deviceName: telemetry.deviceName,
      type: 'overheating',
      severity: 'critical',
      message: `Engine overheating: ${telemetry.metrics.coolantTemp}°C`,
      value: telemetry.metrics.coolantTemp,
      threshold: THRESHOLDS.COOLANT_HIGH,
      createdAt: now,
      acknowledged: false
    });
  }

  return alerts;
}

// Get telemetry for a device - uses REAL stored data, no simulation
// Data must be POSTed by the actual IoT pipeline to appear here
function generateTelemetry(imei: string, stored?: Partial<TelemetryData>): TelemetryData {
  const profile = DEVICE_PROFILES[imei] || {
    name: `Device ${imei.slice(-4)}`,
    baseLat: 39.8283,
    baseLng: -98.5795,
    isActive: false
  };

  const now = new Date();

  // Check if we have recent real data from the IoT pipeline
  // If lastSeen is more than 30 minutes old, consider device offline
  const lastSeenTime = stored?.connectivity?.lastSeen ? new Date(stored.connectivity.lastSeen).getTime() : 0;
  const minutesSinceLastSeen = (now.getTime() - lastSeenTime) / 60000;
  const hasRecentData = lastSeenTime > 0 && minutesSinceLastSeen < THRESHOLDS.OFFLINE_MINUTES;

  // If we have recent real data, use it
  if (hasRecentData && stored) {
    const baseTelemetry = {
      imei,
      deviceName: profile.name,
      vehicleInfo: {
        vin: profile.vin,
        make: profile.make,
        model: profile.model,
        year: profile.year
      },
      metrics: {
        batteryVoltage: stored.metrics?.batteryVoltage || 0,
        externalVoltage: stored.metrics?.externalVoltage || 0,
        speed: stored.metrics?.speed || 0,
        odometer: stored.metrics?.odometer || 0,
        fuelLevel: stored.metrics?.fuelLevel,
        engineRPM: stored.metrics?.engineRPM || 0,
        coolantTemp: stored.metrics?.coolantTemp
      },
      position: {
        lat: stored.position?.lat || profile.baseLat,
        lng: stored.position?.lng || profile.baseLng,
        altitude: stored.position?.altitude,
        heading: stored.position?.heading,
        satellites: stored.position?.satellites || 0
      },
      status: {
        ignition: stored.status?.ignition || false,
        movement: stored.status?.movement || false,
        gpsValid: stored.status?.gpsValid || false,
        charging: stored.status?.charging || false,
        offline: false
      },
      connectivity: {
        signalStrength: stored.connectivity?.signalStrength || 0,
        carrier: stored.connectivity?.carrier,
        lastSeen: stored.connectivity?.lastSeen || now.toISOString()
      },
      timestamp: stored.timestamp || now.toISOString()
    };

    const health = calculateHealth(baseTelemetry);
    return { ...baseTelemetry, health };
  }

  // No recent data - device is offline or never reported
  // Use last known data if available, otherwise show as unknown
  const lastSeenDate = stored?.connectivity?.lastSeen || profile.lastKnownDate || now.toISOString();

  const baseTelemetry = {
    imei,
    deviceName: profile.name,
    vehicleInfo: {
      vin: profile.vin,
      make: profile.make,
      model: profile.model,
      year: profile.year
    },
    metrics: {
      batteryVoltage: stored?.metrics?.batteryVoltage || 12.2,  // Typical parked voltage
      externalVoltage: stored?.metrics?.externalVoltage || 12.6,
      speed: 0,  // Not moving if offline
      odometer: stored?.metrics?.odometer || 0,
      fuelLevel: stored?.metrics?.fuelLevel,
      engineRPM: 0,
      coolantTemp: stored?.metrics?.coolantTemp || 21  // Ambient temp
    },
    position: {
      lat: stored?.position?.lat || profile.baseLat,
      lng: stored?.position?.lng || profile.baseLng,
      altitude: stored?.position?.altitude,
      heading: stored?.position?.heading,
      satellites: 0  // No GPS lock when offline
    },
    status: {
      ignition: false,
      movement: false,
      gpsValid: false,
      charging: false,
      offline: true  // Flag this device as offline
    },
    connectivity: {
      signalStrength: 0,  // No signal - offline
      carrier: stored?.connectivity?.carrier,
      lastSeen: lastSeenDate
    },
    timestamp: lastSeenDate  // Last known timestamp, not current
  };

  // Offline devices have degraded health score
  const health = {
    score: 0,
    status: 'critical' as const,
    issues: ['Device offline - no recent telemetry data']
  };

  return { ...baseTelemetry, health };
}

// ============================================================================
// Supabase Direct Query Functions (REST API)
// Data pipeline: Teltonika GPS → AWS IoT Core → Lambda → Supabase
// REST API is ideal for serverless - no persistent connections needed
// ============================================================================

// Query Supabase for recent telemetry data for a device
async function querySupabaseTelemetry(imei: string): Promise<Partial<TelemetryData> | null> {
  if (!hasSupabase) return null;

  try {
    // Query Supabase REST API for most recent telemetry row
    const url = `${SUPABASE_URL}/rest/v1/${TELEMETRY_TABLE}?imei=eq.${imei}&order=timestamp.desc&limit=1`;
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY!,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      console.error(`[telemetry] Supabase query failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const rows = await response.json();
    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];

    // Parse Supabase row into TelemetryData format
    // Column names based on teltonika-context-system Lambda output
    return {
      imei,
      metrics: {
        batteryVoltage: parseFloat(row.battery_voltage || row.external_voltage || '0'),
        externalVoltage: parseFloat(row.external_voltage || '0'),
        speed: parseFloat(row.speed || '0'),
        odometer: parseFloat(row.odometer || row.total_odometer || '0'),
        fuelLevel: row.fuel_level ? parseFloat(row.fuel_level) : undefined,
        engineRPM: row.engine_rpm ? parseFloat(row.engine_rpm) : undefined,
        coolantTemp: row.coolant_temp || row.engine_temp ? parseFloat(row.coolant_temp || row.engine_temp) : undefined,
      },
      position: {
        lat: parseFloat(row.latitude || row.lat || '0'),
        lng: parseFloat(row.longitude || row.lng || row.lon || '0'),
        altitude: row.altitude ? parseFloat(row.altitude) : undefined,
        heading: row.heading || row.angle ? parseFloat(row.heading || row.angle) : undefined,
        satellites: row.satellites ? parseInt(row.satellites) : undefined,
      },
      status: {
        ignition: row.ignition === true || row.ignition === 1 || row.ignition === 'on',
        movement: row.movement === true || row.movement === 1 || (parseFloat(row.speed || '0') > 0),
        gpsValid: row.gps_valid !== false && (row.satellites > 0 || row.satellites === undefined),
        charging: row.charging === true || (parseFloat(row.external_voltage || '0') > 13.5),
      },
      connectivity: {
        signalStrength: parseInt(row.gsm_signal || row.signal_strength || '0'),
        carrier: row.carrier || row.operator,
        lastSeen: row.timestamp || row.created_at || new Date().toISOString(),
      },
      timestamp: row.timestamp || row.created_at || new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[telemetry] Supabase query failed for ${imei}:`, err);
    return null;
  }
}

// Query all recent telemetry from Supabase
async function queryAllSupabaseTelemetry(): Promise<Map<string, Partial<TelemetryData>>> {
  const results = new Map<string, Partial<TelemetryData>>();

  if (!hasSupabase) return results;

  try {
    // Query for each known device in parallel
    const queries = Object.keys(DEVICE_PROFILES).map(async (imei) => {
      const data = await querySupabaseTelemetry(imei);
      if (data) {
        results.set(imei, data);
      }
    });

    await Promise.all(queries);
  } catch (err) {
    console.error('[telemetry] Supabase scan failed:', err);
  }

  return results;
}

// Query telemetry history from Supabase
async function querySupabaseHistory(imei: string, limit: number = 288): Promise<any[]> {
  if (!hasSupabase) return [];

  try {
    const url = `${SUPABASE_URL}/rest/v1/${TELEMETRY_TABLE}?imei=eq.${imei}&order=timestamp.desc&limit=${limit}&select=timestamp,speed,latitude,longitude,battery_voltage,fuel_level,ignition`;
    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY!,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      console.error(`[telemetry] Supabase history query failed: ${response.status}`);
      return [];
    }

    const rows = await response.json();
    return rows.map((row: any) => ({
      timestamp: row.timestamp,
      speed: parseFloat(row.speed || '0'),
      lat: parseFloat(row.latitude || '0'),
      lng: parseFloat(row.longitude || '0'),
      battery: parseFloat(row.battery_voltage || '0'),
      fuel: row.fuel_level ? parseFloat(row.fuel_level) : undefined,
      ignition: row.ignition,
    }));
  } catch (err) {
    console.error(`[telemetry] Supabase history query failed for ${imei}:`, err);
    return [];
  }
}

// Get recent S3 telemetry files for a device (for historical lookups)
// S3 path: s3://telemetry-raw-usw1/{IMEI}/{YYYY}/{MM}/{DD}/{TIMESTAMP}.json
async function getS3TelemetryFiles(imei: string, limit: number = 10): Promise<string[]> {
  if (!s3) return [];

  try {
    // Get today's date for the path
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const prefix = `${imei}/${year}/${month}/${day}/`;
    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      MaxKeys: limit,
    });

    const response = await s3.send(command);
    return (response.Contents || [])
      .map(obj => obj.Key || '')
      .filter(Boolean)
      .sort()
      .reverse(); // Most recent first
  } catch (err) {
    console.error(`[telemetry] S3 list failed for ${imei}:`, err);
    return [];
  }
}

// Store historical data point
async function storeHistoryPoint(imei: string, telemetry: TelemetryData) {
  const historyKey = `${TELEMETRY_HISTORY_KEY}:${imei}`;
  const historyPoint = {
    timestamp: telemetry.timestamp,
    battery: telemetry.metrics.batteryVoltage,
    speed: telemetry.metrics.speed,
    fuel: telemetry.metrics.fuelLevel,
    healthScore: telemetry.health.score,
    ignition: telemetry.status.ignition,
    lat: telemetry.position.lat,
    lng: telemetry.position.lng
  };

  await redis.lpush(historyKey, JSON.stringify(historyPoint));
  await redis.ltrim(historyKey, 0, 287); // Keep ~24h of data at 5min intervals
}

// Get historical data
async function getHistory(imei: string, limit: number = 24): Promise<any[]> {
  const historyKey = `${TELEMETRY_HISTORY_KEY}:${imei}`;
  const history = await redis.lrange(historyKey, 0, limit - 1) || [];
  return history.map(h => typeof h === 'string' ? JSON.parse(h) : h);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=3');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { imei, history, alerts: includeAlerts } = req.query;

      // Get specific device
      if (imei && typeof imei === 'string') {
        // Try Supabase first for real-time data (REST API - ideal for serverless)
        let storedData: Partial<TelemetryData> | undefined;

        if (hasSupabase) {
          const supabaseData = await querySupabaseTelemetry(imei);
          if (supabaseData) {
            storedData = supabaseData;
            // Cache in Redis for faster subsequent access
            await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(supabaseData) });
          }
        }

        // Fall back to Redis if no Supabase data
        if (!storedData) {
          const stored = await redis.hget(TELEMETRY_KEY, imei);
          storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;
        }

        const telemetry = generateTelemetry(imei, storedData);
        await storeHistoryPoint(imei, telemetry);

        const response: any = {
          telemetry,
          source: hasSupabase && storedData ? 'supabase' : 'redis'
        };

        if (history === 'true') {
          // Prefer Supabase for history
          if (hasSupabase) {
            response.history = await querySupabaseHistory(imei);
          } else {
            response.history = await getHistory(imei);
          }
        }

        return res.json(response);
      }

      // Get all devices
      // Try Supabase first for fresh data (REST API - serverless friendly)
      let dbTelemetry: Map<string, Partial<TelemetryData>> = new Map();
      if (hasSupabase) {
        dbTelemetry = await queryAllSupabaseTelemetry();
      }

      const storedTelemetry = await redis.hgetall(TELEMETRY_KEY) || {};
      const allTelemetry: TelemetryData[] = [];
      const allAlerts: TelemetryAlert[] = [];

      for (const deviceImei of Object.keys(DEVICE_PROFILES)) {
        // Prefer Supabase data, fall back to Redis
        let storedData: Partial<TelemetryData> | undefined = dbTelemetry.get(deviceImei);

        if (!storedData) {
          const stored = storedTelemetry[deviceImei];
          storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;
        } else {
          // Cache Supabase data in Redis
          await redis.hset(TELEMETRY_KEY, { [deviceImei]: JSON.stringify(storedData) });
        }

        const telemetry = generateTelemetry(deviceImei, storedData);
        allTelemetry.push(telemetry);

        await storeHistoryPoint(deviceImei, telemetry);

        // Collect alerts
        if (includeAlerts === 'true') {
          allAlerts.push(...generateAlerts(telemetry));
        }
      }

      // Fleet summary with health
      const onlineDevices = allTelemetry.filter(t => !t.status.offline);
      const offlineDevices = allTelemetry.filter(t => t.status.offline);
      const activeDevices = onlineDevices.filter(t => t.status.ignition);
      const movingDevices = onlineDevices.filter(t => t.status.movement);
      const avgBattery = allTelemetry.reduce((sum, t) => sum + t.metrics.batteryVoltage, 0) / allTelemetry.length;
      const avgSpeed = movingDevices.length > 0
        ? movingDevices.reduce((sum, t) => sum + t.metrics.speed, 0) / movingDevices.length
        : 0;
      const avgHealth = allTelemetry.reduce((sum, t) => sum + t.health.score, 0) / allTelemetry.length;

      const healthyDevices = allTelemetry.filter(t => t.health.status === 'excellent' || t.health.status === 'good').length;
      const warningDevices = allTelemetry.filter(t => t.health.status === 'warning').length;
      const criticalDevices = allTelemetry.filter(t => t.health.status === 'critical').length;

      const response: any = {
        timestamp: new Date().toISOString(),
        fleet: {
          total: allTelemetry.length,
          online: onlineDevices.length,
          offline: offlineDevices.length,
          active: activeDevices.length,
          moving: movingDevices.length,
          parked: onlineDevices.length - movingDevices.length,
          avgBatteryVoltage: Math.round(avgBattery * 10) / 10,
          avgSpeed: Math.round(avgSpeed),
          health: {
            avgScore: Math.round(avgHealth),
            healthy: healthyDevices,
            warning: warningDevices,
            critical: criticalDevices
          }
        },
        devices: allTelemetry.sort((a, b) => a.deviceName.localeCompare(b.deviceName)),
        thresholds: THRESHOLDS,
        source: hasSupabase && dbTelemetry.size > 0
          ? 'Piston Labs Teltonika Fleet (Supabase - Live)'
          : 'Piston Labs Teltonika Fleet (Redis Cache)',
        supabaseEnabled: !!hasSupabase,
        supabaseUrl: SUPABASE_URL ? 'set' : 'missing',
        supabaseKey: SUPABASE_KEY ? 'set' : 'missing'
      };

      if (includeAlerts === 'true') {
        response.alerts = allAlerts;
        response.alertSummary = {
          total: allAlerts.length,
          critical: allAlerts.filter(a => a.severity === 'critical').length,
          warning: allAlerts.filter(a => a.severity === 'warning').length,
          info: allAlerts.filter(a => a.severity === 'info').length
        };
      }

      return res.json(response);
    }

    // POST: Update telemetry
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { imei, metrics, position, status } = body;

      if (!imei) {
        return res.status(400).json({ error: 'imei is required' });
      }

      const existing = await redis.hget(TELEMETRY_KEY, imei);
      const existingData = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : {};
      const profile = DEVICE_PROFILES[imei] || { name: `Device ${imei.slice(-4)}` };

      const baseTelemetry = {
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

      const health = calculateHealth(baseTelemetry);
      const updatedTelemetry = { ...baseTelemetry, health };

      await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(updatedTelemetry) });
      await storeHistoryPoint(imei, updatedTelemetry);

      // Check for alerts
      const alerts = generateAlerts(updatedTelemetry);

      return res.json({ success: true, telemetry: updatedTelemetry, alerts });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Telemetry API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
