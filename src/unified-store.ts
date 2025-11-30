/**
 * Unified Store - Switches between in-memory and persistent storage
 *
 * Set PERSIST=true environment variable to enable file persistence.
 * Set DATA_PATH to customize storage location.
 */

import { store as memoryStore } from './store.js';
import { getPersistentStore, JsonPersistence } from './persistence.js';

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
  } else {
    console.error('[unified-store] Using IN-MEMORY storage (set PERSIST=true for file persistence)');
    return memoryStore;
  }
}

export const unifiedStore = getStore();
