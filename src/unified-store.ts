/**
 * Unified Store - Switches between storage backends
 *
 * Storage options (in priority order):
 * 1. DO_URL - Use Cloudflare Durable Objects (recommended for production)
 * 2. PERSIST=true - Use local JSON file persistence
 * 3. Default - Use in-memory storage (development only)
 *
 * Environment variables:
 * - DO_URL: URL of deployed DO Worker (e.g., https://agent-coord-do.workers.dev)
 * - PERSIST: Set to 'true' for file persistence
 * - DATA_PATH: Custom path for JSON file storage
 */

import { store as memoryStore } from './store.js';
import { getPersistentStore, JsonPersistence } from './persistence.js';
import { createDOStore } from './do-store.js';

const USE_DO = !!process.env.DO_URL;
const USE_PERSISTENCE = process.env.PERSIST === 'true' || process.env.PERSIST === '1';
const DATA_PATH = process.env.DATA_PATH;

export interface UnifiedStore {
  // Agent operations
  updateAgent: typeof memoryStore.updateAgent;
  getAgent: typeof memoryStore.getAgent;
  getAllAgents: typeof memoryStore.getAllAgents;
  getActiveAgents: typeof memoryStore.getActiveAgents;

  // Message operations
  sendMessage: typeof memoryStore.sendMessage;
  getMessagesFor: typeof memoryStore.getMessagesFor;

  // Group chat operations
  postGroupMessage: typeof memoryStore.postGroupMessage;
  getGroupMessages: typeof memoryStore.getGroupMessages;
  getGroupMessagesSince: typeof memoryStore.getGroupMessagesSince;
  addReaction: typeof memoryStore.addReaction;

  // Resource lock operations
  checkLock: typeof memoryStore.checkLock;
  acquireLock: typeof memoryStore.acquireLock;
  releaseLock: typeof memoryStore.releaseLock;
  getAllLocks: typeof memoryStore.getAllLocks;

  // Task operations
  createTask: typeof memoryStore.createTask;
  getTask: typeof memoryStore.getTask;
  listTasks: typeof memoryStore.listTasks;
  updateTaskStatus: typeof memoryStore.updateTaskStatus;
  assignTask: typeof memoryStore.assignTask;

  // Task-File Binding operations
  claimTaskWithFiles: typeof memoryStore.claimTaskWithFiles;
  releaseTaskWithFiles: typeof memoryStore.releaseTaskWithFiles;
  getTasksForFile: typeof memoryStore.getTasksForFile;

  // Claim operations
  claim: typeof memoryStore.claim;
  checkClaim: typeof memoryStore.checkClaim;
  releaseClaim: typeof memoryStore.releaseClaim;
  listClaims: typeof memoryStore.listClaims;

  // Zone operations
  claimZone: typeof memoryStore.claimZone;
  checkZone: typeof memoryStore.checkZone;
  releaseZone: typeof memoryStore.releaseZone;
  listZones: typeof memoryStore.listZones;
  getZonesFor: typeof memoryStore.getZonesFor;

  // Checkpoint operations
  saveCheckpoint: typeof memoryStore.saveCheckpoint;
  getCheckpoint: typeof memoryStore.getCheckpoint;
  clearCheckpoint: typeof memoryStore.clearCheckpoint;

  // Utility
  extractMentions: typeof memoryStore.extractMentions;
}

function getStore(): UnifiedStore {
  // Priority 1: Durable Objects (production)
  if (USE_DO) {
    console.error(`[unified-store] Using DURABLE OBJECTS storage (${process.env.DO_URL})`);
    return createDOStore();
  }

  // Priority 2: File persistence (staging/local)
  if (USE_PERSISTENCE) {
    console.error('[unified-store] Using PERSISTENT storage');
    const persistent = getPersistentStore(DATA_PATH);

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.error('[unified-store] Flushing to disk...');
      persistent.flush();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.error('[unified-store] Flushing to disk...');
      persistent.flush();
      process.exit(0);
    });

    return persistent;
  }

  // Priority 3: In-memory (development)
  console.error('[unified-store] Using IN-MEMORY storage (set DO_URL or PERSIST=true for persistence)');
  return memoryStore;
}

export const unifiedStore = getStore();
