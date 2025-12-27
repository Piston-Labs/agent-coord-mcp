import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Cloudflare Telemetry Proxy API
 *
 * Proxies requests to the Cloudflare Worker to avoid CORS issues.
 * The frontend can call this API instead of the Worker directly.
 *
 * GET /api/cf-telemetry - Get all devices
 * GET /api/cf-telemetry?imei=xxx - Get specific device
 * GET /api/cf-telemetry?imei=xxx&trips=true - Get device trips
 */

const CLOUDFLARE_TELEMETRY = 'https://piston-telemetry.tyler-4c4.workers.dev';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=3');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imei, trips } = req.query;

  try {
    let url: string;

    if (imei && typeof imei === 'string') {
      if (trips === 'true') {
        // Get trips for specific device
        url = `${CLOUDFLARE_TELEMETRY}/device/${imei}/trips`;
      } else {
        // Get specific device
        url = `${CLOUDFLARE_TELEMETRY}/device/${imei}`;
      }
    } else {
      // Get all devices
      url = `${CLOUDFLARE_TELEMETRY}/devices`;
    }

    const cfRes = await fetch(url);

    if (!cfRes.ok) {
      return res.status(cfRes.status).json({
        error: `Cloudflare returned ${cfRes.status}`,
        url
      });
    }

    const data = await cfRes.json();
    return res.json(data);

  } catch (error) {
    console.error('Cloudflare proxy error:', error);
    return res.status(500).json({
      error: String(error),
      message: 'Failed to fetch from Cloudflare Worker'
    });
  }
}
