#!/usr/bin/env python3
"""Fix telemetry API to handle offline devices correctly."""

with open('api/telemetry.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Update generateTelemetry to handle offline devices
old_generate = '''// Generate realistic telemetry
function generateTelemetry(imei: string, stored?: Partial<TelemetryData>): TelemetryData {
  const profile = DEVICE_PROFILES[imei] || {
    name: `Device ${imei.slice(-4)}`,
    baseLat: 39.8283,
    baseLng: -98.5795
  };

  const now = new Date();
  const hour = now.getHours();

  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
  const isNightTime = hour >= 22 || hour <= 5;

  const movementFactor = Math.sin(Date.now() / 60000) * 0.001;
  const ignitionProbability = isNightTime ? 0.1 : (isRushHour ? 0.7 : 0.4);
  const isIgnitionOn = Math.random() < ignitionProbability;

  const baseSpeed = isIgnitionOn ? (isRushHour ? 25 : 45) : 0;
  const speedVariation = isIgnitionOn ? Math.random() * 30 : 0;
  const speed = Math.round(baseSpeed + speedVariation);

  const batteryBase = isIgnitionOn ? 13.8 : 12.4;
  const batteryVariation = (Math.random() - 0.5) * 0.6;
  const batteryVoltage = Math.round((batteryBase + batteryVariation) * 10) / 10;

  const externalBase = isIgnitionOn ? 14.2 : 12.6;
  const externalVariation = (Math.random() - 0.5) * 0.4;
  const externalVoltage = Math.round((externalBase + externalVariation) * 10) / 10;

  const lat = profile.baseLat + movementFactor + (Math.random() - 0.5) * 0.01;
  const lng = profile.baseLng + movementFactor + (Math.random() - 0.5) * 0.01;

  const storedOdometer = stored?.metrics?.odometer || Math.floor(Math.random() * 50000) + 10000;
  const odometerIncrement = isIgnitionOn ? Math.random() * 0.5 : 0;

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
      batteryVoltage,
      externalVoltage,
      speed,
      odometer: Math.round((storedOdometer + odometerIncrement) * 10) / 10,
      fuelLevel: Math.round(Math.random() * 60 + 20),
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

  const health = calculateHealth(baseTelemetry);

  return { ...baseTelemetry, health };
}'''

new_generate = '''// Generate realistic telemetry for ACTIVE devices, static data for OFFLINE devices
function generateTelemetry(imei: string, stored?: Partial<TelemetryData>): TelemetryData {
  const profile = DEVICE_PROFILES[imei] || {
    name: `Device ${imei.slice(-4)}`,
    baseLat: 39.8283,
    baseLng: -98.5795,
    isActive: false
  };

  const now = new Date();

  // Handle OFFLINE devices - show static last known data
  if (!profile.isActive) {
    const lastSeenDate = profile.lastKnownDate || now.toISOString();

    // Use stored data if available, otherwise generate static baseline
    const storedOdometer = stored?.metrics?.odometer || Math.floor(Math.random() * 50000) + 10000;

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
        batteryVoltage: stored?.metrics?.batteryVoltage || 0,  // Unknown - device offline
        externalVoltage: stored?.metrics?.externalVoltage || 0,
        speed: 0,
        odometer: storedOdometer,
        fuelLevel: stored?.metrics?.fuelLevel,
        engineRPM: 0,
        coolantTemp: stored?.metrics?.coolantTemp
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
      issues: ['Device offline - no telemetry data']
    };

    return { ...baseTelemetry, health };
  }

  // Handle ACTIVE devices - generate live telemetry
  const hour = now.getHours();
  const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
  const isNightTime = hour >= 22 || hour <= 5;

  const movementFactor = Math.sin(Date.now() / 60000) * 0.001;
  const ignitionProbability = isNightTime ? 0.1 : (isRushHour ? 0.7 : 0.4);
  const isIgnitionOn = Math.random() < ignitionProbability;

  const baseSpeed = isIgnitionOn ? (isRushHour ? 25 : 45) : 0;
  const speedVariation = isIgnitionOn ? Math.random() * 30 : 0;
  const speed = Math.round(baseSpeed + speedVariation);

  const batteryBase = isIgnitionOn ? 13.8 : 12.4;
  const batteryVariation = (Math.random() - 0.5) * 0.6;
  const batteryVoltage = Math.round((batteryBase + batteryVariation) * 10) / 10;

  const externalBase = isIgnitionOn ? 14.2 : 12.6;
  const externalVariation = (Math.random() - 0.5) * 0.4;
  const externalVoltage = Math.round((externalBase + externalVariation) * 10) / 10;

  const lat = profile.baseLat + movementFactor + (Math.random() - 0.5) * 0.01;
  const lng = profile.baseLng + movementFactor + (Math.random() - 0.5) * 0.01;

  const storedOdometer = stored?.metrics?.odometer || Math.floor(Math.random() * 50000) + 10000;
  const odometerIncrement = isIgnitionOn ? Math.random() * 0.5 : 0;

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
      batteryVoltage,
      externalVoltage,
      speed,
      odometer: Math.round((storedOdometer + odometerIncrement) * 10) / 10,
      fuelLevel: Math.round(Math.random() * 60 + 20),
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
      charging: isIgnitionOn && batteryVoltage > 13.5,
      offline: false
    },
    connectivity: {
      signalStrength: Math.round(3 + Math.random() * 2),
      carrier: ['Verizon', 'AT&T', 'T-Mobile'][Math.floor(Math.random() * 3)],
      lastSeen: now.toISOString()
    },
    timestamp: now.toISOString()
  };

  const health = calculateHealth(baseTelemetry);

  return { ...baseTelemetry, health };
}'''

if old_generate in content:
    content = content.replace(old_generate, new_generate)
    print('Updated generateTelemetry to handle offline devices')
else:
    print('Could not find old generateTelemetry pattern - may need manual fix')

# Also update the status interface to include offline flag
old_status = '''  status: {
    ignition: boolean;
    movement: boolean;
    gpsValid: boolean;
    charging: boolean;
  };'''

new_status = '''  status: {
    ignition: boolean;
    movement: boolean;
    gpsValid: boolean;
    charging: boolean;
    offline?: boolean;
  };'''

if old_status in content:
    content = content.replace(old_status, new_status)
    print('Added offline flag to status interface')

# Update fleet summary to count online vs offline
old_fleet = '''      // Fleet summary with health
      const activeDevices = allTelemetry.filter(t => t.status.ignition);
      const movingDevices = allTelemetry.filter(t => t.status.movement);'''

new_fleet = '''      // Fleet summary with health
      const onlineDevices = allTelemetry.filter(t => !t.status.offline);
      const offlineDevices = allTelemetry.filter(t => t.status.offline);
      const activeDevices = onlineDevices.filter(t => t.status.ignition);
      const movingDevices = onlineDevices.filter(t => t.status.movement);'''

if old_fleet in content:
    content = content.replace(old_fleet, new_fleet)
    print('Updated fleet summary to track online/offline')

# Update fleet stats to include online count
old_fleet_stats = '''        fleet: {
          total: allTelemetry.length,
          active: activeDevices.length,
          moving: movingDevices.length,
          parked: allTelemetry.length - movingDevices.length,'''

new_fleet_stats = '''        fleet: {
          total: allTelemetry.length,
          online: onlineDevices.length,
          offline: offlineDevices.length,
          active: activeDevices.length,
          moving: movingDevices.length,
          parked: onlineDevices.length - movingDevices.length,'''

if old_fleet_stats in content:
    content = content.replace(old_fleet_stats, new_fleet_stats)
    print('Updated fleet stats to include online/offline counts')

with open('api/telemetry.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
