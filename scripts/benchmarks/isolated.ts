import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const directory = resolve('node_modules/.cache/jingchuanchu-isolation');
await mkdir(directory, { recursive: true });
function historical(file: string, revision = 'v0.3.0') {
  const result = spawnSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
async function module(name: string, source: string) {
  const file = resolve(directory, name + '.mjs');
  await writeFile(
    file,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
  );
  return await import(pathToFileURL(file).href);
}
function measure(run: () => void) {
  for (let i = 0; i < 8; i++) run();
  const samples = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[10], minMs: samples[0], maxMs: samples[20] };
}
const old = historical('packages/ecs/index.ts'),
  current = await readFile('packages/ecs/index.ts', 'utf8');
let handle = old
  .replace(
    'private readonly generations: number[] = [];',
    'private readonly generations: number[] = [];\nprivate readonly handles: Array<Entity | undefined> = [];',
  )
  .replace(
    'return Object.freeze({ worldId: this.id, index, generation: this.generations[index]! });',
    'const entity=Object.freeze({worldId:this.id,index,generation:this.generations[index]!});this.handles[index]=entity;return entity;',
  )
  .replace(
    'this.alive.delete(entity.index);',
    'this.alive.delete(entity.index);this.handles[entity.index]=undefined;',
  )
  .replace(
    'const entities = candidates.map((index) =>\n      Object.freeze({ worldId: this.id, index, generation: this.generations[index]! }),\n    );',
    'const entities = candidates.map(index=>this.handles[index]!);',
  )
  .replace('this.alive.clear();', 'this.alive.clear();this.handles.length=0;');
const requireBody = current.slice(current.indexOf('  require<T>'), current.indexOf('  has<T>'));
const requireOnly =
  old.slice(0, old.indexOf('  require<T>')) + requireBody + old.slice(old.indexOf('  has<T>'));
const results: Record<string, unknown> = {};
let checksum = 0;
try {
  const renderer = await module('renderer', historical('packages/renderer-2d/index.ts'));
  const original = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 } as Window & typeof globalThis;
  const canvas = {
    getContext: () => ({ setTransform() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {} }),
  };
  try {
    for (const [name, source] of [
      ['baseline', old],
      ['handles-only', handle],
      ['require-only', requireOnly],
      ['combined', current],
    ]) {
      const { World, component } = await module(name!, source!);
      const world = new World();
      const token = component('value');
      for (let i = 0; i < 10000; i++) {
        const e = world.create();
        world.set(e, token, i);
      }
      const query = measure(() => {
        for (let j = 0; j < 20; j++) for (const e of world.query(token)) checksum += e.index;
      });
      world.dispose();
      const drawing = new World();
      for (let i = 0; i < 1000; i++) {
        const e = drawing.create();
        drawing.set(e, renderer.Position2D, { x: i, y: i });
        drawing.set(e, renderer.Shape2D, {
          kind: 'rect',
          color: '#fff',
          width: 10,
          height: 10,
          layer: i % 7,
        });
      }
      const target = new renderer.Canvas2D(canvas);
      const draw = measure(() => {
        for (let j = 0; j < 20; j++) target.drawWorld(drawing);
      });
      drawing.dispose();
      results[name!] = { query, draw };
    }
  } finally {
    globalThis.window = original;
  }
  for (const [name, source] of [
    ['constraints-recompile', historical('packages/core/index.ts', '76a39dc')],
    ['constraints-cached', await readFile('packages/core/index.ts', 'utf8')],
  ]) {
    const { Engine } = await module(name!, source!);
    const engine = new Engine({ diagnostics: false });
    for (let i = 0; i < 100; i++)
      engine.addSystem({
        id: String(i),
        ...(i ? { after: [String(i - 1)] } : {}),
        update() {
          checksum++;
        },
      });
    engine.start();
    results[name!] = measure(() => {
      for (let i = 0; i < 100; i++) engine.advance(engine.step);
    });
    engine.dispose();
  }
  const output = {
    node: process.version,
    units: 'milliseconds per batch',
    samples: 21,
    checksum,
    results,
  };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
