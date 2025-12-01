import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ALERTS_KEY = 'piston:alerts';
const ALERT_CONFIG_KEY = 'piston:alert-config';

interface Alert {
  id: string;
  type: 'device-offline' | 'battery-low' | 'geofence-breach' | 'maintenance-due' | 'speed-alert' | 'custom';
  severity: 'info' | 'warning' | 'critical';
  deviceImei?: string;
  deviceName?: string;
  message: string;
  data?: Record<string, any>;
  createdAt: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

interface AlertConfig {
  deviceOfflineMinutes: number;
  batteryLowVoltage: number;
  speedLimitKmh: number;
  maintenanceMileageKm: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: AlertConfig = {
  deviceOfflineMinutes: 5,
  batteryLowVoltage: 11.5,
  speedLimitKmh: 140,
  maintenanceMileageKm: 5000,
  enabled: true
};

/**
 * Fleet Alerts API
 * 
 * GET /api/alerts - List active alerts
 * POST /api/alerts - Create alert (usually from Lambda/monitoring)
 * PATCH /api/alerts - Acknowledge alert
 * DELETE /api/alerts?id=xxx - Delete alert
 * 
 * GET /api/alerts?action=config - Get alert configuration
 * POST /api/alerts?action=config - Update alert configuration
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const action = req.query.action as string;

    // Configuration management
    if (action === 'config') {
      if (req.method === 'GET') {
        const config = await redis.get(ALERT_CONFIG_KEY) as AlertConfig || DEFAULT_CONFIG;
        return res.json({ config });
      }

      if (req.method === 'POST') {
        const updates = req.body || {};
        const current = await redis.get(ALERT_CONFIG_KEY) as AlertConfig || DEFAULT_CONFIG;
        const newConfig = { ...current, ...updates };
        await redis.set(ALERT_CONFIG_KEY, newConfig);
        return res.json({ success: true, config: newConfig });
      }
    }

    // GET: List alerts
    if (req.method === 'GET') {
      const { severity, type, acknowledged } = req.query;
      
      const alertsRaw = await redis.lrange(ALERTS_KEY, 0, 100);
      let alerts: Alert[] = alertsRaw.map((a: any) => 
        typeof a === 'string' ? JSON.parse(a) : a
      );

      // Filter
      if (severity) alerts = alerts.filter(a => a.severity === severity);
      if (type) alerts = alerts.filter(a => a.type === type);
      if (acknowledged === 'false') alerts = alerts.filter(a => !a.acknowledged);
      if (acknowledged === 'true') alerts = alerts.filter(a => a.acknowledged);

      const summary = {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length,
        warning: alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length,
        info: alerts.filter(a => a.severity === 'info' && !a.acknowledged).length,
        unacknowledged: alerts.filter(a => !a.acknowledged).length
      };

      return res.json({ alerts, summary });
    }

    // POST: Create alert
    if (req.method === 'POST' && action !== 'config') {
      const { type, severity = 'warning', deviceImei, deviceName, message, data } = req.body || {};

      if (!type || !message) {
        return res.status(400).json({ error: 'type and message required' });
      }

      const alert: Alert = {
        id: `alert-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 6)}`,
        type,
        severity,
        deviceImei,
        deviceName,
        message,
        data,
        createdAt: new Date().toISOString(),
        acknowledged: false
      };

      await redis.lpush(ALERTS_KEY, JSON.stringify(alert));
      
      // Trim to keep only last 500 alerts
      await redis.ltrim(ALERTS_KEY, 0, 499);

      return res.json({ success: true, alert });
    }

    // PATCH: Acknowledge alert
    if (req.method === 'PATCH') {
      const { id, acknowledgedBy } = req.body || {};

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const alertsRaw = await redis.lrange(ALERTS_KEY, 0, 500);
      const alerts: Alert[] = alertsRaw.map((a: any) => 
        typeof a === 'string' ? JSON.parse(a) : a
      );

      const alertIndex = alerts.findIndex(a => a.id === id);
      if (alertIndex === -1) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      alerts[alertIndex].acknowledged = true;
      alerts[alertIndex].acknowledgedBy = acknowledgedBy || 'unknown';
      alerts[alertIndex].acknowledgedAt = new Date().toISOString();

      // Rewrite list
      await redis.del(ALERTS_KEY);
      for (const alert of alerts.reverse()) {
        await redis.lpush(ALERTS_KEY, JSON.stringify(alert));
      }

      return res.json({ success: true, alert: alerts[alertIndex] });
    }

    // DELETE: Remove alert
    if (req.method === 'DELETE') {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const alertsRaw = await redis.lrange(ALERTS_KEY, 0, 500);
      const alerts: Alert[] = alertsRaw.map((a: any) => 
        typeof a === 'string' ? JSON.parse(a) : a
      ).filter((a: Alert) => a.id !== id);

      await redis.del(ALERTS_KEY);
      for (const alert of alerts.reverse()) {
        await redis.lpush(ALERTS_KEY, JSON.stringify(alert));
      }

      return res.json({ success: true, removed: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Alerts error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
