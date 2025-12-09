/**
 * Agent Bridge API - Steering commands for cloud agents
 *
 * Enables local agents to send steering commands to cloud agents.
 * Cloud agents poll this endpoint to receive their commands.
 *
 * Endpoints:
 *   POST /api/agent-bridge?action=steer     - Send steering command to cloud agent
 *   GET  /api/agent-bridge?action=poll      - Cloud agent polls for commands
 *   POST /api/agent-bridge?action=respond   - Cloud agent responds to command
 *   GET  /api/agent-bridge?action=status    - Get bridge status
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const BRIDGE_COMMANDS_PREFIX = 'agent-coord:bridge:commands:';
const BRIDGE_RESPONSES_PREFIX = 'agent-coord:bridge:responses:';
const MAX_COMMAND_AGE_MS = 5 * 60 * 1000; // 5 minutes

interface SteerCommand {
  id: string;
  from: string;
  to: string;
  command: string;
  payload: any;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'received' | 'executing' | 'completed' | 'failed';
}

interface CommandResponse {
  commandId: string;
  from: string;
  success: boolean;
  result?: any;
  error?: string;
  completedAt: string;
}

function generateId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action } = req.query;

    // ========================================================================
    // STEER - Send a steering command to a cloud agent
    // ========================================================================
    if (req.method === 'POST' && action === 'steer') {
      const { from, to, command, payload, priority = 'normal' } = req.body || {};

      if (!from || !to || !command) {
        return res.status(400).json({
          error: 'Missing required fields: from, to, command'
        });
      }

      const cmdId = generateId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + MAX_COMMAND_AGE_MS);

      const steerCommand: SteerCommand = {
        id: cmdId,
        from,
        to,
        command,
        payload: payload || {},
        priority,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
      };

      // Store command in agent's queue
      const queueKey = `${BRIDGE_COMMANDS_PREFIX}${to}`;
      await redis.lpush(queueKey, JSON.stringify(steerCommand));

      // Trim old commands (keep last 50)
      await redis.ltrim(queueKey, 0, 49);

      // Also post to group chat so team can see steering activity
      try {
        const chatMessage = {
          id: `bridge-${cmdId}`,
          author: from,
          authorType: 'agent',
          message: `[bridge] Steering @${to}: ${command}`,
          timestamp: now.toISOString(),
          metadata: { bridgeCommand: cmdId, target: to },
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        await redis.ltrim('agent-coord:messages', 0, 999);
      } catch (e) {
        // Non-critical - continue even if chat post fails
      }

      return res.status(200).json({
        success: true,
        commandId: cmdId,
        target: to,
        command,
        status: 'pending',
        expiresAt: expiresAt.toISOString(),
        pollUrl: `/api/agent-bridge?action=poll&agentId=${to}`,
        responseUrl: `/api/agent-bridge?action=response&commandId=${cmdId}`,
      });
    }

    // ========================================================================
    // POLL - Cloud agent polls for pending commands
    // ========================================================================
    if (req.method === 'GET' && action === 'poll') {
      const agentId = req.query.agentId as string;

      if (!agentId) {
        return res.status(400).json({ error: 'agentId required' });
      }

      const queueKey = `${BRIDGE_COMMANDS_PREFIX}${agentId}`;
      const commands = await redis.lrange(queueKey, 0, 9) || [];

      const now = Date.now();
      const pending: SteerCommand[] = [];

      for (const cmd of commands) {
        const command = typeof cmd === 'string' ? JSON.parse(cmd) : cmd;

        // Skip expired commands
        if (new Date(command.expiresAt).getTime() < now) {
          continue;
        }

        // Only return pending commands
        if (command.status === 'pending') {
          pending.push(command);
        }
      }

      // Sort by priority (urgent first) then by creation time
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      pending.sort((a, b) => {
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      return res.status(200).json({
        agentId,
        commands: pending,
        count: pending.length,
        pollIntervalMs: pending.length > 0 ? 1000 : 5000,
        tip: pending.length > 0
          ? 'Execute commands and POST to /api/agent-bridge?action=respond'
          : 'No pending commands - poll again in 5 seconds',
      });
    }

    // ========================================================================
    // ACK - Cloud agent acknowledges receiving a command
    // ========================================================================
    if (req.method === 'POST' && action === 'ack') {
      const { commandId, agentId } = req.body || {};

      if (!commandId || !agentId) {
        return res.status(400).json({ error: 'commandId and agentId required' });
      }

      const queueKey = `${BRIDGE_COMMANDS_PREFIX}${agentId}`;
      const commands = await redis.lrange(queueKey, 0, 49) || [];

      // Update command status
      let updated = false;
      const updatedCommands = commands.map((cmd: any) => {
        const command = typeof cmd === 'string' ? JSON.parse(cmd) : cmd;
        if (command.id === commandId) {
          command.status = 'received';
          command.receivedAt = new Date().toISOString();
          updated = true;
        }
        return JSON.stringify(command);
      });

      if (updated) {
        await redis.del(queueKey);
        for (const cmd of updatedCommands.reverse()) {
          await redis.lpush(queueKey, cmd);
        }
      }

      return res.status(200).json({
        success: updated,
        commandId,
        status: updated ? 'received' : 'not_found',
      });
    }

    // ========================================================================
    // RESPOND - Cloud agent sends response to a command
    // ========================================================================
    if (req.method === 'POST' && action === 'respond') {
      const { commandId, agentId, success, result, error } = req.body || {};

      if (!commandId || !agentId) {
        return res.status(400).json({ error: 'commandId and agentId required' });
      }

      const response: CommandResponse = {
        commandId,
        from: agentId,
        success: success !== false,
        result,
        error,
        completedAt: new Date().toISOString(),
      };

      // Store response
      const responseKey = `${BRIDGE_RESPONSES_PREFIX}${commandId}`;
      await redis.set(responseKey, JSON.stringify(response), { ex: 3600 }); // 1 hour TTL

      // Update command status in queue
      const queueKey = `${BRIDGE_COMMANDS_PREFIX}${agentId}`;
      const commands = await redis.lrange(queueKey, 0, 49) || [];

      const updatedCommands = commands.map((cmd: any) => {
        const command = typeof cmd === 'string' ? JSON.parse(cmd) : cmd;
        if (command.id === commandId) {
          command.status = success !== false ? 'completed' : 'failed';
          command.completedAt = response.completedAt;
        }
        return JSON.stringify(command);
      });

      await redis.del(queueKey);
      for (const cmd of updatedCommands.reverse()) {
        await redis.lpush(queueKey, cmd);
      }

      // Post response to chat
      try {
        const chatMessage = {
          id: `bridge-resp-${commandId}`,
          author: agentId,
          authorType: 'agent',
          message: success !== false
            ? `[bridge] ✅ Completed: ${commandId.slice(4, 12)}...`
            : `[bridge] ❌ Failed: ${commandId.slice(4, 12)}... - ${error || 'unknown error'}`,
          timestamp: response.completedAt,
          isCloudAgent: true,
        };
        await redis.lpush('agent-coord:messages', JSON.stringify(chatMessage));
        await redis.ltrim('agent-coord:messages', 0, 999);
      } catch (e) {
        // Non-critical
      }

      return res.status(200).json({
        success: true,
        commandId,
        responseStored: true,
      });
    }

    // ========================================================================
    // RESPONSE - Get response for a command (polling by sender)
    // ========================================================================
    if (req.method === 'GET' && action === 'response') {
      const commandId = req.query.commandId as string;

      if (!commandId) {
        return res.status(400).json({ error: 'commandId required' });
      }

      const responseKey = `${BRIDGE_RESPONSES_PREFIX}${commandId}`;
      const response = await redis.get(responseKey);

      if (!response) {
        return res.status(200).json({
          commandId,
          status: 'pending',
          message: 'No response yet - command may still be executing',
        });
      }

      const parsed = typeof response === 'string' ? JSON.parse(response) : response;
      return res.status(200).json({
        commandId,
        status: 'completed',
        response: parsed,
      });
    }

    // ========================================================================
    // STATUS - Bridge status and connected agents
    // ========================================================================
    if (req.method === 'GET' && action === 'status') {
      // Get all cloud agents
      const cloudAgents = await redis.hgetall('agent-coord:cloud-agents') || {};
      const activeAgents = Object.entries(cloudAgents)
        .map(([id, data]) => {
          const agent = typeof data === 'string' ? JSON.parse(data) : data;
          return { id, ...agent };
        })
        .filter(a => a.status === 'running' || a.status === 'booting');

      return res.status(200).json({
        bridge: 'agent-bridge',
        version: '1.0.0',
        activeCloudAgents: activeAgents.length,
        agents: activeAgents.map(a => ({
          id: a.id,
          status: a.status,
          publicIp: a.publicIp,
          soulId: a.soulId,
        })),
        endpoints: {
          'POST ?action=steer': 'Send steering command to cloud agent',
          'GET ?action=poll&agentId=X': 'Cloud agent polls for commands',
          'POST ?action=ack': 'Cloud agent acknowledges command',
          'POST ?action=respond': 'Cloud agent sends response',
          'GET ?action=response&commandId=X': 'Get response for command',
          'GET ?action=status': 'Bridge status',
        },
        usage: {
          steer: 'POST { from: "local-agent", to: "cloud-agent-id", command: "run-test", payload: {} }',
          poll: 'GET ?action=poll&agentId=cloud-agent-id',
        },
      });
    }

    // ========================================================================
    // DEFAULT - API info
    // ========================================================================
    return res.status(200).json({
      api: 'agent-bridge',
      version: '1.0.0',
      description: 'Bridge for steering cloud agents from local agents',
      endpoints: {
        'POST ?action=steer': 'Send steering command to cloud agent',
        'GET ?action=poll&agentId=X': 'Cloud agent polls for commands',
        'POST ?action=respond': 'Cloud agent sends response',
        'GET ?action=status': 'Bridge status',
      },
    });

  } catch (error) {
    console.error('[agent-bridge] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: String(error),
    });
  }
}
