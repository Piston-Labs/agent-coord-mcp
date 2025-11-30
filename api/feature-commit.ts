import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const FEATURES_KEY = 'agent-coord:planned-features';
const MESSAGES_KEY = 'agent-coord:messages';

/**
 * Feature-Commit Linking Endpoint
 *
 * Links git commits to planned features and updates their status.
 *
 * POST /api/feature-commit
 * {
 *   "featureId": "feat-xxx",      // Required
 *   "commitHash": "abc123",       // Optional
 *   "commitMessage": "...",       // Optional
 *   "action": "progress|ready|verify|done",  // Required
 *   "agentId": "...",             // Who is updating
 *   "notes": "..."                // Optional notes
 * }
 *
 * Actions:
 * - progress: Mark as in-progress (work started)
 * - ready: Mark as ready for review (work complete, needs verification)
 * - verify: Human verified, mark as done
 * - done: Skip verification, mark done directly
 */

interface FeatureUpdate {
  featureId: string;
  action: 'progress' | 'ready' | 'verify' | 'done';
  commitHash?: string;
  commitMessage?: string;
  agentId?: string;
  notes?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { featureId, action, commitHash, commitMessage, agentId, notes }: FeatureUpdate = req.body;

    if (!featureId || !action) {
      return res.status(400).json({ error: 'featureId and action are required' });
    }

    // Get existing feature
    const existing = await redis.hget(FEATURES_KEY, featureId);
    if (!existing) {
      return res.status(404).json({ error: 'Feature not found' });
    }

    const feature = typeof existing === 'string' ? JSON.parse(existing) : existing;
    const previousStatus = feature.status;

    // Initialize tracking arrays if not present
    if (!feature.commits) feature.commits = [];
    if (!feature.statusHistory) feature.statusHistory = [];

    // Add commit if provided
    if (commitHash) {
      feature.commits.push({
        hash: commitHash,
        message: commitMessage || '',
        timestamp: new Date().toISOString(),
        by: agentId
      });
    }

    // Update status based on action
    let newStatus = feature.status;
    let chatMessage = '';

    switch (action) {
      case 'progress':
        newStatus = 'in-progress';
        feature.assignedTo = agentId || feature.assignedTo;
        feature.startedAt = feature.startedAt || new Date().toISOString();
        chatMessage = `🔨 **${agentId || 'Someone'}** started work on: ${feature.title}`;
        break;

      case 'ready':
        newStatus = 'testing';  // Ready for review/testing
        feature.readyAt = new Date().toISOString();
        feature.readyBy = agentId;
        chatMessage = `✅ **${agentId || 'Someone'}** marked ready for review: ${feature.title}${commitHash ? ` (${commitHash.substring(0, 7)})` : ''}`;
        break;

      case 'verify':
        newStatus = 'done';
        feature.verifiedAt = new Date().toISOString();
        feature.verifiedBy = agentId;
        feature.completedAt = new Date().toISOString();
        chatMessage = `🎉 **${agentId || 'Someone'}** verified complete: ${feature.title}`;
        break;

      case 'done':
        newStatus = 'done';
        feature.completedAt = new Date().toISOString();
        feature.completedBy = agentId;
        chatMessage = `✨ Feature completed: ${feature.title}${commitHash ? ` (${commitHash.substring(0, 7)})` : ''}`;
        break;
    }

    // Record status change
    if (newStatus !== previousStatus) {
      feature.statusHistory.push({
        from: previousStatus,
        to: newStatus,
        timestamp: new Date().toISOString(),
        by: agentId,
        notes
      });
    }

    feature.status = newStatus;
    feature.updatedAt = new Date().toISOString();

    // Save updated feature
    await redis.hset(FEATURES_KEY, { [featureId]: JSON.stringify(feature) });

    // Post to chat if status changed
    if (chatMessage && newStatus !== previousStatus) {
      const msg = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`,
        author: 'system',
        authorType: 'system',
        message: chatMessage,
        timestamp: new Date().toISOString(),
        reactions: []
      };
      await redis.lpush(MESSAGES_KEY, JSON.stringify(msg));
    }

    return res.json({
      success: true,
      feature,
      statusChanged: newStatus !== previousStatus,
      previousStatus,
      newStatus
    });

  } catch (error) {
    console.error('Feature commit error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
