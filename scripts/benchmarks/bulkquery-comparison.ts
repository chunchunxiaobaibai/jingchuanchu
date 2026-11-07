import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { World, component } from '@xiaobaibaifqy/jingchuanchu-ecs';

interface Result {
  name: string;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  improvement?: string;
}

const results: Result[] = [];

function measure(name: string, batch: number, run: () => number): Result {
  const execute = () => {
    let sum = 0;
    for (let i = 0; i < batch; i++) sum += run();
    return sum;
  };

  // Warmup
  for (let i = 0; i < 5; i++) execute();

  // Measurement
  const samples: number[] = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    execute();
    samples.push((performance.now() - start) / batch);
  }
  samples.sort((a, b) => a - b);

  const result: Result = {
    name,
    medianMs: samples[10]!,
    p95Ms: samples[19]!,
    minMs: samples[0]!,
  };
  results.push(result);
  return result;
}

console.log('Benchmarking bulkQuery vs query performance\n');
console.log('Size    Components    query(ms)    bulkQuery(ms)    Improvement');
console.log('----------------------------------------------------------------');

for (const size of [1000, 10000]) {
  for (const componentCount of [1, 4]) {
    const world = new World();
    const tokens = Array.from({ length: 4 }, (_, index) =>
      component<number>(String(index))
    );

    // Setup entities
    Array.from({ length: size }, (_, index) => {
      const entity = world.create();
      for (const token of tokens) world.set(entity, token, index);
    });

    const selected = tokens.slice(0, componentCount);

    // Test query
    const queryResult = measure(`query:${size}:${componentCount}`, 20, () => {
      let sum = 0;
      for (const entity of world.query(...selected)) sum += entity.index;
      assert.equal(sum, (size * (size - 1)) / 2);
      return sum;
    });

    // Test bulkQuery
    const bulkResult = measure(
      `bulkQuery:${size}:${componentCount}`,
      20,
      () => {
        const iterator = world.bulkQuery(...selected);
        const buffer = iterator.next().value?.buffer;
        let sum = 0;
        if (buffer) {
          for (const entity of buffer) sum += entity.index;
        }
        iterator.return?.();
        assert.equal(sum, (size * (size - 1)) / 2);
        return sum;
      }
    );

    // Calculate improvement
    const improvement =
      ((queryResult.medianMs - bulkResult.medianMs) / queryResult.medianMs) *
      100;
    bulkResult.improvement = `${improvement.toFixed(1)}%`;

    console.log(
      `${size.toString().padStart(5)}   ${componentCount.toString().padStart(2)}            ${queryResult.medianMs.toFixed(4)}       ${bulkResult.medianMs.toFixed(4)}          ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`
    );

    world.dispose();
  }
  console.log();
}

console.log('\nSummary (10k entities):');
console.log(`  Single component:  ${results.find((r) => r.name === 'bulkQuery:10000:1')?.improvement}`);
console.log(`  Four components:   ${results.find((r) => r.name === 'bulkQuery:10000:4')?.improvement}`);
