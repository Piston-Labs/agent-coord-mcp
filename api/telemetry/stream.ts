/**
 * Real-time Telemetry SSE Stream
 *
 * Server-Sent Events endpoint for near-real-time telemetry updates.
 * Polls S3 every 2 seconds and pushes only when data changes.
 *
 * Usage:
 *   const es = new EventSource('/api/telemetry/stream?imei=862464068525638');
 *   es.onmessage = (e) => updateDashboard(JSON.parse(e.data));
 *
 * Note: Vercel Edge times out after 30s on Hobby plan, but browsers
 * auto-reconnect SSE streams seamlessly.
 */

export const config = {
  runtime: 'edge',
};

const S3_BUCKET = 'telemetry-raw-usw1';
const POLL_INTERVAL_MS = 2000; // 2 seconds

interface TelemetryData {
  imei: string;
  timestamp: string;
  position: {
    lat: number;
    lng: number;
    altitude: number;
    heading: number;
    satellites: number;
    speed: number;
  };
  metrics: {
    externalVoltage: number;
    ignition: boolean;
    movement: boolean;
    odometer: number;
    gsmSignal: number;
  };
  raw?: Record<string, number | string>;
}

// Parse Teltonika AVL data from S3 JSON
function parseTeltonika(data: any): TelemetryData | null {
  try {
    const reported = data.state?.reported;
    if (!reported) return null;

    const [lat, lng] = (reported.latlng || '0,0').split(',').map(Number);

    return {
      imei: data.topic?.match(/teltonika\/(\d+)\//)?.[1] || 'unknown',
      timestamp: new Date(reported.ts).toISOString(),
      position: {
        lat,
        lng,
        altitude: reported.alt || 0,
        heading: reported.ang || 0,
        satellites: reported.sat || 0,
        speed: reported.sp || 0,
      },
      metrics: {
        externalVoltage: (reported['66'] || 0) / 1000, // mV to V
        ignition: reported['69'] === 1,
        movement: reported['200'] === 1,
        odometer: Math.round((reported['16'] || 0) / 1000), // m to km
        gsmSignal: reported['21'] || 0,
      },
      raw: reported,
    };
  } catch {
    return null;
  }
}

// Get latest telemetry file from S3
async function getLatestTelemetry(imei: string): Promise<TelemetryData | null> {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = String(today.getUTCMonth() + 1).padStart(2, '0');
  const day = String(today.getUTCDate()).padStart(2, '0');
  const prefix = `${imei}/${year}/${month}/${day}/`;

  try {
    // Use our existing telemetry API to get latest data
    const response = await fetch(
      `https://agent-coord-mcp.vercel.app/api/telemetry?imei=${imei}&source=s3`
    );

    if (!response.ok) {
      console.error('Telemetry API error:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.telemetry) {
      return {
        imei,
        timestamp: data.telemetry.timestamp,
        position: data.telemetry.position,
        metrics: {
          externalVoltage: data.telemetry.metrics?.batteryVoltage || 0,
          ignition: data.telemetry.status?.ignition || false,
          movement: data.telemetry.status?.movement || false,
          odometer: data.telemetry.metrics?.odometer || 0,
          gsmSignal: data.telemetry.connectivity?.signalStrength || 0,
        },
        raw: data.telemetry.metrics,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return null;
  }
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const imei = url.searchParams.get('imei');

  if (!imei) {
    return new Response(
      JSON.stringify({
        error: 'Missing imei parameter',
        usage: '/api/telemetry/stream?imei=862464068558217'
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let lastTimestamp: string | null = null;
  let iterations = 0;
  const maxIterations = 14; // ~28 seconds before Vercel timeout

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: {"imei":"${imei}","status":"streaming"}\n\n`));

      // Poll loop
      while (iterations < maxIterations) {
        try {
          const data = await getLatestTelemetry(imei);

          if (data && data.timestamp !== lastTimestamp) {
            // New data - send it
            const event = `event: telemetry\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(event));
            lastTimestamp = data.timestamp;
          }

          iterations++;

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        } catch (error) {
          // Send error event but keep stream alive
          const errorEvent = `event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        }
      }

      // Send reconnect hint before timeout
      controller.enqueue(encoder.encode(`event: reconnect\ndata: {"reason":"timeout","after":100}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
