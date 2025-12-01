/**
 * Teltonika Fleet Bridge Agent
 *
 * Local agent that runs on Tyler's machine with AWS credentials.
 * Enables Ryan and Tom to interact with the Teltonika fleet via Agent Hub.
 *
 * Features:
 * - Monitors group chat for fleet commands (prefixed with /fleet or @fleet-bridge)
 * - Executes AWS IoT Core queries using local credentials
 * - Reports device status, telemetry, and provisioning results
 * - Secure: credentials never leave local machine
 *
 * Commands:
 *   /fleet status              - Fleet summary
 *   /fleet devices             - List all devices
 *   /fleet device <imei>       - Get device details
 *   /fleet telemetry <imei>    - Get recent telemetry
 *   /fleet provision <imei>    - Start provisioning workflow
 *   /fleet shadow <imei>       - Get device shadow state
 *   /fleet command <imei> <cmd> - Send command to device
 *
 * Run with: npx tsx src/fleet-bridge.ts
 * Or: npm run start:fleet
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CONFIG = {
  API_BASE: process.env.API_BASE || 'https://agent-coord-mcp.vercel.app',
  AGENT_ID: process.env.AGENT_ID || 'fleet-bridge',
  AGENT_NAME: 'Fleet Bridge',
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '3000'),
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  IOT_ENDPOINT: process.env.IOT_ENDPOINT || '', // Will be fetched if not set
};

interface ChatMessage {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
  reactions?: Array<{ emoji: string; by: string }>;
}

interface FleetCommand {
  command: string;
  args: string[];
  requestedBy: string;
  messageId: string;
}

let lastProcessedTimestamp: string | null = null;
let iotEndpoint: string = CONFIG.IOT_ENDPOINT;

// ============================================================================
// AWS Integration Functions
// ============================================================================

async function getIoTEndpoint(): Promise<string> {
  if (iotEndpoint) return iotEndpoint;

  try {
    const { stdout } = await execAsync(
      `aws iot describe-endpoint --endpoint-type iot:Data-ATS --region ${CONFIG.AWS_REGION} --output json`
    );
    const data = JSON.parse(stdout);
    iotEndpoint = data.endpointAddress;
    console.log(`[fleet] IoT endpoint: ${iotEndpoint}`);
    return iotEndpoint;
  } catch (err) {
    console.error('[fleet] Failed to get IoT endpoint:', err);
    throw new Error('Could not retrieve IoT endpoint. Check AWS credentials.');
  }
}

async function listIoTThings(): Promise<any[]> {
  try {
    const { stdout } = await execAsync(
      `aws iot list-things --region ${CONFIG.AWS_REGION} --output json`
    );
    const data = JSON.parse(stdout);
    return data.things || [];
  } catch (err) {
    console.error('[fleet] Failed to list things:', err);
    return [];
  }
}

async function getThingDetails(thingName: string): Promise<any> {
  try {
    const { stdout } = await execAsync(
      `aws iot describe-thing --thing-name "${thingName}" --region ${CONFIG.AWS_REGION} --output json`
    );
    return JSON.parse(stdout);
  } catch (err) {
    console.error(`[fleet] Failed to get thing ${thingName}:`, err);
    return null;
  }
}

async function getThingShadow(thingName: string): Promise<any> {
  try {
    const { stdout } = await execAsync(
      `aws iot-data get-thing-shadow --thing-name "${thingName}" --region ${CONFIG.AWS_REGION} /dev/stdout`
    );
    return JSON.parse(stdout);
  } catch (err) {
    console.error(`[fleet] Failed to get shadow for ${thingName}:`, err);
    return null;
  }
}

async function updateThingShadow(thingName: string, payload: any): Promise<boolean> {
  try {
    const payloadStr = JSON.stringify(payload).replace(/"/g, '\\"');
    await execAsync(
      `aws iot-data update-thing-shadow --thing-name "${thingName}" --payload "${payloadStr}" --region ${CONFIG.AWS_REGION} /dev/stdout`
    );
    return true;
  } catch (err) {
    console.error(`[fleet] Failed to update shadow for ${thingName}:`, err);
    return false;
  }
}

async function queryDynamoDB(imei: string): Promise<any[]> {
  try {
    // Query telemetry table for recent data
    const { stdout } = await execAsync(
      `aws dynamodb query --table-name teltonika-telemetry --key-condition-expression "imei = :imei" --expression-attribute-values '{":imei":{"S":"${imei}"}}' --limit 10 --scan-index-forward false --region ${CONFIG.AWS_REGION} --output json`
    );
    const data = JSON.parse(stdout);
    return data.Items || [];
  } catch (err) {
    console.error(`[fleet] Failed to query telemetry for ${imei}:`, err);
    return [];
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleFleetCommand(cmd: FleetCommand): Promise<string> {
  const { command, args, requestedBy } = cmd;

  try {
    switch (command.toLowerCase()) {
      case 'status':
        return await handleFleetStatus();

      case 'devices':
      case 'list':
        return await handleListDevices();

      case 'device':
        if (!args[0]) return '❌ Usage: /fleet device <imei or thing-name>';
        return await handleDeviceDetails(args[0]);

      case 'telemetry':
        if (!args[0]) return '❌ Usage: /fleet telemetry <imei>';
        return await handleTelemetry(args[0]);

      case 'shadow':
        if (!args[0]) return '❌ Usage: /fleet shadow <thing-name>';
        return await handleShadow(args[0]);

      case 'provision':
        if (!args[0]) return '❌ Usage: /fleet provision <imei>';
        return await handleProvision(args[0], requestedBy);

      case 'command':
        if (!args[0] || !args[1]) return '❌ Usage: /fleet command <thing-name> <command>';
        return await handleDeviceCommand(args[0], args.slice(1).join(' '));

      case 'help':
        return getHelpText();

      default:
        return `❓ Unknown command: ${command}\n\n${getHelpText()}`;
    }
  } catch (err) {
    return `❌ Error executing command: ${err}`;
  }
}

async function handleFleetStatus(): Promise<string> {
  const things = await listIoTThings();
  const endpoint = await getIoTEndpoint();

  // Group by status if we have device shadow info
  let activeCount = 0;
  let offlineCount = 0;

  for (const thing of things.slice(0, 10)) {
    const shadow = await getThingShadow(thing.thingName);
    if (shadow?.state?.reported?.connected) {
      activeCount++;
    } else {
      offlineCount++;
    }
  }

  return `**🚛 Fleet Status**

| Metric | Value |
|--------|-------|
| Total Devices | ${things.length} |
| Active | ${activeCount} |
| Offline | ${offlineCount} |
| IoT Endpoint | ${endpoint?.slice(0, 30)}... |
| AWS Region | ${CONFIG.AWS_REGION} |

Use \`/fleet devices\` for full device list.`;
}

async function handleListDevices(): Promise<string> {
  const things = await listIoTThings();

  if (things.length === 0) {
    return '📭 No devices found in IoT Core.';
  }

  let table = '**📱 Fleet Devices**\n\n| Name | Type | Created |\n|------|------|---------|';

  for (const thing of things.slice(0, 20)) {
    const type = thing.thingTypeName || 'N/A';
    const created = new Date(thing.version * 1000).toLocaleDateString();
    table += `\n| ${thing.thingName} | ${type} | ${created} |`;
  }

  if (things.length > 20) {
    table += `\n\n_...and ${things.length - 20} more devices_`;
  }

  return table;
}

async function handleDeviceDetails(identifier: string): Promise<string> {
  const details = await getThingDetails(identifier);

  if (!details) {
    return `❌ Device not found: ${identifier}`;
  }

  const shadow = await getThingShadow(identifier);
  const reported = shadow?.state?.reported || {};

  return `**📍 Device: ${details.thingName}**

| Property | Value |
|----------|-------|
| Thing Name | ${details.thingName} |
| Thing Type | ${details.thingTypeName || 'N/A'} |
| ARN | ${details.thingArn?.slice(-50)}... |
| Version | ${details.version} |

**Shadow State:**
\`\`\`json
${JSON.stringify(reported, null, 2).slice(0, 500)}
\`\`\``;
}

async function handleTelemetry(imei: string): Promise<string> {
  const telemetry = await queryDynamoDB(imei);

  if (telemetry.length === 0) {
    return `📭 No telemetry data found for IMEI: ${imei}`;
  }

  let table = `**📊 Recent Telemetry for ${imei}**\n\n| Time | Lat | Lng | Speed | Event |\n|------|-----|-----|-------|-------|`;

  for (const item of telemetry.slice(0, 10)) {
    const time = item.timestamp?.S || 'N/A';
    const lat = item.latitude?.N || 'N/A';
    const lng = item.longitude?.N || 'N/A';
    const speed = item.speed?.N || 'N/A';
    const event = item.event_id?.S || 'N/A';
    table += `\n| ${time.slice(11, 19)} | ${lat} | ${lng} | ${speed} | ${event} |`;
  }

  return table;
}

async function handleShadow(thingName: string): Promise<string> {
  const shadow = await getThingShadow(thingName);

  if (!shadow) {
    return `❌ Could not retrieve shadow for: ${thingName}`;
  }

  return `**🔮 Device Shadow: ${thingName}**

\`\`\`json
${JSON.stringify(shadow.state, null, 2).slice(0, 1500)}
\`\`\`

_Metadata: version ${shadow.version}, timestamp ${shadow.timestamp}_`;
}

async function handleProvision(imei: string, requestedBy: string): Promise<string> {
  // This is a placeholder - real provisioning would involve more steps
  return `**🔧 Provisioning Request**

IMEI: ${imei}
Requested by: ${requestedBy}
Status: ⏳ Queued

**Next Steps:**
1. Create IoT thing: \`teltonika-${imei}\`
2. Generate device certificate
3. Configure device shadow
4. Update fleet records

_Provisioning requires manual approval. Contact @tyler to proceed._`;
}

async function handleDeviceCommand(thingName: string, command: string): Promise<string> {
  const payload = {
    state: {
      desired: {
        command: command,
        commandTime: new Date().toISOString()
      }
    }
  };

  const success = await updateThingShadow(thingName, payload);

  if (success) {
    return `✅ Command sent to ${thingName}: \`${command}\`

The device will process this command on next sync.`;
  } else {
    return `❌ Failed to send command to ${thingName}`;
  }
}

function getHelpText(): string {
  return `**🚛 Fleet Bridge Commands**

| Command | Description |
|---------|-------------|
| \`/fleet status\` | Fleet overview |
| \`/fleet devices\` | List all devices |
| \`/fleet device <id>\` | Device details |
| \`/fleet telemetry <imei>\` | Recent GPS data |
| \`/fleet shadow <name>\` | Device shadow state |
| \`/fleet provision <imei>\` | Start provisioning |
| \`/fleet command <name> <cmd>\` | Send device command |
| \`/fleet help\` | This help text |

_Powered by local AWS credentials_`;
}

// ============================================================================
// Chat Integration
// ============================================================================

function parseFleetCommand(message: string, author: string, messageId: string): FleetCommand | null {
  // Match /fleet <command> [args] or @fleet-bridge <command> [args]
  const patterns = [
    /^\/fleet\s+(\w+)(?:\s+(.*))?$/i,
    /^@fleet-bridge\s+(\w+)(?:\s+(.*))?$/i,
    /^fleet:\s*(\w+)(?:\s+(.*))?$/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const command = match[1];
      const argsStr = match[2] || '';
      const args = argsStr.trim().split(/\s+/).filter(Boolean);
      return { command, args, requestedBy: author, messageId };
    }
  }

  return null;
}

async function updateAgentStatus(task: string): Promise<void> {
  try {
    await fetch(`${CONFIG.API_BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CONFIG.AGENT_ID,
        status: 'active',
        currentTask: task,
        workingOn: 'Teltonika fleet management',
        roles: ['fleet-manager', 'aws-bridge']
      })
    });
  } catch (err) {
    console.error('[fleet] Failed to update status:', err);
  }
}

async function getNewMessages(): Promise<ChatMessage[]> {
  try {
    const url = lastProcessedTimestamp
      ? `${CONFIG.API_BASE}/api/chat?since=${encodeURIComponent(lastProcessedTimestamp)}`
      : `${CONFIG.API_BASE}/api/chat?limit=10`;

    const res = await fetch(url);
    const data = await res.json();

    return (data.messages || []).filter((m: ChatMessage) => m.author !== CONFIG.AGENT_ID);
  } catch (err) {
    console.error('[fleet] Failed to fetch messages:', err);
    return [];
  }
}

async function postMessage(message: string): Promise<void> {
  try {
    await fetch(`${CONFIG.API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: CONFIG.AGENT_ID,
        authorType: 'agent',
        message
      })
    });
    console.log(`[fleet] Posted response to chat`);
  } catch (err) {
    console.error('[fleet] Failed to post message:', err);
  }
}

// ============================================================================
// Main Loop
// ============================================================================

async function main(): Promise<void> {
  console.log(`[fleet] Starting Teltonika Fleet Bridge`);
  console.log(`[fleet] Agent ID: ${CONFIG.AGENT_ID}`);
  console.log(`[fleet] API Base: ${CONFIG.API_BASE}`);
  console.log(`[fleet] AWS Region: ${CONFIG.AWS_REGION}`);

  // Verify AWS credentials
  try {
    await getIoTEndpoint();
    console.log(`[fleet] AWS credentials verified ✓`);
  } catch (err) {
    console.error('[fleet] AWS credentials check failed:', err);
    console.error('[fleet] Make sure AWS credentials are configured locally.');
  }

  await updateAgentStatus('Starting fleet bridge...');
  await postMessage(`🚛 **Fleet Bridge Online**\n\nType \`/fleet help\` to see available commands.\n\n_Running on Tyler's machine with local AWS credentials_`);

  while (true) {
    try {
      await updateAgentStatus('Monitoring for fleet commands');

      const messages = await getNewMessages();

      for (const msg of messages) {
        // Update last processed timestamp
        lastProcessedTimestamp = msg.timestamp;

        // Check if this is a fleet command
        const cmd = parseFleetCommand(msg.message, msg.author, msg.id);
        if (cmd) {
          console.log(`[fleet] Processing command: ${cmd.command} from ${cmd.requestedBy}`);
          await updateAgentStatus(`Executing: /fleet ${cmd.command}`);

          const response = await handleFleetCommand(cmd);
          await postMessage(`**Response to @${cmd.requestedBy}:**\n\n${response}`);
        }
      }
    } catch (err) {
      console.error('[fleet] Poll error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL));
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('[fleet] Shutting down...');
  await postMessage(`🚛 Fleet Bridge going offline.`);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[fleet] Shutting down...');
  await postMessage(`🚛 Fleet Bridge going offline.`);
  process.exit(0);
});

// Start the bridge
main().catch(err => {
  console.error('[fleet] Fatal error:', err);
  process.exit(1);
});
