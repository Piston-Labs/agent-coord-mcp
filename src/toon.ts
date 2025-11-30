/**
 * TOON (Token-Oriented Object Notation) Module for Agent Coordination
 *
 * WHY THIS EXISTS:
 * TOON reduces token usage by 30-60% for structured data compared to JSON.
 * For multi-agent coordination, this means:
 * - Agents can process more context before hitting limits
 * - Status updates, task lists, and team info stay compact
 * - Less bandwidth for real-time collaboration
 *
 * SAFETY PRINCIPLES:
 * 1. Graceful degradation - if TOON fails, fallback to JSON
 * 2. Type preservation - numbers stay numbers, booleans stay booleans
 * 3. Error isolation - encoding failures never crash the server
 *
 * This is a self-contained implementation (no external dependencies)
 * to keep the agent-coord-mcp package minimal.
 */

// ============================================================================
// Types
// ============================================================================

export type OutputFormat = 'toon' | 'json' | 'auto';

export interface FormatResult {
  content: string;
  format: 'toon' | 'json';
  tokenEstimate: number;
  originalTokenEstimate: number;
  savings: number;
}

export interface ToonConfig {
  defaultFormat: OutputFormat;
  debug: boolean;
}

// Global configuration
export const config: ToonConfig = {
  defaultFormat: 'auto',
  debug: false
};

// ============================================================================
// TOON Encoder (Self-Contained Implementation)
// ============================================================================

/**
 * Encode uniform array of objects to TOON format
 * Format: [count]{key1,key2,...}:\n  val1,val2,...\n  val1,val2,...
 */
function encodeUniformArray(arr: Record<string, unknown>[]): string {
  if (arr.length === 0) return '[]';

  const keys = Object.keys(arr[0]);
  const header = `[${arr.length}]{${keys.join(',')}}:`;

  const rows = arr.map(obj => {
    return '  ' + keys.map(k => encodeValue(obj[k])).join(',');
  });

  return header + '\n' + rows.join('\n');
}

/**
 * Encode a primitive value for TOON
 */
function encodeValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    // Escape commas and newlines in strings
    if (val.includes(',') || val.includes('\n') || val.includes('"')) {
      return '"' + val.replace(/"/g, '""').replace(/\n/g, '\\n') + '"';
    }
    return val;
  }
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) return '[' + val.map(encodeValue).join('|') + ']';
  return JSON.stringify(val);
}

/**
 * Decode TOON back to JavaScript objects
 */
function decodeToon(toon: string): unknown {
  const lines = toon.split('\n');
  if (lines.length === 0) return null;

  const headerMatch = lines[0].match(/^\[(\d+)\]\{([^}]+)\}:$/);
  if (!headerMatch) {
    // Not TOON format, try JSON
    return JSON.parse(toon);
  }

  const count = parseInt(headerMatch[1], 10);
  const keys = headerMatch[2].split(',');
  const result: Record<string, unknown>[] = [];

  for (let i = 1; i <= count && i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseToonRow(line);
    const obj: Record<string, unknown> = {};
    keys.forEach((key, idx) => {
      obj[key] = decodeValue(values[idx] || '');
    });
    result.push(obj);
  }

  return result;
}

/**
 * Parse a TOON row respecting quoted strings
 */
function parseToonRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === '"' && inQuotes) {
      if (line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = false;
      i++;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  values.push(current);
  return values;
}

/**
 * Decode a TOON value to JavaScript type
 */
function decodeValue(val: string): unknown {
  if (val === '') return null;
  if (val === 'true') return true;
  if (val === 'false') return false;

  // Check for array syntax [a|b|c]
  if (val.startsWith('[') && val.endsWith(']')) {
    const inner = val.slice(1, -1);
    if (inner === '') return [];
    return inner.split('|').map(decodeValue);
  }

  // Check for number
  const num = parseFloat(val);
  if (!isNaN(num) && isFinite(num) && String(num) === val) {
    return num;
  }

  // Unescape newlines
  return val.replace(/\\n/g, '\n');
}

// ============================================================================
// Data Shape Analysis
// ============================================================================

type DataShape =
  | 'uniform_array'     // Array of objects with same keys - TOON excels
  | 'primitive_array'   // Array of primitives
  | 'nested_complex'    // Deeply nested structures - JSON better
  | 'simple_object'     // Flat object
  | 'primitive'         // Single value
  | 'empty';

function analyzeDataShape(data: unknown): DataShape {
  if (data === null || data === undefined) return 'primitive';

  if (Array.isArray(data)) {
    if (data.length === 0) return 'empty';

    // Check if all elements are objects with the same keys
    if (data.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
      const firstKeys = Object.keys(data[0] as object).sort().join(',');
      const allSameKeys = data.every(item =>
        Object.keys(item as object).sort().join(',') === firstKeys
      );

      // Check for deeply nested structures
      const hasDeepNesting = data.some(item =>
        Object.values(item as object).some(v =>
          typeof v === 'object' && v !== null && !Array.isArray(v)
        )
      );

      if (allSameKeys && !hasDeepNesting) {
        return 'uniform_array';
      }
    }

    if (data.every(item => typeof item !== 'object' || item === null)) {
      return 'primitive_array';
    }

    return 'nested_complex';
  }

  if (typeof data === 'object') {
    const values = Object.values(data as object);
    const hasDeepNesting = values.some(v =>
      typeof v === 'object' && v !== null &&
      Object.values(v as object).some(vv => typeof vv === 'object' && vv !== null)
    );

    if (hasDeepNesting) {
      return 'nested_complex';
    }

    return 'simple_object';
  }

  return 'primitive';
}

// ============================================================================
// Core API
// ============================================================================

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Encode data to TOON format
 */
export function toToon(data: unknown): string {
  const shape = analyzeDataShape(data);

  if (shape === 'uniform_array') {
    return encodeUniformArray(data as Record<string, unknown>[]);
  }

  // For other shapes, use JSON
  return JSON.stringify(data, null, 2);
}

/**
 * Decode TOON back to JavaScript
 */
export function fromToon(toonString: string): unknown {
  return decodeToon(toonString);
}

/**
 * Format output with intelligent format selection
 */
export function formatOutput(
  data: unknown,
  preferred: OutputFormat = config.defaultFormat
): FormatResult {
  const jsonString = JSON.stringify(data, null, 2);
  const jsonTokens = estimateTokens(jsonString);

  // Always JSON for certain preferences or shapes
  if (preferred === 'json') {
    return {
      content: jsonString,
      format: 'json',
      tokenEstimate: jsonTokens,
      originalTokenEstimate: jsonTokens,
      savings: 0
    };
  }

  const shape = analyzeDataShape(data);

  // Only use TOON for uniform arrays (where it really shines)
  if (shape !== 'uniform_array' && preferred !== 'toon') {
    return {
      content: jsonString,
      format: 'json',
      tokenEstimate: jsonTokens,
      originalTokenEstimate: jsonTokens,
      savings: 0
    };
  }

  try {
    const toonString = toToon(data);
    const toonTokens = estimateTokens(toonString);

    return {
      content: toonString,
      format: 'toon',
      tokenEstimate: toonTokens,
      originalTokenEstimate: jsonTokens,
      savings: Math.round((1 - toonTokens / jsonTokens) * 100)
    };
  } catch (err) {
    if (config.debug) {
      console.error('[toon] Encoding failed, falling back to JSON:', err);
    }
    return {
      content: jsonString,
      format: 'json',
      tokenEstimate: jsonTokens,
      originalTokenEstimate: jsonTokens,
      savings: 0
    };
  }
}

// ============================================================================
// Agent Coordination Formatters
// ============================================================================

/**
 * Format agent list for token-efficient transfer
 */
export function formatAgents(agents: Array<{
  id: string;
  status: string;
  currentTask?: string;
  workingOn?: string;
  lastSeen: string;
}>): FormatResult {
  const simplified = agents.map(a => ({
    id: a.id,
    status: a.status,
    task: a.currentTask || '',
    working: a.workingOn || '',
    seen: a.lastSeen.split('T')[0]
  }));
  return formatOutput(simplified, 'toon');
}

/**
 * Format task list
 */
export function formatTasks(tasks: Array<{
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
}>): FormatResult {
  const simplified = tasks.map(t => ({
    id: t.id,
    title: t.title.length > 50 ? t.title.substring(0, 47) + '...' : t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee || ''
  }));
  return formatOutput(simplified, 'toon');
}

/**
 * Format claims list
 */
export function formatClaims(claims: Array<{
  what: string;
  by: string;
  description?: string;
  since: string;
  stale: boolean;
}>): FormatResult {
  const simplified = claims.map(c => ({
    what: c.what,
    by: c.by,
    desc: c.description || '',
    since: c.since.split('T')[0],
    stale: c.stale
  }));
  return formatOutput(simplified, 'toon');
}

/**
 * Format locks list
 */
export function formatLocks(locks: Array<{
  resourcePath: string;
  resourceType: string;
  lockedBy: string;
  reason?: string;
  lockedAt: string;
}>): FormatResult {
  const simplified = locks.map(l => ({
    path: l.resourcePath,
    type: l.resourceType,
    by: l.lockedBy,
    reason: l.reason || '',
    at: l.lockedAt.split('T')[0]
  }));
  return formatOutput(simplified, 'toon');
}

/**
 * Format zones list
 */
export function formatZones(zones: Array<{
  zoneId: string;
  path: string;
  owner: string;
  description?: string;
}>): FormatResult {
  const simplified = zones.map(z => ({
    zone: z.zoneId,
    path: z.path,
    owner: z.owner,
    desc: z.description || ''
  }));
  return formatOutput(simplified, 'toon');
}

/**
 * Format group messages
 */
export function formatMessages(messages: Array<{
  id: string;
  author: string;
  authorType: string;
  message: string;
  timestamp: string;
}>): FormatResult {
  const simplified = messages.map(m => ({
    id: m.id,
    author: m.author,
    type: m.authorType,
    msg: m.message.length > 100 ? m.message.substring(0, 97) + '...' : m.message,
    time: m.timestamp.split('T')[1]?.split('.')[0] || m.timestamp
  }));
  return formatOutput(simplified, 'toon');
}

// ============================================================================
// Status Check
// ============================================================================

export function getToonStatus(): {
  available: boolean;
  defaultFormat: OutputFormat;
  supportedShapes: string[];
} {
  return {
    available: true,
    defaultFormat: config.defaultFormat,
    supportedShapes: ['uniform_array']
  };
}
