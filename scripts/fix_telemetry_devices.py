with open('api/telemetry.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the fake DEVICE_PROFILES with real verified fleet devices
old_profiles = '''// Known devices - Fleet of 8 vehicles for comprehensive dashboard demo
const DEVICE_PROFILES: Record<string, { name: string; vin?: string; make?: string; model?: string; year?: number; baseLat: number; baseLng: number }> = {
  '862464068511489': {
    name: 'Fleet-01 Honda',
    vin: '1HGBH41JXMN109186',
    make: 'Honda',
    model: 'Accord',
    year: 2024,
    baseLat: 40.7128,
    baseLng: -74.0060
  },
  '862464068525638': {
    name: 'Fleet-02 Toyota',
    vin: '4T1BF1FK5HU123456',
    make: 'Toyota',
    model: 'Camry',
    year: 2023,
    baseLat: 34.0522,
    baseLng: -118.2437
  },
  '862464068558217': {
    name: 'Fleet-03 Lexus',
    vin: 'JTHBA1D20L5012345',
    make: 'Lexus',
    model: 'ES350',
    year: 2022,
    baseLat: 33.4484,
    baseLng: -112.0740
  },
  '862464068597504': {
    name: 'Fleet-04 BMW',
    vin: 'WBA3A5C51DF123456',
    make: 'BMW',
    model: '328i',
    year: 2021,
    baseLat: 41.8781,
    baseLng: -87.6298
  },
  '862464068612345': {
    name: 'Fleet-05 Tesla',
    vin: '5YJ3E1EA1LF123456',
    make: 'Tesla',
    model: 'Model 3',
    year: 2024,
    baseLat: 37.7749,
    baseLng: -122.4194
  },
  '862464068623456': {
    name: 'Fleet-06 Ford',
    vin: '1FA6P8TH5L5123456',
    make: 'Ford',
    model: 'Mustang',
    year: 2023,
    baseLat: 42.3601,
    baseLng: -71.0589
  },
  '862464068634567': {
    name: 'Fleet-07 Chevy',
    vin: '1G1YY22G965123456',
    make: 'Chevrolet',
    model: 'Corvette',
    year: 2022,
    baseLat: 29.7604,
    baseLng: -95.3698
  },
  '862464068645678': {
    name: 'Fleet-08 Mercedes',
    vin: 'WDDWF8DB5LA123456',
    make: 'Mercedes-Benz',
    model: 'C300',
    year: 2024,
    baseLat: 47.6062,
    baseLng: -122.3321
  }
};'''

# Real verified Piston Labs fleet from teltonika-context-system
new_profiles = '''// REAL Piston Labs Fleet - Verified Active Teltonika Devices from AWS IoT Core
// Source: teltonika-context-system/context/technical/devices.md
// Last verified: November 26, 2025
//
// NOTE: Only these 5 devices are verified active in production.
// Do NOT add fake test data from gran-autismo or other sources.
const DEVICE_PROFILES: Record<string, { name: string; description?: string; vin?: string; make?: string; model?: string; year?: number; owner?: string; baseLat: number; baseLng: number }> = {
  '862464068525406': {
    name: 'Test Device',
    description: 'Workbench/temporary vehicles - testing before production deployment',
    owner: 'Piston Labs',
    baseLat: 33.4484,
    baseLng: -112.0740
  },
  '862464068511489': {
    name: 'Toyota',
    description: 'Production deployment vehicle',
    make: 'Toyota',
    year: 2008,
    baseLat: 33.4484,
    baseLng: -112.0740
  },
  '862464068525638': {
    name: 'Lexus NX',
    description: 'Production deployment vehicle',
    make: 'Lexus',
    model: 'NX',
    year: 2015,
    baseLat: 33.4484,
    baseLng: -112.0740
  },
  '862464068597504': {
    name: 'OBD2 Emulator',
    description: 'Feature development with OBD2 emulator - testing new telemetry parameters',
    owner: 'Tom (Hardware & IoT)',
    baseLat: 33.4484,
    baseLng: -112.0740
  },
  '862464068558217': {
    name: 'Beta Tester (Pug)',
    description: 'Beta testing - real-world driving data collection',
    owner: 'Pug',
    baseLat: 33.4484,
    baseLng: -112.0740
  }
};'''

if old_profiles in content:
    content = content.replace(old_profiles, new_profiles)
    print('Replaced DEVICE_PROFILES with verified fleet devices')
else:
    print('Could not find old DEVICE_PROFILES pattern')
    # Try partial match
    if "'862464068612345'" in content:
        print('Found fake device 862464068612345 - need manual fix')

# Also update the API header comment to clarify data source
old_comment = '''/**
 * Device Telemetry API - Real-time vehicle analytics with health monitoring
 *
 * GET /api/telemetry - Get telemetry for all devices with health scores'''

new_comment = '''/**
 * Device Telemetry API - Real-time vehicle analytics with health monitoring
 *
 * Data source: Teltonika GPS devices via AWS IoT Core pipeline (teltonika-context-system)
 * Only shows verified active devices from production fleet - no test data from gran-autismo
 *
 * GET /api/telemetry - Get telemetry for all devices with health scores'''

if old_comment in content:
    content = content.replace(old_comment, new_comment)
    print('Updated API header comment')

# Add source field to the response
old_response = '''        thresholds: THRESHOLDS
      };'''

new_response = '''        thresholds: THRESHOLDS,
        source: 'Piston Labs Teltonika Fleet (AWS IoT Core)'
      };'''

if old_response in content:
    content = content.replace(old_response, new_response)
    print('Added source field to response')

with open('api/telemetry.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
