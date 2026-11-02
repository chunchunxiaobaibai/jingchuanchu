import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

// Isolate only the require implementation, with all other code held equal.
// Each generated module gets its own monomorphic access loop and warmup.
const source = await readFile('packages/ecs/index.ts', 'utf8');
const start = source.indexOf('  require<T>(entity:');
const end = source.indexOf('  has<T>', start);
assert(start >= 0 && end > start);
const variants = {
  slot: source.slice(start, end),
  original: `  require<T>(entity: Entity, token: Token<T>): T {
    this.assertAlive(entity);
    const store = this.stores.get(token.key);
    if (!store?.has(entity.index)) throw new Error(\`Missing component: \${token.name}\`);
    return store.get(entity.index) as T;
  }\n`,
  value: `  require<T>(entity: Entity, token: Token<T>): T {
    this.assertAlive(entity);
    const store = this.stores.get(token.key);
    const value = store?.get(entity.index);
    if (value === undefined && !store?.has(entity.index)) throw new Error(\`Missing component: \${token.name}\`);
    return value as T;
  }\n`,
};
const workload = `
export function accessWorkload(size: number) {
  const world = new World(), token = component<number>('value');
  const handles = Array.from({length:size}, (_, i) => { const e=world.create();world.set(e,token,i);return e; });
  return () => { let sum=0;for(const e of handles)sum+=world.require(e,token);return sum; };
}`;
const modules = new Map<string, { accessWorkload(size: number): () => number }>();
for (const [name, method] of Object.entries(variants)) {
  const text = source.slice(0, start) + method + source.slice(end) + workload;
  const code = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  modules.set(
    name,
    await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')),
  );
}
const results = [];
let checksum = 0;
for (const size of [1000, 10000]) {
  const runs = new Map([...modules].map(([name, module]) => [name, module.accessWorkload(size)]));
  const samples = new Map([...runs.keys()].map((key) => [key, [] as number[]]));
  const batch = 50;
  const execute = (name: string) => {
    let sum = 0;
    for (let i = 0; i < batch; i++) sum += runs.get(name)!();
    assert.equal(sum, ((size * (size - 1)) / 2) * batch);
    checksum += sum;
  };
  for (let i = 0; i < 10; i++) for (const name of runs.keys()) execute(name);
  const names = [...runs.keys()];
  for (let i = 0; i < 31; i++) {
    for (let j = 0; j < names.length; j++) {
      const name = names[(i + j) % names.length]!;
      const started = performance.now();
      execute(name);
      samples.get(name)!.push((performance.now() - started) / batch);
    }
  }
  results.push({
    size,
    variants: Object.fromEntries(
      [...samples].map(([name, values]) => {
        values.sort((a, b) => a - b);
        return [name, { medianMs: values[15], p95Ms: values[29], minMs: values[0] }];
      }),
    ),
  });
}
const output = {
  node: process.version,
  samples: 31,
  warmupBatches: 10,
  batch: 50,
  units: 'milliseconds per complete access loop',
  currentSourceSha256: createHash('sha256').update(source).digest('hex'),
  variants,
  checksum,
  results,
};
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
