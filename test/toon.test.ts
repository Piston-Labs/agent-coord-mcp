/**
 * TOON Format Tests
 */

import {
  toToon,
  fromToon,
  formatOutput,
  formatAgents,
  formatTasks,
  formatClaims,
  estimateTokens
} from '../src/toon.js';

// Test data
const agents = [
  { id: 'agent-1', status: 'active', currentTask: 'Building API', workingOn: 'src/api.ts', lastSeen: '2024-01-15T10:30:00Z' },
  { id: 'agent-2', status: 'idle', currentTask: '', workingOn: '', lastSeen: '2024-01-15T10:25:00Z' },
  { id: 'agent-3', status: 'waiting', currentTask: 'Review PR', workingOn: 'PR #42', lastSeen: '2024-01-15T10:28:00Z' }
];

const tasks = [
  { id: 'task-1', title: 'Implement TOON format', status: 'in-progress', priority: 'high', assignee: 'agent-1' },
  { id: 'task-2', title: 'Add persistence layer', status: 'done', priority: 'medium', assignee: 'agent-2' },
  { id: 'task-3', title: 'Write documentation', status: 'todo', priority: 'low', assignee: '' }
];

const claims = [
  { what: 'src/api.ts', by: 'agent-1', description: 'Building REST API', since: '2024-01-15T10:00:00Z', stale: false },
  { what: 'README.md', by: 'agent-2', description: 'Updating docs', since: '2024-01-15T09:00:00Z', stale: true }
];

console.log('=== TOON Format Tests ===\n');

// Test 1: Basic uniform array encoding
console.log('Test 1: Uniform array encoding');
const uniformData = [
  { name: 'Alice', age: 30, active: true },
  { name: 'Bob', age: 25, active: false },
  { name: 'Charlie', age: 35, active: true }
];

const jsonVersion = JSON.stringify(uniformData, null, 2);
const toonVersion = toToon(uniformData);

console.log('JSON:');
console.log(jsonVersion);
console.log(`\nTOON:`);
console.log(toonVersion);
console.log(`\nJSON chars: ${jsonVersion.length}, TOON chars: ${toonVersion.length}`);
console.log(`Savings: ${Math.round((1 - toonVersion.length / jsonVersion.length) * 100)}%\n`);

// Test 2: Decode and verify roundtrip
console.log('Test 2: Roundtrip verification');
const decoded = fromToon(toonVersion) as typeof uniformData;
const match = JSON.stringify(decoded) === JSON.stringify(uniformData);
console.log(`Roundtrip match: ${match ? '✓ PASS' : '✗ FAIL'}`);
if (!match) {
  console.log('Original:', uniformData);
  console.log('Decoded:', decoded);
}
console.log();

// Test 3: Agent list formatting
console.log('Test 3: Agent list formatting');
const agentResult = formatAgents(agents);
console.log(`Format: ${agentResult.format}`);
console.log(`Token savings: ${agentResult.savings}%`);
console.log('Content:');
console.log(agentResult.content);
console.log();

// Test 4: Task list formatting
console.log('Test 4: Task list formatting');
const taskResult = formatTasks(tasks);
console.log(`Format: ${taskResult.format}`);
console.log(`Token savings: ${taskResult.savings}%`);
console.log('Content:');
console.log(taskResult.content);
console.log();

// Test 5: Claims formatting
console.log('Test 5: Claims list formatting');
const claimResult = formatClaims(claims);
console.log(`Format: ${claimResult.format}`);
console.log(`Token savings: ${claimResult.savings}%`);
console.log('Content:');
console.log(claimResult.content);
console.log();

// Test 6: Auto format selection
console.log('Test 6: Auto format selection');
const nestedData = {
  meta: { version: '1.0', nested: { deep: true } },
  items: [1, 2, 3]
};
const nestedResult = formatOutput(nestedData, 'auto');
console.log(`Nested data format: ${nestedResult.format} (expected: json)`);
console.log();

// Test 7: String escaping
console.log('Test 7: String escaping');
const dataWithCommas = [
  { name: 'Alice, Bob', value: 'Hello, World' },
  { name: 'Test', value: 'Line1\nLine2' }
];
const escapedToon = toToon(dataWithCommas);
console.log('TOON with escaped strings:');
console.log(escapedToon);
const escapedDecoded = fromToon(escapedToon) as typeof dataWithCommas;
const escapeMatch = escapedDecoded[0].name === 'Alice, Bob' && escapedDecoded[1].value === 'Line1\nLine2';
console.log(`Escape roundtrip: ${escapeMatch ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 8: Token estimation
console.log('Test 8: Token estimation');
const testString = 'This is a test string for token estimation';
const tokens = estimateTokens(testString);
console.log(`String: "${testString}"`);
console.log(`Chars: ${testString.length}, Estimated tokens: ${tokens}`);
console.log();

// Summary
console.log('=== Summary ===');
console.log('Agent list savings:', agentResult.savings + '%');
console.log('Task list savings:', taskResult.savings + '%');
console.log('Claims list savings:', claimResult.savings + '%');

const avgSavings = Math.round((agentResult.savings + taskResult.savings + claimResult.savings) / 3);
console.log(`Average savings: ${avgSavings}%`);
console.log('\nAll tests completed!');
