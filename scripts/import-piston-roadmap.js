#!/usr/bin/env node

/**
 * Import Piston Labs roadmap items from teltonika-context-system punch lists
 *
 * Usage: node scripts/import-piston-roadmap.js [--prod]
 *
 * By default targets localhost:3000, use --prod for production Vercel
 */

const API_BASE = process.argv.includes('--prod')
  ? 'https://agent-coord-mcp.vercel.app/api'
  : 'http://localhost:3000/api';

console.log(`Importing to: ${API_BASE}`);

// Ryan's Consumer App + Shop Dashboard tasks (from ryan-punch-list-2025-11-26.md)
const ryanDashboardTasks = [
  // PHASE 1: Consumer Web App (Days 1-2)
  {
    title: '[P1] Profile Page - Vehicle Info Display',
    description: 'Create /profile route. Display vehicle info: Year, Make, Model, VIN (masked). Show current mileage from device telemetry with "Last Updated" timestamp.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'profile', 'phase-1']
  },
  {
    title: '[P1] Profile Page - Preferred Shop Dropdown',
    description: 'Add "Preferred Shop" dropdown to profile. Query available shops from database. Save selection to user profile. Show "No preference" as default.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'profile', 'shops', 'phase-1']
  },
  {
    title: '[P1] Service History Section',
    description: 'Create service history list component. Display: date, shop name, services performed, mileage at service, cost. Sort by date (newest first). Empty state for no records.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'service-history', 'phase-1']
  },
  {
    title: '[P1] Repair Order Upload - PDF',
    description: 'Create /upload route. PDF upload with drag-and-drop zone, file picker fallback. Accept .pdf files. Show upload progress and success/error message.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'upload', 'pdf', 'phase-1']
  },
  {
    title: '[P1] Repair Order Upload - Photo',
    description: 'Photo capture button (mobile), file picker for images. Accept .jpg, .png, .heic. Image preview before submit. Send to parsing service.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'upload', 'photo', 'phase-1']
  },
  {
    title: '[P1] Notifications View',
    description: 'Create /notifications route. Display notification list with icon, message, timestamp, read/unread status. Mark as read on click. Badge in nav.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'high',
    tags: ['consumer-app', 'notifications', 'phase-1']
  },
  {
    title: '[P1] Navigation & Mobile Layout',
    description: 'Bottom nav or sidebar: Profile, Upload, Notifications (with badge), Settings. Header with app logo. Mobile-responsive layout.',
    project: 'piston-dashboard',
    phase: 'Phase 1: Consumer App',
    assignee: 'ryan',
    priority: 'medium',
    tags: ['consumer-app', 'navigation', 'mobile', 'phase-1']
  },

  // PHASE 2: Shop Dashboard (Days 3-4)
  {
    title: '[P2] Shop Customer List View',
    description: 'Create /shop/customers route. Customer table: name, phone, vehicle (YMM), last service date/type. Row click expands details. Pagination (25/page).',
    project: 'piston-dashboard',
    phase: 'Phase 2: Shop Dashboard',
    assignee: 'ryan',
    priority: 'high',
    tags: ['shop-dashboard', 'customers', 'phase-2']
  },
  {
    title: '[P2] Shop Search & Filter',
    description: 'Search bar: name, phone, VIN, make/model. Filter dropdown: All, last 30 days, last 90 days, no service 6+ months. Clear filters button.',
    project: 'piston-dashboard',
    phase: 'Phase 2: Shop Dashboard',
    assignee: 'ryan',
    priority: 'high',
    tags: ['shop-dashboard', 'search', 'filter', 'phase-2']
  },
  {
    title: '[P2] Customer Detail View',
    description: 'Expandable row or slide-out panel. Full customer info, vehicle details with current mileage, complete service history, recommendations. Call button.',
    project: 'piston-dashboard',
    phase: 'Phase 2: Shop Dashboard',
    assignee: 'ryan',
    priority: 'high',
    tags: ['shop-dashboard', 'customer-detail', 'phase-2']
  },
  {
    title: '[P2] Shop Notifications Tab',
    description: 'Create /shop/notifications. Show: customer name, vehicle, request type, phone, timestamp. Status badges: New/Contacted/Scheduled. Filter by status.',
    project: 'piston-dashboard',
    phase: 'Phase 2: Shop Dashboard',
    assignee: 'ryan',
    priority: 'high',
    tags: ['shop-dashboard', 'notifications', 'phase-2']
  },
  {
    title: '[P2] Shop Dashboard Navigation',
    description: 'Sidebar/top nav: Customers, Notifications (with count badge), Settings. Shop name/logo in header. Live notification count updates.',
    project: 'piston-dashboard',
    phase: 'Phase 2: Shop Dashboard',
    assignee: 'ryan',
    priority: 'medium',
    tags: ['shop-dashboard', 'navigation', 'phase-2']
  },

  // PHASE 3: Notification Trigger System (Days 5-6) - THE CRITICAL PIECE
  {
    title: '[P3] Database Schema - Service Records',
    description: 'Create service_records table: id, vin, service_type, mileage_at_service, service_date, shop_id, created_at. This stores parsed repair order data.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['database', 'schema', 'phase-3']
  },
  {
    title: '[P3] Database Schema - Notifications',
    description: 'Create notifications table: id, user_id, type, service_type, message, mileage_when_sent, mileage_due_at, read, created_at.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['database', 'schema', 'notifications', 'phase-3']
  },
  {
    title: '[P3] Database Schema - Service Intervals',
    description: 'Create service_intervals config table: service_type, interval_miles (5000 for oil), notify_at_miles_remaining (1000).',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['database', 'schema', 'config', 'phase-3']
  },
  {
    title: '[P3] Mileage Check Function',
    description: 'Create checkServiceDue(vin): Get IMEI for VIN, query latest odometer from Timescale, get last oil change record, calculate miles since/until due.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['core-logic', 'mileage', 'phase-3']
  },
  {
    title: '[P3] Notification Trigger Logic',
    description: 'Create triggerServiceNotification(vin, userId): If milesUntilDue <= 1000 AND no recent notification, create notification with shop suggestion. Prevent duplicates.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['core-logic', 'notifications', 'phase-3']
  },
  {
    title: '[P3] Hourly Device Check Job',
    description: 'Lambda/cron: checkAllDevicesForService. Get active devices (reported in 24h), for each get VIN/user, run checkServiceDue, trigger if needed. Log results.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['lambda', 'cron', 'automation', 'phase-3']
  },
  {
    title: '[P3] Notification Delivery',
    description: 'Store notification in DB for web app display. Optional: browser push notification with permission request on first login.',
    project: 'piston-dashboard',
    phase: 'Phase 3: Notification Trigger',
    assignee: 'ryan',
    priority: 'high',
    tags: ['notifications', 'push', 'phase-3']
  },

  // PHASE 4: Integration Testing (Day 7)
  {
    title: '[P4] Data Flow Test',
    description: 'Verify device → Timescale pipeline. Query mileage for test device, confirm fresh data. Confirm VIN is being parsed from telemetry.',
    project: 'piston-dashboard',
    phase: 'Phase 4: Testing',
    assignee: 'ryan',
    priority: 'high',
    tags: ['testing', 'integration', 'phase-4']
  },
  {
    title: '[P4] PDF Upload Flow Test',
    description: 'Upload test PDF. Verify VIN extracted, service record created in DB, record appears in consumer history AND shop customer list.',
    project: 'piston-dashboard',
    phase: 'Phase 4: Testing',
    assignee: 'ryan',
    priority: 'high',
    tags: ['testing', 'upload', 'phase-4']
  },
  {
    title: '[P4] Account Linking Test',
    description: 'Create test consumer account, link to device IMEI, verify VIN association, verify mileage displays on consumer profile.',
    project: 'piston-dashboard',
    phase: 'Phase 4: Testing',
    assignee: 'ryan',
    priority: 'high',
    tags: ['testing', 'linking', 'phase-4']
  },
  {
    title: '[P4] Notification Trigger Test',
    description: 'Create service record at 50,000 miles. Device reports ~54,500. Run trigger. Verify notification "Oil change due in 500 miles" appears in consumer app.',
    project: 'piston-dashboard',
    phase: 'Phase 4: Testing',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['testing', 'notifications', 'phase-4']
  },
  {
    title: '[P4] End-to-End Demo',
    description: 'Full flow: Consumer login → profile with mileage → Shop uploads PDF → Record appears → Mileage increases → Notification triggers → Consumer sees "Oil change due"',
    project: 'piston-dashboard',
    phase: 'Phase 4: Testing',
    assignee: 'ryan',
    priority: 'critical',
    tags: ['testing', 'demo', 'e2e', 'phase-4']
  }
];

// Tom's Hardware/IoT tasks (from tom-hardware-punch-list-2025-11-26.md)
const tomHardwareTasks = [
  // PHASE 1: Verify Device Setup
  {
    title: '[P1] Verify Device Transmitting',
    description: 'Check device IMEI 862464068597504 is connected to OBD2 emulator, has power, MQTT connection active. Check latest telemetry in S3 and Timescale.',
    project: 'piston-hardware',
    phase: 'Phase 1: Device Setup',
    assignee: 'tom',
    priority: 'high',
    tags: ['device', 'setup', 'verification', 'phase-1']
  },
  {
    title: '[P1] Document Current IO Elements',
    description: 'Check which IO elements receiving: 256 (VIN), 389 (OBD Odometer), 16 (GPS Odometer), 239 (Ignition), 240 (Movement), 66 (External Voltage).',
    project: 'piston-hardware',
    phase: 'Phase 1: Device Setup',
    assignee: 'tom',
    priority: 'high',
    tags: ['device', 'io-elements', 'documentation', 'phase-1']
  },

  // PHASE 2: VIN Configuration
  {
    title: '[P2] Configure OBD2 Emulator VIN',
    description: 'Set test VIN in emulator (e.g., 1HGBH41JXMN109186). Ensure emulator broadcasts VIN on Mode 09 PID 02. Document test VIN.',
    project: 'piston-hardware',
    phase: 'Phase 2: VIN Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['obd2', 'vin', 'emulator', 'phase-2']
  },
  {
    title: '[P2] Configure Teltonika for VIN Capture',
    description: 'Via Configurator: Enable OBD II Data, set protocol to Auto, enable OBD II VIN. Configure IO 256 operand=OBD VIN, Send=On Change, Priority=Low/High.',
    project: 'piston-hardware',
    phase: 'Phase 2: VIN Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['teltonika', 'configurator', 'vin', 'phase-2']
  },
  {
    title: '[P2] Verify VIN in Timescale',
    description: 'Wait 1-2 min after reboot. Query: SELECT time, vin FROM telemetry WHERE imei=862464068597504 AND vin IS NOT NULL. Confirm VIN appears.',
    project: 'piston-hardware',
    phase: 'Phase 2: VIN Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['timescale', 'vin', 'verification', 'phase-2']
  },

  // PHASE 3: Odometer Configuration
  {
    title: '[P3] Configure OBD2 Emulator Odometer',
    description: 'Set test odometer to ~50000 km (~31k miles). Ensure emulator broadcasts on Mode 01 PID A6. Set up ability to increment for driving simulation.',
    project: 'piston-hardware',
    phase: 'Phase 3: Odometer Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['obd2', 'odometer', 'emulator', 'phase-3']
  },
  {
    title: '[P3] Configure Teltonika for Odometer',
    description: 'Via Configurator: Enable IO 389 (OBD Odometer) Operand=Total Mileage, Send=Periodically/On Change. Also enable IO 16 (GPS Odometer) as fallback.',
    project: 'piston-hardware',
    phase: 'Phase 3: Odometer Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['teltonika', 'configurator', 'odometer', 'phase-3']
  },
  {
    title: '[P3] Verify Odometer in Timescale',
    description: 'Query OBD odometer (IO 389) and GPS odometer (IO 16). Check odometer_m field. Verify OBD odometer preferred over GPS.',
    project: 'piston-hardware',
    phase: 'Phase 3: Odometer Config',
    assignee: 'tom',
    priority: 'critical',
    tags: ['timescale', 'odometer', 'verification', 'phase-3']
  },
  {
    title: '[P3] Test Odometer Updates',
    description: 'Simulate driving: set emulator to 50000km, wait for update, increment to 50001km, verify new value appears. Confirm delta correct (1km = 1000m).',
    project: 'piston-hardware',
    phase: 'Phase 3: Odometer Config',
    assignee: 'tom',
    priority: 'high',
    tags: ['testing', 'odometer', 'simulation', 'phase-3']
  },

  // PHASE 4: Validation
  {
    title: '[P4] VIN Validation',
    description: 'Query latest VIN from device, compare to emulator setting. Confirm exact match.',
    project: 'piston-hardware',
    phase: 'Phase 4: Validation',
    assignee: 'tom',
    priority: 'high',
    tags: ['validation', 'vin', 'phase-4']
  },
  {
    title: '[P4] Odometer Validation',
    description: 'Query latest odometer_m, convert to miles. Compare to emulator value (km * 1000 = meters). Confirm match within 1%.',
    project: 'piston-hardware',
    phase: 'Phase 4: Validation',
    assignee: 'tom',
    priority: 'high',
    tags: ['validation', 'odometer', 'phase-4']
  },
  {
    title: '[P4] Service Trigger Scenario Test',
    description: 'Set VIN to 1HGBH41JXMN109186, odometer to 80000km (~49700mi). Tell Ryan "last oil change at 45000mi". System calculates 4700mi since, triggers notification.',
    project: 'piston-hardware',
    phase: 'Phase 4: Validation',
    assignee: 'tom',
    priority: 'critical',
    tags: ['validation', 'e2e', 'trigger', 'phase-4']
  },
  {
    title: '[P4] Data Freshness Check',
    description: 'Confirm data arrives within expected interval (< 10 seconds). Query time diff: EXTRACT(EPOCH FROM (NOW() - time)).',
    project: 'piston-hardware',
    phase: 'Phase 4: Validation',
    assignee: 'tom',
    priority: 'high',
    tags: ['validation', 'freshness', 'phase-4']
  },

  // PHASE 6: Documentation & Handoff
  {
    title: '[P6] Document Test Configuration',
    description: 'Fill out: IMEI, Test VIN, Test Odometer, OBD2 Emulator settings (model, protocol, PIDs), Teltonika Configurator settings. Share with Ryan.',
    project: 'piston-hardware',
    phase: 'Phase 6: Handoff',
    assignee: 'tom',
    priority: 'high',
    tags: ['documentation', 'handoff', 'phase-6']
  },
  {
    title: '[P6] Confirm API Contract for Ryan',
    description: 'Verify Ryan can expect: {imei, time, vin (17 chars), odometer_m (int meters), ignition, movement}. Unit conversion: miles = odometer_m / 1609.34.',
    project: 'piston-hardware',
    phase: 'Phase 6: Handoff',
    assignee: 'tom',
    priority: 'high',
    tags: ['api', 'contract', 'handoff', 'phase-6']
  },
  {
    title: '[P6] Handoff Checklist Complete',
    description: 'Confirm: device transmitting every ~5s, VIN correct, odometer correct, updates when emulator changes. Ryan knows IMEI and unit conversion.',
    project: 'piston-hardware',
    phase: 'Phase 6: Handoff',
    assignee: 'tom',
    priority: 'high',
    tags: ['checklist', 'handoff', 'phase-6']
  }
];

async function importTasks() {
  console.log('\n=== Importing Ryan\'s Dashboard Tasks ===');

  try {
    const dashboardRes = await fetch(`${API_BASE}/roadmap-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: ryanDashboardTasks,
        clearProject: 'piston-dashboard'
      })
    });

    const dashboardData = await dashboardRes.json();
    console.log(`Imported ${dashboardData.imported} dashboard tasks`);
  } catch (err) {
    console.error('Dashboard import failed:', err.message);
  }

  console.log('\n=== Importing Tom\'s Hardware Tasks ===');

  try {
    const hardwareRes = await fetch(`${API_BASE}/roadmap-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: tomHardwareTasks,
        clearProject: 'piston-hardware'
      })
    });

    const hardwareData = await hardwareRes.json();
    console.log(`Imported ${hardwareData.imported} hardware tasks`);
  } catch (err) {
    console.error('Hardware import failed:', err.message);
  }

  console.log('\n=== Import Complete ===');
  console.log(`Total tasks: ${ryanDashboardTasks.length + tomHardwareTasks.length}`);
  console.log(`- Ryan (piston-dashboard): ${ryanDashboardTasks.length}`);
  console.log(`- Tom (piston-hardware): ${tomHardwareTasks.length}`);
  console.log(`\nView at: ${API_BASE.replace('/api', '')}`);
}

importTasks().catch(console.error);
