const fs = require('fs');
const https = require('https');

const API_BASE = 'https://agent-coord-mcp.vercel.app/api/productboard';

// Component IDs by product
const consumerComponents = {
  'Device Pairing & Management': 'a8cb3849-b095-4f12-84b4-dbf94e050eed',
  'Vehicle Profile & Health': 'b81885e8-f282-4c99-bed3-ba3792436dcc',
  'Service History': '4b4847c4-c31b-4702-9a94-41b926a68672',
  'Notifications & Reminders': '3efc1862-1911-4a50-8a7a-663ebbb832d0',
  'Shop Discovery & Booking': '9f34a3e1-53a7-44b0-9fe8-692f5e30ba4b',
  'User Account': 'e94c0b94-ce35-4127-8495-778f193a1596'
};

const shopComponents = {
  'PDF Upload & Processing': '8ad3c3e1-ee3f-459d-83e9-36f13a3b70af',
  'Customer Management': '7aadc725-b4ab-4257-9d31-96761170f538',
  'Appointment Calendar': '5405e7b3-8c03-4fc0-9f28-ee674d48e5ab',
  'Promotions Engine': '46b396c4-b7a4-484d-834b-f5bc49e9a3d7',
  'Analytics Dashboard': 'd478fa65-f20e-453e-a434-905ae6da2b68',
  'Settings & Integrations': '94f7858e-d37c-47e6-82c7-9149bb196185'
};

const carteldbComponents = {
  'Telemetry Pipeline': '12ddb3df-4a3e-496a-a311-ad3b99537400',
  'VIN Services': 'fa347a54-6f79-491f-a5e9-757c2fb531af',
  'PDF Parsing Engine': '4414d5ad-ca9c-42a4-bf65-147d7103568c',
  'Relationship Manager': 'e2527bfe-e77d-458c-9eca-cbedac8e5e00',
  'Notification Engine': 'ec432c3c-bf5a-4ab0-b569-344bf8e58e46',
  'API Gateway': '472a2873-41bd-4137-85e8-a3cf99c2a83d',
  'Data & Analytics': 'bf9ecd4c-d797-4378-8123-3fec3062b0f6'
};

// Keyword mappings for Consumer App
const consumerMapping = {
  'Onboarding': 'Device Pairing & Management',
  'Device Pairing': 'Device Pairing & Management',
  'Vehicle Health Dashboard': 'Vehicle Profile & Health',
  'Service History': 'Service History',
  'Service Reminders': 'Notifications & Reminders',
  'Shop Preference': 'Shop Discovery & Booking',
  'Appointment Scheduling': 'Shop Discovery & Booking',
  'Promotion Engine': 'Notifications & Reminders',
  'User Profile': 'User Account',
  'Subscription': 'User Account'
};

// Keyword mappings for Shop Dashboard
const shopMapping = {
  'PDF Upload': 'PDF Upload & Processing',
  'Repair Order': 'PDF Upload & Processing',
  'Document Processing': 'PDF Upload & Processing',
  'Customer Management': 'Customer Management',
  'Customer Profile': 'Customer Management',
  'VIN-Linked': 'Customer Management',
  'Customer List': 'Customer Management',
  'Appointment': 'Appointment Calendar',
  'Calendar': 'Appointment Calendar',
  'Scheduling': 'Appointment Calendar',
  'Availability': 'Appointment Calendar',
  'Promotion': 'Promotions Engine',
  'Discount': 'Promotions Engine',
  'Campaign': 'Promotions Engine',
  'Analytics': 'Analytics Dashboard',
  'Reports': 'Analytics Dashboard',
  'Metrics': 'Analytics Dashboard',
  'Dashboard': 'Analytics Dashboard',
  'Settings': 'Settings & Integrations',
  'Integration': 'Settings & Integrations',
  'CRM Integration': 'Settings & Integrations',
  'Team Management': 'Settings & Integrations',
  'Billing': 'Settings & Integrations'
};

// Keyword mappings for CarTelDB
const carteldbMapping = {
  'Telemetry': 'Telemetry Pipeline',
  'IoT Core': 'Telemetry Pipeline',
  'Lambda': 'Telemetry Pipeline',
  'Device Data': 'Telemetry Pipeline',
  'MQTT': 'Telemetry Pipeline',
  'VIN Decod': 'VIN Services',
  'Vehicle Identification': 'VIN Services',
  'Make/Model': 'VIN Services',
  'PDF Pars': 'PDF Parsing Engine',
  'Textract': 'PDF Parsing Engine',
  'Repair Order Extract': 'PDF Parsing Engine',
  'Document Processing': 'PDF Parsing Engine',
  'Relationship': 'Relationship Manager',
  'Customer-Shop': 'Relationship Manager',
  'Access Control': 'Relationship Manager',
  'Data Privacy': 'Relationship Manager',
  'Notification': 'Notification Engine',
  'Push': 'Notification Engine',
  'Reminder Trigger': 'Notification Engine',
  'Mileage Calculation': 'Notification Engine',
  'API': 'API Gateway',
  'REST': 'API Gateway',
  'GraphQL': 'API Gateway',
  'Endpoint': 'API Gateway',
  'Authentication': 'API Gateway',
  'Database': 'Data & Analytics',
  'DynamoDB': 'Data & Analytics',
  'Timescale': 'Data & Analytics',
  'Storage': 'Data & Analytics',
  'Query': 'Data & Analytics',
  'Report': 'Data & Analytics'
};

function mapFeature(feature, mapping, components) {
  const desc = (feature.description || '') + ' ' + (feature.name || '');

  for (const [keyword, compName] of Object.entries(mapping)) {
    if (desc.toLowerCase().includes(keyword.toLowerCase())) {
      return { componentId: components[compName], componentName: compName };
    }
  }
  return null;
}

async function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function deleteFeature(featureId) {
  return fetch(`${API_BASE}?action=delete-feature&featureId=${featureId}`, {
    method: 'DELETE'
  });
}

async function createFeature(name, description, componentId, status) {
  // Only use status ID, not name
  const statusPayload = status && status.id ? { id: status.id } : undefined;

  return fetch(`${API_BASE}?action=create-feature`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description,
      parent: { component: { id: componentId } },
      status: statusPayload
    })
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const product = process.argv[2];
  const inputFile = process.argv[3];

  if (!product || !inputFile) {
    console.log('Usage: node migrate-features.cjs <consumer|shop|carteldb> <features.json>');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  let mapping, components;
  if (product === 'consumer') {
    mapping = consumerMapping;
    components = consumerComponents;
  } else if (product === 'shop') {
    mapping = shopMapping;
    components = shopComponents;
  } else if (product === 'carteldb') {
    mapping = carteldbMapping;
    components = carteldbComponents;
  }

  console.log(`Processing ${data.features.length} features for ${product}...`);

  for (const feature of data.features) {
    const match = mapFeature(feature, mapping, components);

    if (!match) {
      console.log(`SKIP (unmapped): ${feature.name}`);
      continue;
    }

    // Delete old feature
    console.log(`DELETE: ${feature.name}`);
    await deleteFeature(feature.id);
    await sleep(200);

    // Create new feature under component
    console.log(`CREATE: ${feature.name} -> ${match.componentName}`);
    const result = await createFeature(
      feature.name,
      feature.description,
      match.componentId,
      feature.status
    );

    if (result.success) {
      console.log(`  OK: ${result.created.id}`);
    } else {
      console.log(`  ERROR:`, result);
    }

    await sleep(200);
  }

  console.log('Done!');
}

main().catch(console.error);
