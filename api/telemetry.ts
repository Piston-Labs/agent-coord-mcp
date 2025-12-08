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
 * Data source: Teltonika FMM00A devices via AWS IoT Core pipeline
 * Pipeline: Teltonika FMM00A → Soracom LTE → AWS IoT Core → Lambda → [S3, TimescaleDB, Supabase]
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
    name: 'Toyota Tacoma',
    description: 'Production deployment vehicle',
    vin: '5TELU42N88Z495934',  // Verified from AVL 256
    make: 'Toyota',
    model: 'Tacoma',
    year: 2008,
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: true  // Live - transmitting (verified Dec 8 2025)
  },
  '862464068525638': {
    name: 'Lexus RX 350',
    description: 'Production deployment vehicle - 3.5L V6 AWD 270hp',
    vin: '2T2BK1BA5FC336915',  // Verified from AVL 256, decoded via NHTSA
    make: 'Lexus',
    model: 'RX 350',  // Corrected from NX - VIN decodes to RX
    year: 2015,
    baseLat: 38.590862,  // Updated to actual location (Sacramento area)
    baseLng: -121.29048,
    isActive: true  // Live - transmitting (verified Dec 8 2025)
  },
  '862464068597504': {
    name: 'OBD2 Emulator',
    description: 'Feature development with OBD2 emulator - testing new telemetry parameters',
    owner: 'Tom (Hardware & IoT)',
    baseLat: 33.4484,
    baseLng: -112.0740,
    isActive: true,  // Live - transmitting (verified Dec 4 2025)
  },
  '862464068558217': {
    name: 'Subaru Legacy (Pug)',
    description: 'Beta testing - real-world driving data collection',
    make: 'Subaru',
    model: 'Legacy',
    year: 1997,
    owner: 'Pug',
    baseLat: 38.567,  // Updated to actual location (Sacramento)
    baseLng: -121.495,
    isActive: true  // Live - transmitting (verified Dec 8 2025) - No VIN (OBD-I era)
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
        vin: (stored as any).vin || profile.vin,  // Prefer live VIN from AVL 256
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
    // Supabase table columns: time, imei, latitude, longitude, speed_kmh,
    //   external_voltage_mv, internal_voltage_mv, ignition, movement, odometer_m, vin
    const url = `${SUPABASE_URL}/rest/v1/${TELEMETRY_TABLE}?imei=eq.${imei}&order=time.desc&limit=1`;
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
    // Column names from teltonika-context-system Lambda:
    //   time, imei, latitude, longitude, speed_kmh, external_voltage_mv,
    //   internal_voltage_mv, ignition, movement, odometer_m, vin

    // Convert millivolts to volts for voltage readings
    const externalVoltageMv = parseFloat(row.external_voltage_mv || '0');
    const internalVoltageMv = parseFloat(row.internal_voltage_mv || '0');
    const externalVoltage = externalVoltageMv / 1000;  // mV to V
    const internalVoltage = internalVoltageMv / 1000;  // mV to V (battery)

    // Convert speed from km/h (already in correct unit)
    const speedKmh = parseFloat(row.speed_kmh || '0');

    // Convert odometer from meters to km
    const odometerM = parseFloat(row.odometer_m || '0');
    const odometerKm = odometerM / 1000;

    // Timestamp from 'time' column
    const timestamp = row.time || new Date().toISOString();

    return {
      imei,
      vehicleInfo: {
        vin: row.vin,
      },
      metrics: {
        batteryVoltage: internalVoltage > 0 ? internalVoltage : externalVoltage,
        externalVoltage: externalVoltage,
        speed: speedKmh,
        odometer: odometerKm,
        fuelLevel: row.fuel_level ? parseFloat(row.fuel_level) : undefined,
        engineRPM: row.engine_rpm ? parseFloat(row.engine_rpm) : undefined,
        coolantTemp: row.coolant_temp ? parseFloat(row.coolant_temp) : undefined,
      },
      position: {
        lat: parseFloat(row.latitude || '0'),
        lng: parseFloat(row.longitude || '0'),
        altitude: row.altitude ? parseFloat(row.altitude) : undefined,
        heading: row.heading || row.angle ? parseFloat(row.heading || row.angle) : undefined,
        satellites: row.satellites ? parseInt(row.satellites) : undefined,
      },
      status: {
        ignition: row.ignition === true || row.ignition === 1 || row.ignition === 'on',
        movement: row.movement === true || row.movement === 1 || speedKmh > 0,
        gpsValid: parseFloat(row.latitude || '0') !== 0 && parseFloat(row.longitude || '0') !== 0,
        charging: externalVoltage > 13.5,
      },
      connectivity: {
        signalStrength: parseInt(row.gsm_signal || row.signal_strength || '3'),
        carrier: row.carrier || row.operator,
        lastSeen: timestamp,
      },
      timestamp: timestamp,
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
    // Use correct column names: time, speed_kmh, latitude, longitude, external_voltage_mv, internal_voltage_mv, ignition
    const url = `${SUPABASE_URL}/rest/v1/${TELEMETRY_TABLE}?imei=eq.${imei}&order=time.desc&limit=${limit}&select=time,speed_kmh,latitude,longitude,external_voltage_mv,internal_voltage_mv,ignition`;
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
    return rows.map((row: any) => {
      const internalVoltage = parseFloat(row.internal_voltage_mv || '0') / 1000;
      const externalVoltage = parseFloat(row.external_voltage_mv || '0') / 1000;
      return {
        timestamp: row.time,
        speed: parseFloat(row.speed_kmh || '0'),
        lat: parseFloat(row.latitude || '0'),
        lng: parseFloat(row.longitude || '0'),
        battery: internalVoltage > 0 ? internalVoltage : externalVoltage,
        fuel: row.fuel_level ? parseFloat(row.fuel_level) : undefined,
        ignition: row.ignition,
      };
    });
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
    // Try today first, then yesterday if no files found (timezone handling)
    const now = new Date();
    const dates = [
      now,
      new Date(now.getTime() - 24 * 60 * 60 * 1000) // Yesterday
    ];

    for (const date of dates) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');

      const prefix = `${imei}/${year}/${month}/${day}/`;

      // FIX: Use StartAfter to skip to recent files instead of listing all
      // S3 ListObjectsV2 returns files sorted by key ascending, so with MaxKeys=1000
      // we'd only get the oldest 1000 files. Instead, calculate a StartAfter key
      // based on timestamp from ~2 hours ago to get recent files.
      const twoHoursAgo = now.getTime() - (2 * 60 * 60 * 1000);
      const startAfterKey = `${imei}/${year}/${month}/${day}/${twoHoursAgo}`;

      const command = new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        MaxKeys: 100, // We only need a few recent files
        StartAfter: startAfterKey, // Skip to files after this key (recent timestamps)
      });

      const response = await s3.send(command);
      let files = (response.Contents || [])
        .map(obj => obj.Key || '')
        .filter(Boolean);

      // If no files in last 2 hours, fall back to listing without StartAfter
      // but use pagination to get the LAST page of results
      if (files.length === 0) {
        // List without StartAfter to check if any files exist
        const fallbackCommand = new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: prefix,
          MaxKeys: 1000,
        });
        const fallbackResponse = await s3.send(fallbackCommand);
        files = (fallbackResponse.Contents || [])
          .map(obj => obj.Key || '')
          .filter(Boolean);
      }

      // Sort by filename (timestamp) descending to get newest first
      files.sort().reverse();
      files = files.slice(0, limit);

      if (files.length > 0) {
        console.log(`[telemetry] Found ${files.length} S3 files for ${imei} in ${prefix}, newest: ${files[0]}`);
        return files;
      }
    }

    console.log(`[telemetry] No S3 files found for ${imei} in last 2 days`);
    return [];
  } catch (err) {
    console.error(`[telemetry] S3 list failed for ${imei}:`, err);
    return [];
  }
}

// ============================================================================
// S3 Direct Telemetry Parsing (AWS IoT Core → S3 raw data)
// Parses Teltonika codec fields from raw S3 JSON files
// ============================================================================

// Teltonika AVL ID to field name mapping (from FMC130/FMM00A protocol docs)
const TELTONIKA_FIELDS: Record<string, string> = {
  '66': 'externalVoltage',     // External voltage (mV)
  '67': 'batteryVoltage',      // Internal battery voltage (mV)
  '68': 'batteryCurrentmA',    // Battery current (mA)
  '69': 'ignition',            // Ignition on/off
  '83': 'fuelLevelPercent',    // OBD Fuel level (0-100%)
  '84': 'fuelLevelLiters',     // Fuel level (×0.1 liters)
  '181': 'gpsSignal',          // GNSS PDOP
  '182': 'gpsHDOP',            // GNSS HDOP
  '199': 'tripOdometer',       // Trip odometer (m)
  '200': 'movement',           // Movement sensor
  '21': 'gsmSignal',           // GSM signal strength
  '239': 'ignitionState',      // Ignition state
  '240': 'movement2',          // Movement (DIN1)
  '241': 'operatorCode',       // GSM operator code
  '24': 'speedKmh',            // Speed from GPS
  '16': 'odometer',            // Total odometer (m)
  '256': 'vin',                // Vehicle Identification Number (OBD)
  '449': 'engineRpm',          // Engine RPM (from OBD)
};

interface RawTeltonikaRecord {
  state: {
    reported: {
      ts: number;        // Timestamp (epoch ms)
      pr?: number;       // Priority
      latlng: string;    // "lat,lng"
      alt?: number;      // Altitude (m)
      ang?: number;      // Heading/angle (degrees)
      sat?: number;      // Satellites
      sp?: number;       // Speed (km/h)
      evt?: number;      // Event ID
      [key: string]: any; // AVL data fields (66, 67, 69, etc.)
    };
  };
  topic?: string;
}

// Parse raw S3 Teltonika record into TelemetryData format
function parseS3TeltonikaRecord(raw: RawTeltonikaRecord, imei: string): Partial<TelemetryData> | null {
  try {
    const reported = raw.state?.reported;
    if (!reported) return null;

    // Parse lat/lng from "lat,lng" format
    const [latStr, lngStr] = (reported.latlng || '0,0').split(',');
    const lat = parseFloat(latStr) || 0;
    const lng = parseFloat(lngStr) || 0;

    // Parse voltages from mV to V
    const externalVoltageMv = reported['66'] || 0;
    const internalVoltageMv = reported['67'] || reported['66'] || 0; // Fallback to external
    const externalVoltage = externalVoltageMv / 1000;
    const batteryVoltage = internalVoltageMv / 1000;

    // Parse ignition (69 = 1 means on)
    const ignition = reported['69'] === 1 || reported.ignition === 1;

    // Parse movement
    const movement = reported['200'] === 1 || (reported.sp || 0) > 0;

    // Parse GSM signal strength (0-5 scale typically)
    const gsmSignal = reported['21'] || 3;

    // Parse odometer from meters to km
    const odometerM = reported['16'] || 0;
    const odometerKm = odometerM / 1000;

    // Timestamp
    const timestamp = reported.ts
      ? new Date(reported.ts).toISOString()
      : new Date().toISOString();

    // Parse VIN from AVL ID 256 (only present when ignition is ON)
    const vin = reported['256'] || undefined;

    // Parse fuel level from AVL IDs 83 (%) or 84 (liters * 0.1)
    const fuelLevelPercent = reported['83'];
    const fuelLevelLiters = reported['84'] ? reported['84'] * 0.1 : undefined;
    const fuelLevel = fuelLevelPercent ?? fuelLevelLiters;

    // Parse engine RPM from AVL ID 449
    const engineRPM = reported['449'] || undefined;

    return {
      imei,
      vin,  // Include VIN if present
      metrics: {
        batteryVoltage: batteryVoltage > 0 ? batteryVoltage : externalVoltage,
        externalVoltage,
        speed: reported.sp || 0,
        odometer: odometerKm,
        fuelLevel,
        engineRPM,
      },
      position: {
        lat,
        lng,
        altitude: reported.alt,
        heading: reported.ang,
        satellites: reported.sat || 0,
      },
      status: {
        ignition,
        movement,
        gpsValid: lat !== 0 && lng !== 0 && (reported.sat || 0) >= 3,
        charging: externalVoltage > 13.5,
      },
      connectivity: {
        signalStrength: Math.min(5, Math.max(0, Math.round(gsmSignal / 6))), // Normalize to 0-5
        lastSeen: timestamp,
      },
      timestamp,
    };
  } catch (err) {
    console.error(`[telemetry] Failed to parse S3 record for ${imei}:`, err);
    return null;
  }
}

// Fetch and parse the most recent S3 telemetry for a device
async function fetchLatestS3Telemetry(imei: string): Promise<Partial<TelemetryData> | null> {
  if (!s3) {
    console.log(`[telemetry] S3 not configured, skipping S3 fetch for ${imei}`);
    return null;
  }

  try {
    // Get list of recent files
    const files = await getS3TelemetryFiles(imei, 1);
    if (files.length === 0) {
      console.log(`[telemetry] No S3 files found for ${imei}`);
      return null;
    }

    // Fetch the most recent file
    const latestKey = files[0];
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: latestKey,
    });

    const response = await s3.send(command);
    const bodyStr = await response.Body?.transformToString();
    if (!bodyStr) return null;

    const rawRecord: RawTeltonikaRecord = JSON.parse(bodyStr);
    const parsed = parseS3TeltonikaRecord(rawRecord, imei);

    if (parsed) {
      console.log(`[telemetry] Fetched S3 data for ${imei}: lat=${parsed.position?.lat}, lng=${parsed.position?.lng}, speed=${parsed.metrics?.speed}`);
    }

    return parsed;
  } catch (err) {
    console.error(`[telemetry] S3 fetch failed for ${imei}:`, err);
    return null;
  }
}

// Sync all devices from S3 to Redis (for dashboard real-time updates)
async function syncAllDevicesFromS3(): Promise<Map<string, Partial<TelemetryData>>> {
  const results = new Map<string, Partial<TelemetryData>>();

  if (!s3) return results;

  console.log('[telemetry] Syncing all devices from S3...');

  // Fetch in parallel for all known devices
  const syncPromises = Object.keys(DEVICE_PROFILES).map(async (imei) => {
    const data = await fetchLatestS3Telemetry(imei);
    if (data) {
      results.set(imei, data);
      // Cache to Redis for fast subsequent access
      await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(data) });
    }
  });

  await Promise.all(syncPromises);
  console.log(`[telemetry] Synced ${results.size} devices from S3`);

  return results;
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
      const { imei, history, alerts: includeAlerts, debug } = req.query;

      // Debug mode - show S3 diagnostics (gated by DEBUG_MODE env var)
      if (debug === 'true' && process.env.DEBUG_MODE === 'true') {
        const now = new Date();
        const testImei = '862464068558217'; // Beta Tester Pug
        const dates = [
          { date: now, label: 'today' },
          { date: new Date(now.getTime() - 24 * 60 * 60 * 1000), label: 'yesterday' }
        ];

        const s3Paths: any[] = [];
        for (const { date, label } of dates) {
          const year = date.getUTCFullYear();
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          const prefix = `${testImei}/${year}/${month}/${day}/`;

          let fileCount = 0;
          let files: string[] = [];
          let error: string | null = null;

          if (s3) {
            try {
              const command = new ListObjectsV2Command({
                Bucket: S3_BUCKET,
                Prefix: prefix,
                MaxKeys: 1000,
              });
              const response = await s3.send(command);
              const allFiles = (response.Contents || []).map(obj => obj.Key || '').filter(Boolean);
              files = allFiles.sort().reverse().slice(0, 5); // Get newest 5
              fileCount = allFiles.length;
            } catch (err) {
              error = String(err);
            }
          }

          s3Paths.push({ label, prefix, bucket: S3_BUCKET, fileCount, files, error });
        }

        return res.json({
          debug: true,
          timestamp: now.toISOString(),
          utcDate: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`,
          s3Configured: !!s3,
          awsRegion: process.env.AWS_REGION || 'not set',
          s3Bucket: S3_BUCKET,
          testImei,
          s3Paths,
          hasAWSCredentials: !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY
        });
      }

      // Get specific device
      if (imei && typeof imei === 'string') {
        // Data source priority: S3 (freshest) > Supabase > Redis (cache)
        let storedData: Partial<TelemetryData> | undefined;
        let dataSource = 'none';

        // Try S3 first for real-time AWS IoT data
        if (s3) {
          const s3Data = await fetchLatestS3Telemetry(imei);
          if (s3Data) {
            storedData = s3Data;
            dataSource = 's3';
            // Cache in Redis for faster subsequent access
            await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(s3Data) });
          }
        }

        // Fall back to Supabase if no S3 data
        if (!storedData && hasSupabase) {
          const supabaseData = await querySupabaseTelemetry(imei);
          if (supabaseData) {
            storedData = supabaseData;
            dataSource = 'supabase';
            await redis.hset(TELEMETRY_KEY, { [imei]: JSON.stringify(supabaseData) });
          }
        }

        // Fall back to Redis cache if no S3/Supabase data
        if (!storedData) {
          const stored = await redis.hget(TELEMETRY_KEY, imei);
          storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;
          if (storedData) dataSource = 'redis';
        }

        const telemetry = generateTelemetry(imei, storedData);
        await storeHistoryPoint(imei, telemetry);

        const response: any = {
          telemetry,
          source: dataSource,
          s3Enabled: !!s3,
          supabaseEnabled: !!hasSupabase
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
      // Data source priority: S3 (freshest) > Supabase > Redis (cache)
      let s3Telemetry: Map<string, Partial<TelemetryData>> = new Map();
      let dbTelemetry: Map<string, Partial<TelemetryData>> = new Map();

      // Try S3 first for real-time AWS IoT data (direct from devices)
      if (s3) {
        s3Telemetry = await syncAllDevicesFromS3();
      }

      // Fill gaps with Supabase data
      if (hasSupabase) {
        dbTelemetry = await queryAllSupabaseTelemetry();
      }

      const storedTelemetry = await redis.hgetall(TELEMETRY_KEY) || {};
      const allTelemetry: TelemetryData[] = [];
      const allAlerts: TelemetryAlert[] = [];
      let s3Count = 0, supabaseCount = 0, redisCount = 0;

      for (const deviceImei of Object.keys(DEVICE_PROFILES)) {
        // Priority: S3 > Supabase > Redis
        let storedData: Partial<TelemetryData> | undefined = s3Telemetry.get(deviceImei);

        if (storedData) {
          s3Count++;
        } else {
          storedData = dbTelemetry.get(deviceImei);
          if (storedData) {
            supabaseCount++;
            await redis.hset(TELEMETRY_KEY, { [deviceImei]: JSON.stringify(storedData) });
          } else {
            const stored = storedTelemetry[deviceImei];
            storedData = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : undefined;
            if (storedData) redisCount++;
          }
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

      // Determine primary data source for status display
      const primarySource = s3Count > 0
        ? 'Piston Labs Teltonika Fleet (AWS S3 - Live)'
        : (supabaseCount > 0
          ? 'Piston Labs Teltonika Fleet (Supabase - Live)'
          : 'Piston Labs Teltonika Fleet (Redis Cache)');

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
        source: primarySource,
        dataSources: {
          s3: { enabled: !!s3, count: s3Count, bucket: S3_BUCKET },
          supabase: { enabled: !!hasSupabase, count: supabaseCount },
          redis: { enabled: true, count: redisCount }
        },
        s3Enabled: !!s3,
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
