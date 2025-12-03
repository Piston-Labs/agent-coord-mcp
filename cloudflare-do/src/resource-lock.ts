/**
 * ResourceLock - Per-Resource Durable Object
 *
 * Each lockable resource gets its own Durable Object:
 * - File paths, branches, custom resources
 * - Atomic lock acquisition/release
 * - Automatic expiry via Alarms API
 * - Lock history for debugging
 *
 * Pattern: One DO per resource path (use resourcePath as DO name)
 * Scale: Naturally distributed - contention only within single resource
 */

import type { ResourceLockData } from './types';

interface LockHistory {
  id: string;
  lockedBy: string;
  reason?: string;
  lockedAt: string;
  releasedAt?: string;
  releaseReason?: 'manual' | 'expired' | 'stolen';
}

export class ResourceLock implements DurableObject {
  private state: DurableObjectState;
  private sql: SqlStorage;
  private resourcePath: string = '';

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.sql = state.storage.sql;
    this.initializeDatabase();
  }

  private initializeDatabase() {
    // Current lock state (only one row)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS current_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        resource_path TEXT NOT NULL,
        resource_type TEXT DEFAULT 'file-lock',
        locked_by TEXT NOT NULL,
        reason TEXT,
        locked_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);

    // Lock history for debugging
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS lock_history (
        id TEXT PRIMARY KEY,
        locked_by TEXT NOT NULL,
        reason TEXT,
        locked_at TEXT NOT NULL,
        released_at TEXT,
        release_reason TEXT
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Get resource path from query or header
    this.resourcePath = url.searchParams.get('resourcePath') || request.headers.get('X-Resource-Path') || '';

    try {
      switch (path) {
        case '/check':
          return this.handleCheck();
        case '/lock':
          return this.handleLock(request);
        case '/unlock':
          return this.handleUnlock(request);
        case '/history':
          return this.handleHistory();
        case '/health':
          return Response.json({ status: 'ok', type: 'resource-lock', resourcePath: this.resourcePath });
        default:
          return Response.json({ error: 'Not found' }, { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  /**
   * Alarm handler - called when lock expires
   */
  async alarm() {
    const lock = this.getCurrentLock();
    if (lock) {
      // Lock expired - release it
      this.releaseLock('expired');
    }
  }

  // ========== Lock Operations ==========

  private handleCheck(): Response {
    const lock = this.getCurrentLock();

    if (!lock) {
      return Response.json({
        locked: false,
        resourcePath: this.resourcePath
      });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(lock.expiresAt);

    if (now > expiresAt) {
      // Expired but not yet cleaned up
      this.releaseLock('expired');
      return Response.json({
        locked: false,
        resourcePath: this.resourcePath,
        note: 'Previous lock expired'
      });
    }

    return Response.json({
      locked: true,
      lock: {
        resourcePath: lock.resourcePath,
        resourceType: lock.resourceType,
        lockedBy: lock.lockedBy,
        reason: lock.reason,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
        remainingMs: expiresAt.getTime() - now.getTime()
      }
    });
  }

  private async handleLock(request: Request): Promise<Response> {
    const body = await request.json() as {
      agentId: string;
      reason?: string;
      resourceType?: string;
      ttlMs?: number;
    };

    const existingLock = this.getCurrentLock();

    // Check if already locked by someone else
    if (existingLock) {
      const now = new Date();
      const expiresAt = new Date(existingLock.expiresAt);

      if (now < expiresAt && existingLock.lockedBy !== body.agentId) {
        return Response.json({
          success: false,
          error: 'Resource is locked',
          lockedBy: existingLock.lockedBy,
          expiresAt: existingLock.expiresAt,
          remainingMs: expiresAt.getTime() - now.getTime()
        }, { status: 409 });
      }

      // Either expired or same agent - allow re-lock
      if (now >= expiresAt) {
        this.releaseLock('expired');
      }
    }

    // Create new lock
    const now = new Date();
    const ttlMs = body.ttlMs || 2 * 60 * 60 * 1000; // Default 2 hours
    const expiresAt = new Date(now.getTime() + ttlMs);

    const lock: ResourceLockData = {
      resourcePath: this.resourcePath,
      resourceType: (body.resourceType || 'file-lock') as ResourceLockData['resourceType'],
      lockedBy: body.agentId,
      reason: body.reason,
      lockedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    // Save to database
    this.sql.exec(`
      INSERT INTO current_lock (id, resource_path, resource_type, locked_by, reason, locked_at, expires_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        resource_path = excluded.resource_path,
        resource_type = excluded.resource_type,
        locked_by = excluded.locked_by,
        reason = excluded.reason,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    `, lock.resourcePath, lock.resourceType, lock.lockedBy, lock.reason || null, lock.lockedAt, lock.expiresAt);

    // Add to history
    this.sql.exec(`
      INSERT INTO lock_history (id, locked_by, reason, locked_at)
      VALUES (?, ?, ?, ?)
    `, `lock-${Date.now()}`, lock.lockedBy, lock.reason || null, lock.lockedAt);

    // Set alarm for expiry
    await this.state.storage.setAlarm(expiresAt.getTime());

    return Response.json({
      success: true,
      lock,
      message: `Lock acquired for ${ttlMs / 1000 / 60} minutes`
    });
  }

  private async handleUnlock(request: Request): Promise<Response> {
    const body = await request.json() as { agentId: string; force?: boolean };

    const existingLock = this.getCurrentLock();

    if (!existingLock) {
      return Response.json({
        success: true,
        message: 'No lock to release'
      });
    }

    // Check ownership (unless force)
    if (!body.force && existingLock.lockedBy !== body.agentId) {
      return Response.json({
        success: false,
        error: 'Not lock owner',
        lockedBy: existingLock.lockedBy
      }, { status: 403 });
    }

    const releaseReason = body.force && existingLock.lockedBy !== body.agentId ? 'stolen' : 'manual';
    this.releaseLock(releaseReason);

    // Cancel the expiry alarm
    await this.state.storage.deleteAlarm();

    return Response.json({
      success: true,
      message: 'Lock released',
      previousOwner: existingLock.lockedBy
    });
  }

  private handleHistory(): Response {
    const rows = this.sql.exec(`
      SELECT * FROM lock_history
      ORDER BY locked_at DESC
      LIMIT 50
    `).toArray();

    const history: LockHistory[] = rows.map(row => ({
      id: row.id as string,
      lockedBy: row.locked_by as string,
      reason: row.reason as string | undefined,
      lockedAt: row.locked_at as string,
      releasedAt: row.released_at as string | undefined,
      releaseReason: row.release_reason as LockHistory['releaseReason']
    }));

    return Response.json({
      resourcePath: this.resourcePath,
      currentLock: this.getCurrentLock(),
      history
    });
  }

  // ========== Helper Methods ==========

  private getCurrentLock(): ResourceLockData | null {
    const rows = this.sql.exec('SELECT * FROM current_lock WHERE id = 1').toArray();
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      resourcePath: row.resource_path as string,
      resourceType: row.resource_type as ResourceLockData['resourceType'],
      lockedBy: row.locked_by as string,
      reason: row.reason as string | undefined,
      lockedAt: row.locked_at as string,
      expiresAt: row.expires_at as string
    };
  }

  private releaseLock(reason: 'manual' | 'expired' | 'stolen') {
    const lock = this.getCurrentLock();
    if (!lock) return;

    const now = new Date().toISOString();

    // Update history
    this.sql.exec(`
      UPDATE lock_history
      SET released_at = ?, release_reason = ?
      WHERE released_at IS NULL AND locked_by = ?
    `, now, reason, lock.lockedBy);

    // Delete current lock
    this.sql.exec('DELETE FROM current_lock WHERE id = 1');
  }
}
