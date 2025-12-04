import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

/**
 * Soul Monitor API
 *
 * Monitors all active bodies for token usage and triggers alerts/transfers.
 * Called periodically by a cron job or monitoring service.
 */

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const BODIES_KEY = 'agent-coord:bodies';
const SOULS_KEY = 'agent-coord:souls';
const ALERTS_KEY = 'agent-coord:soul-alerts';
const CHAT_KEY = 'agent-coord:chat';

// Token thresholds
const TOKEN_WARNING = 150000;
const TOKEN_DANGER = 180000;
const TOKEN_CRITICAL = 195000;

// Stale threshold - body hasn't reported in 10 minutes
const STALE_MINUTES = 10;

interface Body {
  bodyId: string;
  soulId: string | null;
  status: string;
  currentTokens: number;
  peakTokens: number;
  tokenBurnRate: number;
  lastTokenUpdate: string;
  lastHeartbeat: string;
  errorCount: number;
}

interface Soul {
  soulId: string;
  name: string;
  currentBodyId: string | null;
}

interface Alert {
  alertId: string;
  type: 'warning' | 'danger' | 'critical' | 'stale' | 'transfer_needed';
  bodyId: string;
  soulId: string | null;
  soulName: string | null;
  message: string;
  tokens: number;
  estimatedMinutes: number | null;
  createdAt: string;
  acknowledged: boolean;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getTokenStatus(tokens: number): 'safe' | 'warning' | 'danger' | 'critical' {
  if (tokens >= TOKEN_CRITICAL) return 'critical';
  if (tokens >= TOKEN_DANGER) return 'danger';
  if (tokens >= TOKEN_WARNING) return 'warning';
  return 'safe';
}

async function postToChat(message: string) {
  try {
    const chatMessage = {
      id: generateId(),
      author: '🔮 soul-monitor',
      authorType: 'system',
      message,
      timestamp: new Date().toISOString(),
    };

    await redis.lpush(CHAT_KEY, JSON.stringify(chatMessage));
    await redis.ltrim(CHAT_KEY, 0, 999);
  } catch (err) {
    console.error('Failed to post to chat:', err);
  }
}

async function createAlert(alert: Omit<Alert, 'alertId' | 'createdAt' | 'acknowledged'>): Promise<Alert> {
  const fullAlert: Alert = {
    ...alert,
    alertId: generateId(),
    createdAt: new Date().toISOString(),
    acknowledged: false,
  };

  await redis.hset(ALERTS_KEY, { [fullAlert.alertId]: JSON.stringify(fullAlert) });
  return fullAlert;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  try {
    // Run health check on all bodies
    if (action === 'check' || req.method === 'GET') {
      const bodies = await redis.hgetall(BODIES_KEY) || {};
      const souls = await redis.hgetall(SOULS_KEY) || {};

      const soulMap = new Map<string, Soul>();
      for (const [soulId, soulData] of Object.entries(souls)) {
        const soul = typeof soulData === 'string' ? JSON.parse(soulData) : soulData;
        soulMap.set(soulId, soul);
      }

      const results = {
        checked: 0,
        healthy: 0,
        warning: 0,
        danger: 0,
        critical: 0,
        stale: 0,
        alerts: [] as Alert[],
      };

      const now = new Date();

      for (const [bodyId, bodyData] of Object.entries(bodies)) {
        const body: Body = typeof bodyData === 'string' ? JSON.parse(bodyData) : bodyData;

        // Skip non-active bodies
        if (body.status !== 'active' && body.status !== 'running') {
          continue;
        }

        results.checked++;

        const soul = body.soulId ? soulMap.get(body.soulId) : null;
        const lastUpdate = new Date(body.lastTokenUpdate || body.lastHeartbeat);
        const minutesSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 60000;

        // Check for stale bodies
        if (minutesSinceUpdate > STALE_MINUTES) {
          results.stale++;
          const alert = await createAlert({
            type: 'stale',
            bodyId,
            soulId: body.soulId,
            soulName: soul?.name || null,
            message: `Body ${bodyId} hasn't reported in ${Math.floor(minutesSinceUpdate)} minutes`,
            tokens: body.currentTokens,
            estimatedMinutes: null,
          });
          results.alerts.push(alert);
          continue;
        }

        // Check token status
        const status = getTokenStatus(body.currentTokens);
        const estimatedMinutes = body.tokenBurnRate > 0
          ? Math.floor((TOKEN_CRITICAL - body.currentTokens) / body.tokenBurnRate)
          : null;

        switch (status) {
          case 'safe':
            results.healthy++;
            break;

          case 'warning':
            results.warning++;
            const warningAlert = await createAlert({
              type: 'warning',
              bodyId,
              soulId: body.soulId,
              soulName: soul?.name || null,
              message: `Body ${bodyId}${soul ? ` (${soul.name})` : ''} at ${body.currentTokens.toLocaleString()} tokens - consider checkpointing`,
              tokens: body.currentTokens,
              estimatedMinutes,
            });
            results.alerts.push(warningAlert);
            break;

          case 'danger':
            results.danger++;
            const dangerAlert = await createAlert({
              type: 'danger',
              bodyId,
              soulId: body.soulId,
              soulName: soul?.name || null,
              message: `Body ${bodyId}${soul ? ` (${soul.name})` : ''} at ${body.currentTokens.toLocaleString()} tokens - TRANSFER RECOMMENDED`,
              tokens: body.currentTokens,
              estimatedMinutes,
            });
            results.alerts.push(dangerAlert);

            // Post to chat for danger
            await postToChat(
              `[soul-alert] ⚠️ **${soul?.name || bodyId}** approaching limit (${body.currentTokens.toLocaleString()} tokens)` +
              (estimatedMinutes ? ` - ~${estimatedMinutes} minutes remaining` : '')
            );
            break;

          case 'critical':
            results.critical++;
            const criticalAlert = await createAlert({
              type: 'critical',
              bodyId,
              soulId: body.soulId,
              soulName: soul?.name || null,
              message: `CRITICAL: Body ${bodyId}${soul ? ` (${soul.name})` : ''} at ${body.currentTokens.toLocaleString()} tokens - IMMEDIATE TRANSFER NEEDED`,
              tokens: body.currentTokens,
              estimatedMinutes,
            });
            results.alerts.push(criticalAlert);

            // Urgent chat notification
            await postToChat(
              `[soul-alert] 🚨 **CRITICAL** - ${soul?.name || bodyId} at ${body.currentTokens.toLocaleString()} tokens!` +
              ` Immediate transfer required!` +
              (estimatedMinutes ? ` Only ~${estimatedMinutes} minutes remaining!` : '')
            );
            break;
        }
      }

      return res.json({
        success: true,
        timestamp: now.toISOString(),
        results,
        thresholds: {
          warning: TOKEN_WARNING,
          danger: TOKEN_DANGER,
          critical: TOKEN_CRITICAL,
          staleMinutes: STALE_MINUTES,
        },
      });
    }

    // Get all alerts
    if (action === 'alerts') {
      const alerts = await redis.hgetall(ALERTS_KEY) || {};
      const alertList = Object.values(alerts)
        .map((a: any) => typeof a === 'string' ? JSON.parse(a) : a)
        .sort((a: Alert, b: Alert) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      // Filter by status if requested
      const { status, unacknowledged } = req.query;
      let filtered = alertList;

      if (status) {
        filtered = filtered.filter((a: Alert) => a.type === status);
      }
      if (unacknowledged === 'true') {
        filtered = filtered.filter((a: Alert) => !a.acknowledged);
      }

      return res.json({
        alerts: filtered,
        count: filtered.length,
        unacknowledgedCount: alertList.filter((a: Alert) => !a.acknowledged).length,
      });
    }

    // Acknowledge an alert
    if (action === 'acknowledge' && req.method === 'POST') {
      const { alertId } = req.body;

      if (!alertId) {
        return res.status(400).json({ error: 'alertId required' });
      }

      const raw = await redis.hget(ALERTS_KEY, alertId);
      if (!raw) {
        return res.status(404).json({ error: 'Alert not found' });
      }

      const alert: Alert = typeof raw === 'string' ? JSON.parse(raw) : raw;
      alert.acknowledged = true;

      await redis.hset(ALERTS_KEY, { [alertId]: JSON.stringify(alert) });

      return res.json({ success: true, alert });
    }

    // Clear old alerts
    if (action === 'cleanup' && req.method === 'POST') {
      const { olderThanHours = 24 } = req.body;

      const alerts = await redis.hgetall(ALERTS_KEY) || {};
      const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
      let deleted = 0;

      for (const [alertId, alertData] of Object.entries(alerts)) {
        const alert: Alert = typeof alertData === 'string' ? JSON.parse(alertData) : alertData;
        if (new Date(alert.createdAt) < cutoff && alert.acknowledged) {
          await redis.hdel(ALERTS_KEY, alertId);
          deleted++;
        }
      }

      return res.json({ success: true, deleted, cutoff: cutoff.toISOString() });
    }

    // Get dashboard summary
    if (action === 'dashboard') {
      const [bodies, souls, alerts] = await Promise.all([
        redis.hgetall(BODIES_KEY) || {},
        redis.hgetall(SOULS_KEY) || {},
        redis.hgetall(ALERTS_KEY) || {},
      ]);

      const bodyList = Object.values(bodies).map((b: any) => typeof b === 'string' ? JSON.parse(b) : b);
      const soulList = Object.values(souls).map((s: any) => typeof s === 'string' ? JSON.parse(s) : s);
      const alertList = Object.values(alerts).map((a: any) => typeof a === 'string' ? JSON.parse(a) : a);

      const activeBodies = bodyList.filter((b: Body) => b.status === 'active' || b.status === 'running');

      const byStatus = {
        safe: activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'safe').length,
        warning: activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'warning').length,
        danger: activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'danger').length,
        critical: activeBodies.filter((b: Body) => getTokenStatus(b.currentTokens) === 'critical').length,
      };

      const recentAlerts = alertList
        .filter((a: Alert) => !a.acknowledged)
        .sort((a: Alert, b: Alert) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);

      const needsAttention = activeBodies
        .filter((b: Body) => {
          const status = getTokenStatus(b.currentTokens);
          return status === 'danger' || status === 'critical';
        })
        .map((b: Body) => {
          const soul = soulList.find((s: Soul) => s.soulId === b.soulId);
          return {
            bodyId: b.bodyId,
            soulId: b.soulId,
            soulName: soul?.name || null,
            tokens: b.currentTokens,
            status: getTokenStatus(b.currentTokens),
            burnRate: b.tokenBurnRate,
            estimatedMinutes: b.tokenBurnRate > 0
              ? Math.floor((TOKEN_CRITICAL - b.currentTokens) / b.tokenBurnRate)
              : null,
          };
        });

      return res.json({
        summary: {
          totalSouls: soulList.length,
          activeBodies: activeBodies.length,
          ...byStatus,
        },
        needsAttention,
        recentAlerts,
        thresholds: {
          warning: TOKEN_WARNING,
          danger: TOKEN_DANGER,
          critical: TOKEN_CRITICAL,
        },
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      validActions: ['check', 'alerts', 'acknowledge', 'cleanup', 'dashboard'],
    });

  } catch (error) {
    console.error('Soul Monitor error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
