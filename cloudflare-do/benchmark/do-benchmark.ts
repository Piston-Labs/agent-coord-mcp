/**
 * DO Performance Benchmark
 *
 * Tests local DO Worker performance for common operations.
 * Run with: npx tsx benchmark/do-benchmark.ts
 */

const DO_URL = process.env.DO_URL || 'http://localhost:8787';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

async function benchmark(
  name: string,
  fn: () => Promise<void>,
  iterations = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < 5; i++) {
    await fn();
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  return {
    operation: name,
    iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    avgMs: Math.round(avgMs * 100) / 100,
    minMs: Math.round(minMs * 100) / 100,
    maxMs: Math.round(maxMs * 100) / 100,
    opsPerSec: Math.round(1000 / avgMs)
  };
}

async function doFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${DO_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });
}

async function runBenchmarks() {
  console.log('=== DO Performance Benchmark ===\n');
  console.log(`Target: ${DO_URL}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Check if DO is running
  try {
    const health = await doFetch('/health');
    if (!health.ok) throw new Error('Health check failed');
    console.log('DO Worker: Running\n');
  } catch (error) {
    console.error('ERROR: DO Worker not reachable at', DO_URL);
    console.error('Start it with: cd cloudflare-do && npx wrangler dev');
    process.exit(1);
  }

  const results: BenchmarkResult[] = [];
  const agentId = `bench-agent-${Date.now()}`;

  // 1. Health Check (baseline)
  console.log('Running: Health Check...');
  results.push(await benchmark('Health Check', async () => {
    await doFetch('/health');
  }));

  // 2. Agent Registration
  console.log('Running: Agent Registration...');
  results.push(await benchmark('Agent Register', async () => {
    await doFetch('/coordinator/agents', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        status: 'active',
        currentTask: 'Benchmarking'
      })
    });
  }));

  // 3. Get Work (hot-start)
  console.log('Running: Get Work (hot-start)...');
  results.push(await benchmark('Get Work', async () => {
    await doFetch(`/coordinator/work?agentId=${agentId}`);
  }));

  // 4. Post Chat Message
  console.log('Running: Post Chat Message...');
  let chatCounter = 0;
  results.push(await benchmark('Post Chat', async () => {
    await doFetch('/coordinator/chat', {
      method: 'POST',
      body: JSON.stringify({
        author: agentId,
        message: `Benchmark message ${chatCounter++}`,
        authorType: 'agent'
      })
    });
  }));

  // 5. Get Chat Messages
  console.log('Running: Get Chat Messages...');
  results.push(await benchmark('Get Chat', async () => {
    await doFetch('/coordinator/chat?limit=50');
  }));

  // 6. Create Task
  console.log('Running: Create Task...');
  let taskCounter = 0;
  results.push(await benchmark('Create Task', async () => {
    await doFetch('/coordinator/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: `Benchmark Task ${taskCounter++}`,
        description: 'Performance test',
        createdBy: agentId,
        priority: 'medium'
      })
    });
  }));

  // 7. List Tasks
  console.log('Running: List Tasks...');
  results.push(await benchmark('List Tasks', async () => {
    await doFetch('/coordinator/tasks');
  }));

  // 8. Lock Check
  console.log('Running: Lock Check...');
  const resourcePath = 'src/benchmark-test.ts';
  results.push(await benchmark('Lock Check', async () => {
    await doFetch(`/lock/${encodeURIComponent(resourcePath)}/check`);
  }));

  // 9. Lock Acquire
  console.log('Running: Lock Acquire...');
  let lockCounter = 0;
  results.push(await benchmark('Lock Acquire', async () => {
    const path = `src/benchmark-${lockCounter++}.ts`;
    await doFetch(`/lock/${encodeURIComponent(path)}/lock`, {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        reason: 'Benchmark',
        ttlMs: 60000
      })
    });
  }, 50)); // Fewer iterations for locks

  // 10. Save Checkpoint
  console.log('Running: Save Checkpoint...');
  results.push(await benchmark('Save Checkpoint', async () => {
    await doFetch(`/agent/${agentId}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        conversationSummary: 'Benchmark session',
        currentTask: 'Performance testing',
        pendingWork: ['More benchmarks'],
        filesEdited: ['src/test.ts'],
        accomplishments: ['Ran benchmarks']
      })
    });
  }));

  // 11. Get Checkpoint
  console.log('Running: Get Checkpoint...');
  results.push(await benchmark('Get Checkpoint', async () => {
    await doFetch(`/agent/${agentId}/checkpoint`);
  }));

  // 12. Get Agent State
  console.log('Running: Get Agent State...');
  results.push(await benchmark('Get Agent State', async () => {
    await doFetch(`/agent/${agentId}/state`);
  }));

  // Print Results
  console.log('\n=== Results ===\n');
  console.log('| Operation | Avg (ms) | Min (ms) | Max (ms) | Ops/sec |');
  console.log('|-----------|----------|----------|----------|---------|');

  for (const r of results) {
    console.log(`| ${r.operation.padEnd(15)} | ${r.avgMs.toString().padStart(8)} | ${r.minMs.toString().padStart(8)} | ${r.maxMs.toString().padStart(8)} | ${r.opsPerSec.toString().padStart(7)} |`);
  }

  // Summary
  const totalOps = results.reduce((sum, r) => sum + r.iterations, 0);
  const totalTime = results.reduce((sum, r) => sum + r.totalMs, 0);
  const avgLatency = results.reduce((sum, r) => sum + r.avgMs, 0) / results.length;

  console.log('\n=== Summary ===\n');
  console.log(`Total Operations: ${totalOps}`);
  console.log(`Total Time: ${Math.round(totalTime)}ms`);
  console.log(`Average Latency: ${Math.round(avgLatency * 100) / 100}ms`);
  console.log(`Throughput: ~${Math.round(totalOps / (totalTime / 1000))} ops/sec`);

  // Save results to JSON
  const report = {
    timestamp: new Date().toISOString(),
    target: DO_URL,
    results,
    summary: {
      totalOperations: totalOps,
      totalTimeMs: Math.round(totalTime),
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      throughputOpsPerSec: Math.round(totalOps / (totalTime / 1000))
    }
  };

  console.log('\nJSON Report:');
  console.log(JSON.stringify(report, null, 2));
}

runBenchmarks().catch(console.error);
